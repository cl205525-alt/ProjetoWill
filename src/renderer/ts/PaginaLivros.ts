function isbn13Assistido(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const codigo = Util.codigoIsbn(valor);
  const digito = (base: string): number =>
    (10 - [...base].reduce((soma, c, i) => soma + Number(c) * (i % 2 ? 3 : 1), 0) % 10) % 10;
  if (/^97[89]\d{10}$/.test(codigo)) return Number(codigo[12]) === digito(codigo.slice(0, 12)) ? codigo : null;
  if (!/^\d{9}[\dX]$/.test(codigo)) return null;
  const soma = [...codigo].reduce((total, c, i) => total + (c === 'X' ? 10 : Number(c)) * (10 - i), 0);
  if (soma % 11 !== 0) return null;
  const base = `978${codigo.slice(0, 9)}`;
  return `${base}${digito(base)}`;
}

class GeneroAssistido {
  static readonly naoConfirmado = 'Gênero não confirmado';
  private static readonly consultando = 'Consultando gênero…';
  private static readonly emCurso = new Map<string, Promise<string | null>>();
  private candidato: string | null | undefined = null;
  readonly consulta?: Promise<string | null>;

  static doAcervo(livros: Registro[]): string[] {
    return [...new Set(livros.map(l => String(l.genero || '')).filter(Boolean))];
  }

  constructor(livro: ResultadoBibliografico, isbnConsultado?: string, consultar = true) {
    const codigo = isbn13Assistido(livro.isbn);
    if (isbnConsultado !== undefined && codigo !== isbn13Assistido(isbnConsultado)) return;
    this.candidato = livro.genero?.trim() || null;
    if (this.candidato || !consultar || !codigo) return;
    this.candidato = undefined;
    let consulta = GeneroAssistido.emCurso.get(codigo);
    if (!consulta) {
      consulta = Api.chamar<string | null>('apis:genre-fallback', codigo)
        .then(nome => typeof nome === 'string' ? nome.trim() || null : null, () => null)
        .finally(() => GeneroAssistido.emCurso.delete(codigo));
      GeneroAssistido.emCurso.set(codigo, consulta);
    }
    this.consulta = consulta.then(nome => this.candidato = nome);
  }

  nome(generos: string[]): string | null {
    if (!this.candidato) return null;
    const chave = (nome: string): string => Util.semAcento(nome).trim().replace(/\s+/g, ' ');
    const candidato = chave(this.candidato);

    if (!candidato || candidato === chave(GeneroAssistido.naoConfirmado)) return null;
    const correspondencias = generos.filter(nome => chave(nome) === candidato);
    return correspondencias.length === 1 ? correspondencias[0] : this.candidato;
  }

  texto(generos: string[]): string {
    if (this.candidato === undefined) return GeneroAssistido.consultando;
    const nome = this.nome(generos);
    return nome ? `Gênero: ${nome}` : GeneroAssistido.naoConfirmado;
  }
}

class EdicaoAssistida {
  static readonly naoConfirmada = 'Editora não confirmada';
  static readonly consultando = 'Consultando editora…';
  private static readonly emCurso = new Map<string, Promise<string | null>>();
  private nomeEditora: string | null | undefined;
  readonly consulta?: Promise<string | null>;
  readonly genero: GeneroAssistido;

  private static nomeExterno(valor: unknown): string | null {
    if (typeof valor !== 'string' || !valor.trim()) return null;
    const nome = valor.trim();
    const chave = Util.semAcento(nome).replace(/[.!…]+$/, '').trim().replace(/\s+/g, ' ');
    const estado = chave.replace(/^editora /, '');
    const ausente = /^(?:nao (?:confirmad[ao]|informad[ao]|identificad[ao]|encontrad[ao]|disponivel)|desconhecid[ao]|indisponivel|sem (?:editora|informacao))$/;
    const equivalente = /^(?:unknown(?: publisher)?|(?:publisher )?not (?:available|provided)|publisher unknown|n\/?a|[-–—])$/;
    if (ausente.test(estado) || equivalente.test(estado)) return null;
    return nome;
  }

  constructor(readonly livro: ResultadoBibliografico, readonly isbnConsultado?: string, consultar = true) {
    this.genero = new GeneroAssistido(livro, isbnConsultado, consultar);
    this.nomeEditora = EdicaoAssistida.nomeExterno(livro.editora);
    const isbn = isbn13Assistido(livro.isbn);
    if (!consultar || this.nome || !isbn || (isbnConsultado !== undefined && isbn !== isbn13Assistido(isbnConsultado))) return;
    this.nomeEditora = undefined;
    let consulta = EdicaoAssistida.emCurso.get(isbn);
    if (!consulta) {
      consulta = Api.chamar<string | null>('apis:publisher-fallback', isbn)
        .then(nome => EdicaoAssistida.nomeExterno(nome), () => null)
        .finally(() => EdicaoAssistida.emCurso.delete(isbn));
      EdicaoAssistida.emCurso.set(isbn, consulta);
    }
    this.consulta = consulta.then(nome => this.nomeEditora = nome);
  }

  get nome(): string | null | undefined { return this.nomeEditora; }

  get texto(): string {
    return this.nome === undefined ? EdicaoAssistida.consultando : this.nome ?? EdicaoAssistida.naoConfirmada;
  }
}

class PaginaLivros extends PaginaBase {

  readonly id = 'books' as const;
  readonly nome = 'Acervo de livros';
  protected override filtroPadrao = 'ativos';
  protected override filtro = 'ativos';
  private visao: 'grade' | 'lista' = 'grade';
  private ordem = 'recentes';
  private temporizadorIsbn: number | undefined;
  private isbnFormulario: string | null = null;
  private rodadaMetadados = 0;
  private revisaoBuscaTitulo = 0;
  private statusDaBuscaTitulo = false;
  private pendentesMetadados = new Set<() => boolean>();
  private salvandoMetadados: (() => void)[] | null = null;
  private candidatos: EdicaoAssistida[] = [];
  private eventosMetadados?: AbortController;
  private editados = new Set<string>();
  private sugeridos = new Map<string, string>();
  private anoEmConferencia = false;
  private autoresSugeridos: string[] = [];
  private generos: string[] = [];
  private listaDesatualizada = false;
  private tentandoRecarga = false;
  private readonly resultadosSalvos: { confirmacao: string; listaAtualizada: boolean }[] = [];

