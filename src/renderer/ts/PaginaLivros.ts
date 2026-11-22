class PaginaLivros extends PaginaBase {
  readonly id = 'books' as const;
  readonly nome = 'Acervo de livros';
  protected override filtroPadrao = 'ativos';
  protected override filtro = 'ativos';
  private visao: 'grade' | 'lista' = 'grade';
  private ordem = 'recentes';
  private temporizadorIsbn: number | undefined;
  private ultimoIsbn = '';
  private rodadaMetadados = 0;
  private candidatos: ResultadoBibliografico[] = [];
  private eventosMetadados?: AbortController;
  private editados = new Set<string>();
  private sugeridos = new Map<string, string>();
  private autoresSugeridos: string[] = [];

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
    return `${Html.cabecalho('Acervo de livros', 'Cadastre, organize e acompanhe cada exemplar da biblioteca.', Html.botao('novo', 'Adicionar livro', 'plus-lg'))}
      <div class="surface">${Html.barra({ busca: this.busca, atual: this.filtro, extra, placeholder: 'Título, autor, ISBN, gênero...', filtros: [['ativos', 'Ativos'], ['indisponiveis', 'Indisponíveis'], ['arquivados', 'Arquivados'], ['todos', 'Todos']] })}${this.area()}</div>`;
  }

  override entrada(nome: string, valor: string): void {
    if (nome === 'ordem') { this.ordem = valor; this.numeroPagina = 1; this.atualizarLista(); }
    else if (nome === 'isbn') this.aoDigitarIsbn(valor);
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
        ${l.sinopse ? `<div class="field-block"><span class="field-label">Sinopse</span><p class="synopsis">${Util.esc(l.sinopse)}</p></div>` : ''}
        <div class="field-block"><span class="field-label">Últimos empréstimos</span>${historico.length ? historico.map(h => `<div class="mini-row"><b>${Util.esc(h.leitor)}</b><span>${Util.data(h.data_retirada)} → ${Util.data(h.data_devolucao || h.data_prevista)}</span>${Html.pill(h.situacao === 'devolvido' ? 'Devolvido' : h.situacao === 'atrasado' ? 'Atrasado' : 'Em dia', h.situacao === 'devolvido' ? 'neutral' : h.situacao === 'atrasado' ? 'danger' : 'success')}</div>`).join('') : '<span class="small-muted">Ainda não foi emprestado.</span>'}</div>`
    });
  }

  formulario(r: Registro): void {
    const e = this.ctx.estado;
    this.eventosMetadados?.abort();
    const eventos = this.eventosMetadados = new AbortController();
    this.rodadaMetadados++;
    this.candidatos = [];
    this.editados.clear();
    this.sugeridos.clear();
    this.autoresSugeridos = [];
    clearTimeout(this.temporizadorIsbn);
    this.ultimoIsbn = '';
    const generos = [...new Set(e.livros.map(l => String(l.genero || '')).filter(Boolean))];
    const capa = r.capa_url || r.capa || '';
    Ui.abrirFormulario({
      kicker: 'LIVRO', titulo: r.id ? 'Editar livro' : 'Cadastrar livro', tamanho: 'xl', rotuloSalvar: r.id ? 'Salvar alterações' : 'Cadastrar livro',
      corpo: `${Html.secao('magic', 'Consulte pelo ISBN ou busque pelo título e escolha a edição. Só os campos vazios serão sugeridos.')}
        <input type="hidden" name="capa_url" id="field-capa_url" value="${Util.esc(capa)}" />
        <div class="two-fields">${Html.campo('titulo', 'Título do livro *', r.titulo, 'text', 'required maxlength="240"')}${Html.campo('isbn', 'ISBN (10 ou 13 dígitos)', r.isbn, 'text', 'maxlength="20" data-input="books.isbn" inputmode="numeric"')}</div>
        <div class="d-flex gap-2 mb-2 flex-wrap"><button type="button" class="btn btn-sm btn-outline-primary" data-action="books.meta-titulo"><i class="bi bi-search me-1"></i> Buscar pelo título</button><button type="button" class="btn btn-sm btn-outline-primary" data-action="books.meta-isbn"><i class="bi bi-upc-scan me-1"></i> Consultar ISBN</button></div>
        <div id="metadata-status" class="small-muted mb-2" role="status">Sugestões externas devem ser conferidas antes de salvar.</div>
        <div id="metadata-resultados" class="d-none gap-2 mb-3" role="group" aria-label="Edições encontradas"></div>
        <div class="two-fields">${Html.campo('genero', 'Gênero', r.genero, 'text', 'maxlength="80" list="lista-generos"')}<datalist id="lista-generos">${generos.map(g => `<option value="${Util.esc(g)}"></option>`).join('')}</datalist>${Html.campo('ano_publicacao', 'Ano de publicação', r.ano_publicacao || r.ano, 'number', 'min="1450" max="2100"')}</div>
        <div class="two-fields">${Html.campo('quantidade', 'Exemplares *', r.quantidade || 1, 'number', 'min="1" max="10000" required')}${Html.selecao('editora_id', 'Editora cadastrada', e.editoras, r.editora_id)}</div>
        ${Html.campo('editora_nome', 'Ou criar editora automaticamente', r.editora_nome || r.editora_sugerida || '', 'text', 'maxlength="160" placeholder="Editora informada pela API"')}
        ${Html.checks('autor_ids', 'Autores já cadastrados', e.autores, r.autor_ids)}
        ${Html.campo('autores_nomes', 'Ou criar autores automaticamente (separe por vírgula)', r.autores_nomes || '', 'text', 'maxlength="500" placeholder="Ex.: Machado de Assis, Clarice Lispector"')}
        ${Html.area('sinopse', 'Sinopse / descrição', r.sinopse, 'rows="3" maxlength="3000"')}
        <div class="cover-preview-row"><div id="book-cover-preview">${Html.capa(capa, 'cover-preview', r.isbn)}</div><div class="cover-preview-info"><b>Prévia da capa</b><p id="cover-preview-status">${capa ? 'Capa salva ou recebida da API.' : 'Digite o ISBN completo ou busque pelo título.'}</p><small>Sem capa pública, o app mostra um ícone de livro.</small></div></div>`,
      salvar: async form => {
        const f = new FormData(form);
        const dados: Registro = Object.fromEntries(f.entries());
        dados.autor_ids = f.getAll('autor_ids').map(Number);
        const nomes = String(f.get('autores_nomes') || '');
        dados.autores_nomes = this.sugeridos.get('autores_nomes') === nomes
          ? this.autoresSugeridos : nomes.split(',').map(s => s.trim()).filter(Boolean);
        if (r.id) dados.id = r.id;
        await this.executar('books:save', dados, r.id ? 'Livro atualizado!' : 'Livro cadastrado!');
      },
      aoFechar: () => {
        eventos.abort();
        if (this.eventosMetadados !== eventos) return;
        clearTimeout(this.temporizadorIsbn);
        this.rodadaMetadados++;
      }
    });
    document.querySelector('#modal-form')?.addEventListener('input', evento => {
      const alvo = evento.target;
      if (!(alvo instanceof HTMLInputElement || alvo instanceof HTMLTextAreaElement)) return;
      this.editados.add(alvo.name);
      this.sugeridos.delete(alvo.name);
      if (alvo.name !== 'titulo' && alvo.name !== 'isbn') return;
      this.rodadaMetadados++;
      this.ultimoIsbn = '';
      this.limparCandidatos();
      for (const [nome, valor] of this.sugeridos) {
        const campo = this.campoMetadado(nome);
        if (campo?.value === valor) campo.value = '';
      }
      this.sugeridos.clear();
      this.atualizarCapa();
      this.statusMetadados('Confira o título e o ISBN antes de consultar.');
    }, { signal: eventos.signal });
  }

  async usarResultadoPesquisa(livro: ResultadoBibliografico): Promise<void> {
    this.formulario({});
    await this.complementar(livro, ++this.rodadaMetadados);
  }

  private campoMetadado(nome: string): HTMLInputElement | HTMLTextAreaElement | null {
    return document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#modal-fields #field-${nome}`);
  }

  private statusMetadados(texto: string): void {
    const status = document.querySelector('#metadata-status');
    if (status) status.textContent = texto;
  }

  private rodadaAtual(rodada: number): boolean {
    return rodada === this.rodadaMetadados && !this.eventosMetadados?.signal.aborted && Ui.formularioAberto() && !!this.campoMetadado('titulo');
  }

  private limparCandidatos(): void {
    this.candidatos = [];
    const caixa = document.querySelector<HTMLElement>('#metadata-resultados');
    if (caixa) { caixa.replaceChildren(); caixa.classList.remove('d-grid'); caixa.classList.add('d-none'); }
  }

  private aoDigitarIsbn(valor: string): void {
    if (this.temporizadorIsbn) clearTimeout(this.temporizadorIsbn);
    const codigo = Util.codigoIsbn(valor);
    if (!Util.isbnCompleto(codigo)) { this.ultimoIsbn = ''; return; }
    if (codigo !== this.ultimoIsbn) this.temporizadorIsbn = window.setTimeout(() => void this.consultar('isbn'), 750);
  }

  private async consultar(tipo: 'titulo' | 'isbn'): Promise<void> {
    const valor = this.campoMetadado(tipo)?.value.trim();
    if (!valor) { Ui.toast(tipo === 'titulo' ? 'Informe um título.' : 'Informe um ISBN.', true); return; }
    clearTimeout(this.temporizadorIsbn);
    this.limparCandidatos();
    const rodada = ++this.rodadaMetadados;
    this.statusMetadados('Consultando as bases bibliográficas...');
    try {
      if (tipo === 'titulo') {
        const resultados = await Api.chamar<ResultadoBibliografico[]>('apis:titulo', valor);
        if (this.rodadaAtual(rodada)) this.mostrarCandidatos(resultados);
      } else {
        const livro = await Api.chamar<ResultadoBibliografico>('apis:isbn', valor);
        if (!this.rodadaAtual(rodada)) return;
        this.ultimoIsbn = Util.codigoIsbn(valor);
        this.aplicarMetadados(livro);
      }
    } catch (erro) {
      if (this.rodadaAtual(rodada)) this.statusMetadados((erro as Error).message);
    }
  }

  private mostrarCandidatos(resultados: ResultadoBibliografico[]): void {
    this.candidatos = resultados;
    const caixa = document.querySelector<HTMLElement>('#metadata-resultados');
    if (!caixa) return;
    caixa.classList.toggle('d-none', !resultados.length);
    caixa.classList.toggle('d-grid', !!resultados.length);
    for (const [i, livro] of resultados.entries()) {
      const botao = document.createElement('button'), detalhe = document.createElement('small');
      botao.type = 'button';
      botao.className = 'btn btn-soft text-start';
      botao.dataset.action = 'books.meta-escolher';
      botao.dataset.id = String(i);
      botao.textContent = livro.titulo;
      detalhe.className = 'd-block small-muted';
      detalhe.textContent = [livro.autores.join(', '), livro.editora, livro.ano, livro.isbn ? `ISBN ${livro.isbn}` : 'ISBN não informado', livro.origem].filter(Boolean).join(' · ');
      botao.append(detalhe);
      caixa.append(botao);
    }
    this.statusMetadados(resultados.length ? 'Confira o ISBN, a editora e o ano antes de escolher um resultado.' : 'Nenhum resultado por título. Tente outro termo, informe o ISBN ou preencha manualmente.');
  }

  private async escolherCandidato(indice: number): Promise<void> {
    const livro = this.candidatos[indice];
    if (!livro) return;
    const digitado = Util.codigoIsbn(this.campoMetadado('isbn')?.value ?? '');
    // Uma escolha por título nunca altera o ISBN informado no formulário.
    const equivalente = /^\d{9}[\dX]$/.test(digitado)
      && [...digitado].reduce((soma, c, i) => soma + (c === 'X' ? 10 : Number(c)) * (10 - i), 0) % 11 === 0
      && livro.isbn.slice(0, 12) === `978${digitado.slice(0, 9)}`;
    if (digitado && digitado !== livro.isbn && !equivalente) {
      this.statusMetadados('O resultado não confirma o ISBN preenchido. Consulte pelo ISBN ou confira o código antes de escolher.');
      return;
    }
    this.limparCandidatos();
    this.campoMetadado('titulo')?.focus();
    await this.complementar(livro, ++this.rodadaMetadados);
  }

  private async complementar(base: ResultadoBibliografico, rodada: number): Promise<void> {
    let livro = base;
    if (base.isbn && (!base.autores.length || !base.editora || !base.ano || !base.sinopse || !base.capa)) {
      this.statusMetadados('Buscando os campos ausentes desta edição...');
      try {
        const dados = await Api.chamar<ResultadoBibliografico>('apis:isbn', base.isbn);
        if (dados.isbn === base.isbn) {
          const autores = base.autores.length ? base.autores : dados.autores;
          const editora = base.editora || dados.editora, ano = base.ano ?? dados.ano;
          const sinopse = base.sinopse || dados.sinopse, capa = base.capa ?? dados.capa;
          const mudou = autores !== base.autores || editora !== base.editora || ano !== base.ano || sinopse !== base.sinopse || capa !== base.capa;
          const origem = mudou ? [...new Set([base.origem, dados.origem].flatMap(s => s.split(' + ')))].join(' + ') : base.origem;
          livro = { ...base, autores, editora, ano, sinopse, capa, origem };
        }
      } catch { /* O resultado selecionado ainda pode ser usado como sugestão parcial. */ }
    }
    if (this.rodadaAtual(rodada)) this.aplicarMetadados(livro);
  }

  private aplicarMetadados(livro: ResultadoBibliografico): void {
    const preencher = (nome: string, conteudo: unknown): void => {
      const campo = this.campoMetadado(nome);
      if (!campo || campo.value.trim() || this.editados.has(nome) || !conteudo) return;
      campo.value = String(conteudo);
      this.sugeridos.set(nome, campo.value);
    };
    preencher('titulo', livro.titulo);
    preencher('isbn', livro.isbn);
    preencher('ano_publicacao', livro.ano);
    preencher('sinopse', livro.sinopse);
    preencher('capa_url', livro.capa);
    if (!document.querySelector<HTMLSelectElement>('#field-editora_id')?.value) preencher('editora_nome', livro.editora);
    if (!document.querySelector('#modal-fields [name="autor_ids"]:checked') && !this.sugeridos.has('autores_nomes')) {
      const nomes: string[] = [];
      for (const nome of livro.autores) {
        if ([...nomes, nome].join(', ').length > 500) break;
        nomes.push(nome);
      }
      preencher('autores_nomes', nomes.join(', '));
      if (this.sugeridos.has('autores_nomes')) this.autoresSugeridos = nomes;
    }
    this.atualizarCapa();
    this.statusMetadados(`Fontes: ${livro.origem}. Revise os dados antes de salvar. Campos sem sugestão podem ser preenchidos manualmente.`);
  }

  private atualizarCapa(): void {
    const capa = this.campoMetadado('capa_url')?.value;
    const caixa = document.querySelector('#book-cover-preview');
    if (caixa) caixa.innerHTML = Html.capa(capa, 'cover-preview', capa ? this.campoMetadado('isbn')?.value : '');
    const status = document.querySelector('#cover-preview-status');
    if (status) status.textContent = capa ? 'Prévia da capa do formulário.' : 'Sem capa selecionada.';
  }
}