  constructor(ctx: Contexto, private readonly recarregarAcervo:
    (pagina: PaginaLivros, formularioAtual?: () => boolean) => Promise<boolean>) {
    super(ctx);
  }

  informarRecarga(atualizada: boolean): void {
    this.listaDesatualizada = !atualizada;
    this.atualizarAvisoRecarga();
  }

  private textoAvisoRecarga(): string {
    if (this.tentandoRecarga) return 'Atualizando a lista do acervo…';
    return this.listaDesatualizada ? 'A lista do acervo não foi atualizada. Use “Atualizar lista” para tentar novamente.' : '';
  }

  private atualizarAvisoRecarga(): void {
    if (this.ctx.pagina('books') !== this) return;
    const aviso = document.querySelector('#books-refresh-status');
    const texto = this.textoAvisoRecarga();
    if (aviso) {
      aviso.classList.toggle('d-none', !texto);
      if (aviso.textContent !== texto) aviso.textContent = texto;
    }
    document.querySelector('#books-refresh')?.setAttribute('aria-disabled', String(this.tentandoRecarga));
  }

  private async tentarRecarga(): Promise<void> {
    if (this.tentandoRecarga) return;
    this.tentandoRecarga = true;
    this.atualizarAvisoRecarga();
    try {
      const atualizada = await this.recarregarAcervo(this);
      if (this.ctx.pagina('books') === this) {
        Ui.toast(atualizada ? 'Lista do acervo atualizada.' : 'Não foi possível atualizar a lista do acervo. Tente novamente.', !atualizada);
      }
    } finally {
      this.tentandoRecarga = false;
      this.atualizarAvisoRecarga();
    }
  }

  private avisarLivroSalvo(confirmacao: string, listaAtualizada: boolean): void {
    if (this.resultadosSalvos.push({ confirmacao, listaAtualizada }) !== 1) return;

    queueMicrotask(() => {
      const resultados = this.resultadosSalvos.splice(0);
      const mensagens = resultados.map(r => r.confirmacao);
      const listaPendente = resultados.some(r => !r.listaAtualizada);
      if (listaPendente) mensagens.push('A lista do acervo não foi atualizada. Em Acervo de livros, use “Atualizar lista” sem salvar novamente.');
      Ui.toast(mensagens.join(' '), listaPendente);
    });
  }

  atualizarListaPreservandoFoco(): void {
    const area = document.querySelector('#area-lista');
    if (area && !area.contains(document.activeElement)) this.atualizarLista();
  }

  private filtrados(): Registro[] {
    const e = this.ctx.estado;
    let itens = e.livros.filter(l => this.pesquisa([l.titulo, l.isbn, l.autores, l.genero, l.editora].join(' ')));
    itens = itens.filter(l => this.filtro === 'todos' || (this.filtro === 'ativos' && l.ativo) || (this.filtro === 'arquivados' && !l.ativo) || (this.filtro === 'indisponiveis' && l.ativo && e.livre(l) <= 0));
    if (this.ordem === 'titulo') itens = [...itens].sort((a, b) => String(a.titulo).localeCompare(String(b.titulo), 'pt-BR'));
    else if (this.ordem === 'disponiveis') itens = [...itens].sort((a, b) => e.livre(b) - e.livre(a));
    return itens;
  }

  render(): string {
    const extra = `<select class="form-select toolbar-select" data-input="books.ordem" aria-label="Ordenar"><option value="recentes" ${this.ordem === 'recentes' ? 'selected' : ''}>Mais recentes</option><option value="titulo" ${this.ordem === 'titulo' ? 'selected' : ''}>Título (A–Z)</option><option value="disponiveis" ${this.ordem === 'disponiveis' ? 'selected' : ''}>Mais disponíveis</option></select>
      <div class="view-toggle"><button type="button" class="${this.visao === 'grade' ? 'active' : ''}" data-action="visao" data-valor="grade" aria-label="Ver em grade"><i class="bi bi-grid-3x3-gap"></i></button><button type="button" class="${this.visao === 'lista' ? 'active' : ''}" data-action="visao" data-valor="lista" aria-label="Ver em lista"><i class="bi bi-list-ul"></i></button></div>`;
    const atualizar = Html.botao('books.atualizar-lista', 'Atualizar lista', 'arrow-clockwise', 'btn-outline-secondary',
      `id="books-refresh" aria-disabled="${this.tentandoRecarga}"`);
    const aviso = this.textoAvisoRecarga();
    return `${Html.cabecalho('Acervo de livros', 'Cadastre, organize e acompanhe cada exemplar da biblioteca.', atualizar + Html.botao('novo', 'Adicionar livro', 'plus-lg'))}
      <div id="books-refresh-status" class="alert alert-warning${aviso ? '' : ' d-none'}" role="status">${aviso}</div>
      <div class="surface">${Html.barra({ busca: this.busca, atual: this.filtro, extra, placeholder: 'Título, autor, ISBN, gênero...', filtros: [['ativos', 'Ativos'], ['indisponiveis', 'Indisponíveis'], ['arquivados', 'Arquivados'], ['todos', 'Todos']] })}${this.area()}</div>`;
  }

  override entrada(nome: string, valor: string): void {
    if (nome === 'ordem') { this.ordem = valor; this.numeroPagina = 1; this.atualizarLista(); }
    else super.entrada(nome, valor);
  }

  protected override listaHtml(): string {
    const itens = this.filtrados();
    const porPag = this.visao === 'grade' ? 8 : 10;
    const pagina = Html.fatiar(itens, this.numeroPagina, porPag);
    if (this.visao === 'lista') {
      const linhas = pagina.map(l => `<tr><td><div class="book-cell">${Html.capa(l.capa_url, 'cover-large', l.isbn)}<div><div class="cell-title">${Util.esc(l.titulo)}</div><div class="cell-sub">${Util.esc(l.autores || 'Autor não informado')}</div></div></div></td><td>${Util.esc(l.isbn || '—')}</td><td>${Util.esc(l.genero || '—')}</td><td>${Util.numero(l.quantidade)}</td><td>${this.situacao(l)}</td><td><div class="cell-actions">${this.botoes(l)}</div></td></tr>`);
      return Html.tabela(['LIVRO / AUTORIA', 'ISBN', 'GÊNERO', 'EXEMPLARES', 'DISPONIBILIDADE', 'AÇÕES'], linhas, itens.length, this.numeroPagina, porPag);
    }
    if (!pagina.length) return Html.vazio('Nenhum livro com esses filtros.', 'bookshelf');
    return `<div class="book-grid">${pagina.map(l => `<article class="book-card ${l.ativo ? '' : 'arquivado'}"><button type="button" class="book-cover-wrap" data-action="ver" data-id="${Util.numero(l.id)}" aria-label="Ver detalhes de ${Util.esc(l.titulo)}">${Html.capa(l.capa_url, 'cover-card', l.isbn)}</button>
      <div class="book-body"><h3 title="${Util.esc(l.titulo)}">${Util.esc(l.titulo)}</h3><p>${Util.esc(l.autores || 'Autor não informado')}</p><div class="book-meta">${this.situacao(l)}<small>${Util.esc(l.genero || '')}</small></div></div>
      <div class="book-actions">${this.botoes(l)}</div></article>`).join('')}</div>
      <div class="table-foot"><span class="count-note">${Util.plural(itens.length, 'livro', 'livros')}</span>${Html.paginacao(itens.length, this.numeroPagina, porPag)}</div>`;
  }

  private situacao(l: Registro): string {
    if (!l.ativo) return Html.pill('Arquivado', 'neutral');
    const livres = this.ctx.estado.livre(l);
    return Html.pill(livres > 0 ? `${livres} livre(s)` : 'Indisponível', livres > 0 ? 'success' : 'warning');
  }

  private botoes(l: Registro): string {
    const admin = this.ctx.ehAdmin;
    const livre = this.ctx.estado.livre(l) > 0;
    const circular = l.ativo ? (livre ? Html.botaoIcone('emprestar', l.id, 'arrow-left-right', 'Emprestar') : Html.botaoIcone('reservar', l.id, 'bookmark-plus', 'Reservar')) : '';
    return `${Html.botaoIcone('ver', l.id, 'eye', 'Ver detalhes')}${Html.botaoIcone('editar', l.id, 'pencil', 'Editar livro')}${circular}${admin ? (l.ativo ? Html.botaoIcone('arquivar', l.id, 'archive', 'Arquivar livro', true) : Html.botaoIcone('restaurar', l.id, 'arrow-counterclockwise', 'Restaurar livro')) : ''}${admin ? Html.botaoIcone('excluir', l.id, 'trash3', 'Excluir livro', true) : ''}`;
  }

  override async acao(nome: string, el: HTMLElement): Promise<void> {
    const e = this.ctx.estado;
    const livro = this.achar(e.livros, el);
    switch (nome) {
      case 'novo': this.formulario({}); return;
      case 'atualizar-lista': await this.tentarRecarga(); return;
      case 'importar': this.formulario(JSON.parse(el.dataset.dados || '{}') as Registro); return;
      case 'editar': this.formulario(livro); return;
      case 'ver': this.detalhes(livro); return;
      case 'visao': this.visao = el.dataset.valor === 'lista' ? 'lista' : 'grade'; this.numeroPagina = 1; this.ctx.redesenhar(); return;
      case 'emprestar': (this.ctx.pagina('loans') as PaginaEmprestimos).novo({ livro_id: livro.id }); return;
      case 'reservar': (this.ctx.pagina('reservations') as PaginaReservas).novo({ livro_id: livro.id }); return;
      case 'arquivar':
        await this.confirmarEExecutar({ titulo: 'Arquivar livro?', mensagem: `"${livro.titulo}" sairá das listas de empréstimo. Você pode restaurá-lo depois.`, rotulo: 'Arquivar' }, 'books:archive', livro.id, 'Livro arquivado.'); return;
      case 'restaurar': await this.executar('books:restore', livro.id, 'Livro restaurado ao acervo.'); return;
      case 'excluir':
        await this.confirmarEExecutar({ titulo: 'Excluir livro definitivamente?', mensagem: `"${livro.titulo}" será apagado. Livros com histórico de empréstimos ou reservas só podem ser arquivados.`, rotulo: 'Excluir' }, 'books:delete', livro.id, 'Livro excluído.'); return;
      case 'meta-titulo': await this.consultar('titulo'); return;
      case 'meta-isbn': await this.consultar('isbn'); return;
      case 'meta-escolher': await this.escolherCandidato(Number(el.dataset.id)); return;
      default: await super.acao(nome, el);
    }
  }

  private detalhes(l: Registro): void {
    if (!l.id) return;
    const e = this.ctx.estado;
    const historico = e.emprestimos.filter(x => String(x.livro_id) === String(l.id)).slice(0, 5);
    Ui.abrirFormulario({
      kicker: 'LIVRO', titulo: 'Detalhes do livro', somenteLeitura: true, tamanho: 'lg',
      corpo: `<div class="detail-hero">${Html.capa(l.capa_url, 'cover-detail', l.isbn)}<div><h3>${Util.esc(l.titulo)}</h3><p class="small-muted">${Util.esc(l.autores || 'Autoria não informada')}</p>${this.situacao(l)}</div></div>
        <div class="detail-grid">${Html.detalhe('Editora', l.editora || '—')}${Html.detalhe('ISBN', l.isbn || '—')}${Html.detalhe('Ano', l.ano_publicacao || '—')}${Html.detalhe('Gênero', l.genero || '—')}
        ${Html.detalhe('Exemplares', String(Util.numero(l.quantidade)))}${Html.detalhe('Emprestados', String(Util.numero(l.emprestados)))}${Html.detalhe('Separados p/ reserva', String(Util.numero(l.separados)))}${Html.detalhe('Na fila', String(Util.numero(l.na_fila)))}</div>
        <div class="field-block"><span class="field-label">Últimos empréstimos</span>${historico.length ? historico.map(h => `<div class="mini-row"><b>${Util.esc(h.leitor)}</b><span>${Util.data(h.data_retirada)} → ${Util.data(h.data_devolucao || h.data_prevista)}</span>${Html.pill(h.situacao === 'devolvido' ? 'Devolvido' : h.situacao === 'atrasado' ? 'Atrasado' : 'Em dia', h.situacao === 'devolvido' ? 'neutral' : h.situacao === 'atrasado' ? 'danger' : 'success')}</div>`).join('') : '<span class="small-muted">Ainda não foi emprestado.</span>'}</div>`
    });
  }

  formulario(r: Registro): void {
    const e = this.ctx.estado;
    this.eventosMetadados?.abort();
    const eventos = this.eventosMetadados = new AbortController();
    this.novaRodada();
    this.salvandoMetadados = null;
    this.candidatos = [];
    this.editados.clear();
    this.sugeridos.clear();
    this.anoEmConferencia = false;
    this.autoresSugeridos = [];
    this.cancelarConsultaAgendada();
    this.isbnFormulario = isbn13Assistido(r.isbn);
    this.statusDaBuscaTitulo = false;
    this.generos = GeneroAssistido.doAcervo(e.livros);
    const capa = Util.urlCapa(r.capa_url || r.capa) || '';
    const previa = r.id ? Html.capa(capa, 'cover-preview', r.isbn) : Html.capaPesquisa(capa, 'cover-preview', r.isbn);
    const status = document.createElement('p');
    status.id = 'metadata-save-status';
    status.className = 'w-100 m-0 small text-warning-emphasis';
    status.setAttribute('role', 'status');
    status.tabIndex = -1;
    let gravado = false;
    Ui.abrirFormulario({
      kicker: 'LIVRO', titulo: r.id ? 'Editar livro' : 'Cadastrar livro', tamanho: 'xl', rotuloSalvar: r.id ? 'Salvar alterações' : 'Cadastrar livro',
      corpo: `${Html.secao('magic', 'Consulte pelo ISBN ou busque pelo título e escolha a edição. Só os campos vazios serão sugeridos.')}
        <input type="hidden" name="capa_url" id="field-capa_url" value="${Util.esc(capa)}" />
        <div class="two-fields">${Html.campo('titulo', 'Título do livro *', r.titulo, 'text', 'required maxlength="240"')}${Html.campo('isbn', 'ISBN (10 ou 13 dígitos)', r.isbn, 'text', 'maxlength="20"')}</div>
        <div class="d-flex gap-2 mb-2 flex-wrap"><button type="button" class="btn btn-sm btn-outline-primary" data-action="books.meta-titulo"><i class="bi bi-search me-1"></i> Buscar pelo título</button><button type="button" class="btn btn-sm btn-outline-primary" data-action="books.meta-isbn"><i class="bi bi-upc-scan me-1"></i> Consultar ISBN</button></div>
        <div id="metadata-status" class="small-muted mb-2" role="status">Sugestões externas devem ser conferidas antes de salvar.</div>
        <div id="metadata-resultados" class="d-none gap-2 mb-3" role="group" aria-label="Edições encontradas"></div>
        <div class="two-fields">${Html.campo('genero', 'Gênero', r.genero, 'text', 'maxlength="80" list="lista-generos" aria-describedby="metadata-genero-status"')}<datalist id="lista-generos">${this.generos.map(g => `<option value="${Util.esc(g)}"></option>`).join('')}</datalist>${Html.campo('ano_publicacao', 'Ano de publicação da edição', r.ano_publicacao || r.ano, 'number', `min="1450" max="${new Date().getFullYear() + 2}" step="1" aria-describedby="metadata-ano-status"`)}</div>
        <div class="two-fields"><div id="metadata-genero-status" class="form-text mb-2" role="status"></div><div id="metadata-ano-status" class="form-text mb-2" role="status"></div></div>
        <div class="two-fields">${Html.campo('quantidade', 'Exemplares *', r.quantidade || 1, 'number', 'min="1" max="10000" required')}${Html.selecao('editora_id', 'Editora cadastrada', e.editoras, r.editora_id)}</div>
        ${Html.campo('editora_nome', 'Ou criar editora automaticamente', r.editora_nome || r.editora_sugerida || '', 'text', 'maxlength="160" aria-describedby="metadata-editora-status"')}
        <div id="metadata-editora-status" class="form-text mb-2" role="status"></div>
        ${Html.checks('autor_ids', 'Autores já cadastrados', e.autores, r.autor_ids)}
        ${Html.campo('autores_nomes', 'Ou criar autores automaticamente (separe por vírgula)', r.autores_nomes || '', 'text', 'maxlength="500" placeholder="Ex.: Machado de Assis, Clarice Lispector"')}
        <div class="cover-preview-row"><div id="book-cover-preview">${previa}</div><div class="cover-preview-info"><b>Prévia da capa</b><p id="cover-preview-status" role="status">${capa ? 'Prévia da capa do formulário.' : 'Digite o ISBN completo ou busque pelo título.'}</p><small>Sem capa pública, o app mostra um ícone de livro.</small></div></div>`,
      statusEnvioEmSegundoPlano: status,
      salvar: async form => {
        if (gravado) return false;

        const adiados: (() => void)[] = this.salvandoMetadados = [];
        const rodada = this.rodadaMetadados;
        const campoIsbn = this.campoMetadado('isbn');
        const isbn = campoIsbn?.value ?? '';
        const agendada = this.temporizadorIsbn !== undefined;
        this.cancelarConsultaAgendada();
        const pendentes = agendada || [...this.pendentesMetadados].some(podeAplicar => podeAplicar());
        const anoPendente = this.anoEmConferencia && !!this.sugeridos.get('ano_publicacao');
        const aviso = [pendentes ? 'Sugestões pendentes não foram incluídas no envio.' : '',
          anoPendente ? 'O ano sugerido não foi gravado porque ainda não foi confirmado pelo ISBN.' : ''].filter(Boolean).join(' ');
        const focoAnterior = document.activeElement;
        const bloqueados: (HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement)[] = [];
        const formularioAtual = (): boolean => !eventos.signal.aborted && form.contains(status)
          && !form.closest('[data-fechar-ao-mostrar]');
        const envioAtual = (): boolean => formularioAtual() && this.rodadaAtual(rodada)
          && campoIsbn === this.campoMetadado('isbn');
        let identificacao = '';
        try {

          const f = new FormData(form);
          const dados: Registro = Object.fromEntries(f.entries());
          if (anoPendente && dados.ano_publicacao === this.sugeridos.get('ano_publicacao')) dados.ano_publicacao = '';
          const tituloEnviado = String(dados.titulo ?? '').trim();
          const isbnEnviado = String(dados.isbn ?? '').trim();
          identificacao = tituloEnviado ? `“${tituloEnviado}”` : 'cadastro sem título';
          if (isbnEnviado) identificacao += ` (ISBN ${isbnEnviado})`;
          dados.autor_ids = f.getAll('autor_ids').map(Number);
          if (dados.editora_id) dados.editora_nome = '';
          const nomes = String(f.get('autores_nomes') || '');
          dados.autores_nomes = this.sugeridos.get('autores_nomes') === nomes
            ? this.autoresSugeridos : nomes.split(',').map(s => s.trim()).filter(Boolean);
          if (r.id) dados.id = r.id;

          status.textContent = ['Salvando livro… Fechar pelo botão, pelo X ou com Esc não cancela o envio.', aviso].filter(Boolean).join(' ');
          status.focus();
          for (const controle of form.querySelectorAll<typeof bloqueados[number]>('#modal-fields :is(input, select, textarea, button):enabled')) {
            bloqueados.push(controle);
            controle.disabled = true;
          }
          await Api.chamar('books:save', dados);
          gravado = true;
        } catch (erro) {
          if (this.ctx.pagina('books') !== this) return false;
          if (this.salvandoMetadados === adiados) {
            this.salvandoMetadados = null;
            if (envioAtual()) {
              for (const controle of bloqueados) controle.disabled = false;
              status.textContent = '';
              if (campoIsbn?.value === isbn) {
                for (const aplicar of adiados) aplicar();
                if (agendada) this.agendarConsultaIsbn(isbn);
              } else this.novaRodada();

              if (document.activeElement === status) window.setTimeout(() => {
                if (!envioAtual() || this.salvandoMetadados || document.activeElement !== status) return;
                const foco = focoAnterior instanceof HTMLElement && form.contains(focoAnterior)
                  && !focoAnterior.matches(':disabled') ? focoAnterior : this.campoMetadado('titulo');
                foco?.focus();
              }, 0);
            }
          }
          if (!formularioAtual()) {
            const acao = r.id ? 'atualizar' : 'cadastrar';
            Ui.toast(`Não foi possível ${acao} ${identificacao}. ${(erro as Error).message}`, true);
            return false;
          }
          throw erro;
        }
        if (formularioAtual()) status.textContent = 'Livro salvo. Atualizando a lista do acervo…';
        const listaAtualizada = await this.recarregarAcervo(this, formularioAtual);
        if (this.ctx.pagina('books') !== this) return false;
        const aberto = formularioAtual();
        const resultado = r.id ? 'Livro atualizado' : 'Livro cadastrado';
        this.avisarLivroSalvo([`${resultado}: ${identificacao}.`, aviso].filter(Boolean).join(' '), listaAtualizada);
        return aberto ? undefined : false;
      },
      aoFechar: () => {
        eventos.abort();
        if (this.eventosMetadados !== eventos) return;
        this.cancelarConsultaAgendada();
        this.novaRodada();
        this.salvandoMetadados = null;
      }
    });
    document.querySelector('#form-modal')?.addEventListener('hide.bs.modal', () => {
      eventos.abort();
      this.cancelarConsultaAgendada();
    }, { signal: eventos.signal });
    const registrarSelecaoEditora = (): void => {
      this.editados.add('editora_id');
      this.sugeridos.delete('editora_id');
      const campo = this.campoMetadado('editora_nome');
      const selecionou = !!document.querySelector<HTMLSelectElement>('#field-editora_id')?.value;
      if (selecionou && campo && this.sugeridos.get('editora_nome') === campo.value) {
        campo.value = '';
        this.sugeridos.delete('editora_nome');
      }
      this.statusEditora(selecionou && campo?.value.trim() ? 'Ao salvar, será usada a editora cadastrada selecionada.' : '');
    };
    const selecaoEditora = document.querySelector('#field-editora_id');
    for (const evento of ['input', 'change']) selecaoEditora?.addEventListener(evento, registrarSelecaoEditora, { signal: eventos.signal });
    const campoGenero = this.campoMetadado('genero');
    for (const evento of ['input', 'change']) campoGenero?.addEventListener(evento, () => {
      this.editados.add('genero');
      this.sugeridos.delete('genero');
      this.statusGenero('');
    }, { signal: eventos.signal });
    document.querySelector('#modal-form')?.addEventListener('change', evento => {
      if (evento.target instanceof HTMLInputElement && evento.target.name === 'autor_ids') this.editados.add('autor_ids');
    }, { signal: eventos.signal });
    document.querySelector('#modal-form')?.addEventListener('input', evento => {
      const alvo = evento.target;
      if (!(alvo instanceof HTMLInputElement || alvo instanceof HTMLTextAreaElement)) return;
      this.editados.add(alvo.name);
      this.sugeridos.delete(alvo.name);
      if (alvo.name === 'ano_publicacao') { this.anoEmConferencia = false; this.statusAno(''); }
      if (alvo.name === 'editora_nome') this.statusEditora(document.querySelector<HTMLSelectElement>('#field-editora_id')?.value
        ? 'Ao salvar, será usada a editora cadastrada selecionada.' : '');
      if (alvo.name === 'titulo') {
        this.limparCandidatos();

        if (this.isbnFormulario) {
          if (this.statusDaBuscaTitulo) this.statusMetadados('Confira o título e o ISBN antes de consultar.');
          return;
        }
      } else if (alvo.name === 'isbn') {
        const codigo = isbn13Assistido(alvo.value);
        if (codigo && codigo === this.isbnFormulario) return;
        this.isbnFormulario = codigo;
        this.limparCandidatos();
      } else {
        return;
      }
      this.cancelarConsultaAgendada();
      this.novaRodada();
      this.limparSugestoes();
      this.statusMetadados('Confira o título e o ISBN antes de consultar.');
      if (alvo.name === 'isbn') this.agendarConsultaIsbn(alvo.value);
    }, { signal: eventos.signal });
  }

  async usarResultadoPesquisa(edicao: EdicaoAssistida): Promise<void> {
    this.formulario({});
    await this.complementar(edicao, this.novaRodada());
  }

  private campoMetadado(nome: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null {
    return document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#modal-fields #field-${nome}`);
  }

  private statusMetadados(texto: string, daBuscaTitulo = false): void {
    this.statusDaBuscaTitulo = daBuscaTitulo;
    const status = document.querySelector('#metadata-status');
    if (status) status.textContent = texto;
  }

  private rodadaAtual(rodada: number): boolean {
    return rodada === this.rodadaMetadados && !this.eventosMetadados?.signal.aborted && Ui.formularioAberto()
      && !!document.querySelector('#metadata-editora-status') && !document.querySelector('#form-modal[data-fechar-ao-mostrar]');
  }

  private novaRodada(): number {
    this.pendentesMetadados.clear();
    return ++this.rodadaMetadados;
  }

  private iniciarSugestao(rodada: number, podeAplicar: () => boolean = () => true): (aplicar: () => void) => void {
    this.pendentesMetadados.add(podeAplicar);
    return aplicar => {
      this.pendentesMetadados.delete(podeAplicar);
      if (!this.rodadaAtual(rodada)) return;
      if (this.salvandoMetadados) this.salvandoMetadados.push(() => {
        if (this.rodadaAtual(rodada)) aplicar();
      });
      else aplicar();
    };
  }

  private statusEditora(texto: string): void {
    const status = document.querySelector('#metadata-editora-status');
    if (status) status.textContent = texto;
  }

  private podeSugerirCampo(nome: string, revisar = false): boolean {
    const campo = this.campoMetadado(nome);
    return !!campo && !this.editados.has(nome)
      && (!campo.value.trim() || (revisar && this.sugeridos.get(nome) === campo.value));
  }

  private registrarSugestao(nome: string, valor: string): void {
    const campo = this.campoMetadado(nome);
    if (!campo) return;
    campo.value = valor;
    if (valor) this.sugeridos.set(nome, campo.value);
    else this.sugeridos.delete(nome);
  }

  private podeSugerirEditora(revisar = false): boolean {
    return this.podeSugerirCampo('editora_nome', revisar) && this.podeSugerirCampo('editora_id', revisar);
  }

  private sugerirEditora(edicao: EdicaoAssistida, rodada: number, revisar = false): void {
    const aplicar = (): void => {
      if (!this.rodadaAtual(rodada) || !this.podeSugerirEditora(revisar)) return;
      if (edicao.nome) {
        const chave = (nome: string): string => Util.semAcento(nome).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        const nomes = this.ctx.estado.editoras.filter(r => chave(String(r.nome ?? '')) === chave(edicao.nome!));
        const id = nomes.length === 1 ? String(nomes[0].id) : '';
        this.registrarSugestao('editora_id', id);
        this.registrarSugestao('editora_nome', id ? '' : edicao.nome);
      }
      this.statusEditora(edicao.nome ? `Editora encontrada: ${edicao.nome}` : edicao.texto);
    };
    aplicar();
    if (edicao.nome === undefined && edicao.consulta && this.podeSugerirEditora(revisar)) {
      const concluir = this.iniciarSugestao(rodada, () => this.podeSugerirEditora(revisar));
      void edicao.consulta.then(() => concluir(aplicar));
    }
  }

  private statusGenero(texto: string): void {
    const status = document.querySelector('#metadata-genero-status');
    if (status && status.textContent !== texto) status.textContent = texto;
  }

  private avisarGeneroNaoConfirmado(): void {
    this.statusGenero(this.podeSugerirCampo('genero') ? GeneroAssistido.naoConfirmado : '');
  }

  private sugerirGenero(edicao: EdicaoAssistida, rodada: number, revisar = false): void {
    const aplicar = (): void => {
      if (!this.rodadaAtual(rodada) || !this.podeSugerirCampo('genero', revisar)) return;
      const nome = edicao.genero.nome(this.generos);
      if (nome) this.registrarSugestao('genero', nome);
      this.statusGenero(edicao.genero.texto(this.generos));
    };
    aplicar();
    if (edicao.genero.consulta && this.podeSugerirCampo('genero', revisar)) {
      const concluir = this.iniciarSugestao(rodada, () => this.podeSugerirCampo('genero', revisar));
      void edicao.genero.consulta.then(() => concluir(aplicar));
    }
  }

  private statusAno(texto: string): void {
    const status = document.querySelector('#metadata-ano-status');
    if (status) status.textContent = texto;
  }

  private aplicarAno(livro: ResultadoBibliografico, porIsbn: boolean): void {
    if (!this.podeSugerirCampo('ano_publicacao', porIsbn)) return;
    const ano = livro.ano;
    if (isbn13Assistido(livro.isbn) && typeof ano === 'number' && Number.isInteger(ano)
        && ano >= 1450 && ano <= new Date().getFullYear() + 2) {
      this.registrarSugestao('ano_publicacao', String(ano));
      this.anoEmConferencia = !porIsbn;
      this.statusAno(porIsbn ? `Ano da edição: ${ano}${livro.fonteAno ? ` (${livro.fonteAno})` : ''}.`
        : 'Ano informado na busca por título; conferindo pelo ISBN.');
    } else {
      if (porIsbn) { this.registrarSugestao('ano_publicacao', ''); this.anoEmConferencia = false; }
      this.statusAno('Ano da edição não confirmado. Você pode preenchê-lo manualmente.');
    }
  }

  private limparSugestoes(): void {
    for (const [nome, valor] of this.sugeridos) {
      const campo = this.campoMetadado(nome);
      if (campo?.value === valor) campo.value = '';
    }
    this.sugeridos.clear();
    this.anoEmConferencia = false;
    this.autoresSugeridos = [];
    this.atualizarCapa();
    this.statusEditora('');
    this.avisarGeneroNaoConfirmado();
    this.statusAno('');
  }

  private limparCandidatos(): void {
    ++this.revisaoBuscaTitulo;
    this.candidatos = [];
    const caixa = document.querySelector<HTMLElement>('#metadata-resultados');
    if (caixa) { caixa.replaceChildren(); caixa.classList.remove('d-grid'); caixa.classList.add('d-none'); }
  }

  private cancelarConsultaAgendada(): void {
    clearTimeout(this.temporizadorIsbn);
    this.temporizadorIsbn = undefined;
  }

  private agendarConsultaIsbn(valor: string): void {
    if (this.salvandoMetadados || !isbn13Assistido(valor)) return;
    this.temporizadorIsbn = window.setTimeout(() => {
      this.temporizadorIsbn = undefined;
      void this.consultar('isbn');
    }, 750);
  }

  private async consultar(tipo: 'titulo' | 'isbn'): Promise<void> {
    if (this.salvandoMetadados) return;
    const porTitulo = tipo === 'titulo';
    const campo = this.campoMetadado(tipo);
    const valor = campo?.value.trim();
    if (!valor) {
      if (tipo === 'isbn') this.avisarGeneroNaoConfirmado();
      Ui.toast(tipo === 'titulo' ? 'Informe um título.' : 'Informe um ISBN.', true);
      return;
    }
    this.cancelarConsultaAgendada();
    this.limparCandidatos();

    const rodada = porTitulo ? this.rodadaMetadados : this.novaRodada();
    const revisao = this.revisaoBuscaTitulo;
    const codigo = porTitulo ? null : isbn13Assistido(valor);
    if (!porTitulo && !codigo) {
      this.statusMetadados('Confira o ISBN: ele precisa ter 10 ou 13 dígitos e o dígito verificador correto.');
      return;
    }
    const buscaAtual = (): boolean => campo === this.campoMetadado(tipo) && (porTitulo
      ? revisao === this.revisaoBuscaTitulo && valor === campo?.value.trim()
      : codigo ? codigo === isbn13Assistido(campo?.value) : valor === campo?.value.trim());
    this.statusMetadados('Consultando as bases bibliográficas...', porTitulo);
    const concluir = this.iniciarSugestao(rodada, buscaAtual);
    try {
      if (porTitulo) {
        const resultados = await Api.chamar<ResultadoBibliografico[]>('apis:titulo', valor);
        concluir(() => { if (buscaAtual()) this.mostrarCandidatos(resultados.map(livro => new EdicaoAssistida(livro)), rodada); });
      } else {
        const livro = await Api.chamar<ResultadoBibliografico>('apis:isbn', valor);
        if (!codigo || codigo !== isbn13Assistido(livro.isbn)) {
          throw new Error('O resultado não confirma o ISBN preenchido.');
        }
        concluir(() => {
          if (!buscaAtual()) return;
          this.aplicarMetadados(livro, false, true);
          const edicao = new EdicaoAssistida(livro, valor);
          this.sugerirEditora(edicao, rodada, true);
          this.sugerirGenero(edicao, rodada, true);
          this.mostrarCandidatos([edicao], rodada, true);
        });
      }
    } catch (erro) {
      concluir(() => {
        if (!buscaAtual()) return;
        this.statusMetadados((erro as Error).message, porTitulo);
        if (porTitulo && this.isbnFormulario) return;
        if (this.podeSugerirEditora()) this.statusEditora(EdicaoAssistida.naoConfirmada);
        this.avisarGeneroNaoConfirmado();
      });
    }
  }

  private mostrarCandidatos(resultados: EdicaoAssistida[], rodada: number, porIsbn = false): void {
    this.candidatos = resultados;
    const caixa = document.querySelector<HTMLElement>('#metadata-resultados');
    if (!caixa) return;
    caixa.classList.toggle('d-none', !resultados.length);
    caixa.classList.toggle('d-grid', !!resultados.length);
    for (const [i, edicao] of this.candidatos.entries()) {
      const { livro } = edicao;
      const linha = document.createElement('div'), botao = document.createElement(porIsbn ? 'div' : 'button'), detalhe = document.createElement('small');
      const info = document.createElement('div'), editora = document.createElement('small'), genero = document.createElement('small');
      linha.className = 'result-card';
      linha.innerHTML = Html.capaPesquisa(livro.capa, 'cover-large', livro.isbn);
      info.className = 'result-text flex-grow-1';
      if (botao instanceof HTMLButtonElement) {
        botao.type = 'button';
        botao.className = 'btn btn-soft text-start w-100 text-break';
        botao.dataset.action = 'books.meta-escolher';
        botao.dataset.id = String(i);
      } else botao.className = 'fw-bold';
      botao.textContent = livro.titulo;
      detalhe.className = 'd-block small-muted';
      detalhe.textContent = [livro.autores.join(', '), livro.ano ? `Ano da edição: ${livro.ano}` : 'Ano da edição não confirmado',
        livro.isbn ? `ISBN ${livro.isbn}` : 'ISBN não informado', livro.origem].filter(Boolean).join(' · ');
      editora.className = 'd-block small-muted text-break px-2';
      editora.id = `metadata-candidato-editora-${i}`;
      editora.textContent = edicao.texto;
      genero.className = editora.className;
      genero.id = `metadata-candidato-genero-${i}`;
      genero.textContent = edicao.genero.texto(this.generos);
      if (!porIsbn) botao.setAttribute('aria-describedby', `${editora.id} ${genero.id}`);
      if (edicao.consulta) {
        editora.setAttribute('role', 'status');
        void edicao.consulta.then(() => {
          if (this.rodadaAtual(rodada) && this.candidatos[i] === edicao) editora.textContent = edicao.texto;
        });
      }
      if (edicao.genero.consulta) {
        genero.setAttribute('role', 'status');
        void edicao.genero.consulta.then(() => {
          if (this.rodadaAtual(rodada) && this.candidatos[i] === edicao) genero.textContent = edicao.genero.texto(this.generos);
        });
      }
      botao.append(detalhe);
      info.append(botao, editora, genero);
      linha.append(info);
      caixa.append(linha);
    }
    if (!porIsbn) this.statusMetadados(resultados.length ? 'Confira o ISBN, a editora e o ano antes de escolher um resultado.' : 'Nenhum resultado por título. Tente outro termo, informe o ISBN ou preencha manualmente.', true);
    if (!resultados.length && !this.isbnFormulario) {
      if (this.podeSugerirEditora()) this.statusEditora(EdicaoAssistida.naoConfirmada);
      this.avisarGeneroNaoConfirmado();
    }
  }

  private async escolherCandidato(indice: number): Promise<void> {
    if (this.salvandoMetadados) return;
    const edicao = this.candidatos[indice];
    if (!edicao) return;
    const { livro } = edicao;
    const digitado = this.campoMetadado('isbn')?.value.trim();

    const codigo = isbn13Assistido(digitado);
    if (digitado && (!codigo || codigo !== isbn13Assistido(livro.isbn))) {
      this.statusMetadados('O resultado não confirma o ISBN preenchido. Consulte pelo ISBN ou confira o código antes de escolher.', true);
      this.avisarGeneroNaoConfirmado();
      return;
    }
    this.limparCandidatos();

    if (!codigo && this.sugeridos.size) this.limparSugestoes();
    this.campoMetadado('titulo')?.focus();
    await this.complementar(edicao, this.novaRodada());
  }

  private async complementar(edicao: EdicaoAssistida, rodada: number): Promise<void> {
    if (!this.rodadaAtual(rodada)) return;
    const base = edicao.livro;
    const porIsbn = !!edicao.isbnConsultado;
    this.aplicarMetadados(base, false, porIsbn);
    this.sugerirEditora(edicao, rodada);
    this.sugerirGenero(edicao, rodada);
    if (!base.isbn || porIsbn) return;
    const campoIsbn = this.campoMetadado('isbn');
    const isbn = isbn13Assistido(campoIsbn?.value);
    const mesmoIsbn = (): boolean => campoIsbn === this.campoMetadado('isbn') && isbn13Assistido(campoIsbn?.value) === isbn;
    const concluir = this.iniciarSugestao(rodada, mesmoIsbn);
    this.statusMetadados('Conferindo a edição pelo ISBN...');
    let livro: ResultadoBibliografico | null = null;
    try {
      const dados = await Api.chamar<ResultadoBibliografico>('apis:isbn', base.isbn);
      const isbnBase = isbn13Assistido(base.isbn);
      if (isbnBase && isbnBase === isbn13Assistido(dados.isbn) && Util.titulosCompativeis(base.titulo, dados.titulo)) {
        const autores = base.autores.length ? base.autores : dados.autores;
        const capa = base.capa ?? dados.capa;
        livro = { ...dados, autores, capa };
      }
    } catch {   }
    concluir(() => {
      if (!mesmoIsbn()) return;
      if (!livro) {
        this.statusMetadados('Não foi possível conferir a edição pelo ISBN. Revise os dados sugeridos antes de salvar.');
        if (this.sugeridos.has('ano_publicacao')) this.statusAno('Ano não conferido pelo ISBN. Confira na ficha do livro.');
        return;
      }
      this.aplicarMetadados(livro, true, true);
      const confirmada = new EdicaoAssistida(livro, base.isbn);
      this.sugerirEditora(confirmada, rodada, true);
      this.sugerirGenero(confirmada, rodada, true);
    });
  }

  private aplicarMetadados(livro: ResultadoBibliografico, complemento = false, porIsbn = false): void {
    const preencher = (nome: string, conteudo: unknown): boolean => {
      const campo = this.campoMetadado(nome);
      if (!campo || campo.value.trim() || this.editados.has(nome) || !conteudo) return false;
      campo.value = String(conteudo);
      this.sugeridos.set(nome, campo.value);
      return true;
    };
    preencher('titulo', livro.titulo);
    if (preencher('isbn', livro.isbn)) this.isbnFormulario = isbn13Assistido(livro.isbn);
    this.aplicarAno(livro, porIsbn);
    const novaCapa = preencher('capa_url', Util.urlCapa(livro.capa));
    if (!this.editados.has('autor_ids') && !document.querySelector('#modal-fields [name="autor_ids"]:checked') && !this.sugeridos.has('autores_nomes')) {
      const nomes: string[] = [];
      for (const nome of livro.autores) {
        if ([...nomes, nome].join(', ').length > 500) break;
        nomes.push(nome);
      }
      preencher('autores_nomes', nomes.join(', '));
      if (this.sugeridos.has('autores_nomes')) this.autoresSugeridos = nomes;
    }
    if (!complemento || novaCapa) this.atualizarCapa(livro);
    this.statusMetadados(`Fontes: ${livro.origem}. Revise os dados antes de salvar. Campos sem sugestão podem ser preenchidos manualmente.`);
  }

  private atualizarCapa(livro?: ResultadoBibliografico): void {
    const capa = this.campoMetadado('capa_url')?.value;
    const caixa = document.querySelector('#book-cover-preview');

    const isbn = livro && (!capa || this.sugeridos.get('capa_url') === capa) ? livro.isbn : '';
    if (caixa) caixa.innerHTML = Html.capaPesquisa(capa, 'cover-preview', isbn);
    const status = document.querySelector('#cover-preview-status');
    if (status) status.textContent = capa ? 'Prévia da capa do formulário.' : 'Sem capa selecionada.';
  }
}
