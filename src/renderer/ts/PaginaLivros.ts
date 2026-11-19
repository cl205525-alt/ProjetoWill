class PaginaLivros extends PaginaBase {
  readonly id = 'books' as const;
  readonly nome = 'Acervo de livros';
  protected override filtroPadrao = 'ativos';
  protected override filtro = 'ativos';
  private visao: 'grade' | 'lista' = 'grade';
  private ordem = 'recentes';
  private temporizadorIsbn: number | undefined;
  private ultimoIsbn = '';
  private consultando = false;

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
    return `<div class="book-grid">${pagina.map(l => `<article class="book-card ${l.ativo ? '' : 'arquivado'}"><button type="button" class="book-cover-wrap" data-action="ver" data-id="${l.id}" aria-label="Ver detalhes de ${Util.esc(l.titulo)}">${Html.capa(l.capa_url, 'cover-card', l.isbn)}</button>
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
        <div class="detail-grid">${Html.detalhe('Editora', Util.esc(l.editora || '—'))}${Html.detalhe('ISBN', Util.esc(l.isbn || '—'))}${Html.detalhe('Ano', Util.esc(l.ano_publicacao || '—'))}${Html.detalhe('Gênero', Util.esc(l.genero || '—'))}
        ${Html.detalhe('Exemplares', String(Util.numero(l.quantidade)))}${Html.detalhe('Emprestados', String(Util.numero(l.emprestados)))}${Html.detalhe('Separados p/ reserva', String(Util.numero(l.separados)))}${Html.detalhe('Na fila', String(Util.numero(l.na_fila)))}</div>
        ${l.sinopse ? `<div class="field-block"><span class="field-label">Sinopse</span><p class="synopsis">${Util.esc(l.sinopse)}</p></div>` : ''}
        <div class="field-block"><span class="field-label">Últimos empréstimos</span>${historico.length ? historico.map(h => `<div class="mini-row"><b>${Util.esc(h.leitor)}</b><span>${Util.data(h.data_retirada)} → ${Util.data(h.data_devolucao || h.data_prevista)}</span>${Html.pill(h.situacao === 'devolvido' ? 'Devolvido' : h.situacao === 'atrasado' ? 'Atrasado' : 'Em dia', h.situacao === 'devolvido' ? 'neutral' : h.situacao === 'atrasado' ? 'danger' : 'success')}</div>`).join('') : '<span class="small-muted">Ainda não foi emprestado.</span>'}</div>`
    });
  }

  /** Formulário de criar/editar. `prefill` vem de uma API (Google Books / Open Library). */
  formulario(r: Registro): void {
    const e = this.ctx.estado;
    this.ultimoIsbn = '';
    const generos = [...new Set(e.livros.map(l => String(l.genero || '')).filter(Boolean))];
    const capa = r.capa_url || r.capa || '';
    Ui.abrirFormulario({
      kicker: 'LIVRO', titulo: r.id ? 'Editar livro' : 'Cadastrar livro', tamanho: 'xl', rotuloSalvar: r.id ? 'Salvar alterações' : 'Cadastrar livro',
      corpo: `${Html.secao('magic', 'Digite o ISBN completo (preenchimento automático pela Open Library) ou o título (Google Books) para importar os dados.')}
        <input type="hidden" name="capa_url" id="field-capa_url" value="${Util.esc(capa)}" />
        <div class="two-fields">${Html.campo('titulo', 'Título do livro *', r.titulo, 'text', 'required maxlength="240"')}${Html.campo('isbn', 'ISBN (10 ou 13 dígitos)', r.isbn, 'text', 'maxlength="20" data-input="books.isbn" inputmode="numeric"')}</div>
        <div class="d-flex gap-2 mb-2 flex-wrap"><button type="button" class="btn btn-sm btn-outline-primary" data-action="books.meta-titulo"><i class="bi bi-google me-1"></i> Buscar pelo título</button><button type="button" class="btn btn-sm btn-outline-primary" data-action="books.meta-isbn"><i class="bi bi-upc-scan me-1"></i> Consultar ISBN</button></div>
        <div id="metadata-status" class="small-muted mb-3">Sugestões externas devem ser conferidas antes de salvar.</div>
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
        dados.autores_nomes = String(f.get('autores_nomes') || '').split(',').map(s => s.trim()).filter(Boolean);
        if (r.id) dados.id = r.id;
        await this.executar('books:save', dados, r.id ? 'Livro atualizado!' : 'Livro cadastrado!');
      },
      aoFechar: () => { if (this.temporizadorIsbn) clearTimeout(this.temporizadorIsbn); }
    });
  }

  private aoDigitarIsbn(valor: string): void {
    if (this.temporizadorIsbn) clearTimeout(this.temporizadorIsbn);
    const codigo = Util.codigoIsbn(valor);
    if (!Util.isbnCompleto(codigo)) { this.ultimoIsbn = ''; return; }
    if (codigo !== this.ultimoIsbn) this.temporizadorIsbn = window.setTimeout(() => void this.consultar('isbn'), 750);
  }

  private async consultar(tipo: 'titulo' | 'isbn'): Promise<void> {
    if (this.consultando) return;
    const campo = document.querySelector<HTMLInputElement>(tipo === 'titulo' ? '#field-titulo' : '#field-isbn');
    const valor = campo?.value.trim();
    if (!valor) { Ui.toast(tipo === 'titulo' ? 'Informe um título.' : 'Informe um ISBN.', true); return; }
    const status = document.querySelector('#metadata-status');
    if (status) status.textContent = 'Consultando as bases bibliográficas...';
    this.consultando = true;
    try {
      const livro = tipo === 'titulo' ? (await Api.chamar<Registro[]>('apis:google', { consulta: valor, modo: 'titulo' }))[0] : await Api.chamar<Registro>('apis:isbn', valor);
      if (!livro) throw new Error('Nenhum livro encontrado nessa consulta.');
      if (!Ui.formularioAberto() || campo?.value.trim() !== valor) return;
      const preencher = (nome: string, conteudo: unknown): void => {
        const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#field-${nome}`);
        if (input && conteudo !== null && conteudo !== undefined) input.value = String(conteudo);
      };
      preencher('titulo', livro.titulo);
      if (livro.isbn) preencher('isbn', livro.isbn);
      preencher('ano_publicacao', livro.ano || '');
      preencher('sinopse', livro.sinopse || '');
      preencher('capa_url', livro.capa || '');
      preencher('editora_nome', livro.editora || '');
      if (Array.isArray(livro.autores) && livro.autores.length) preencher('autores_nomes', livro.autores.join(', '));
      const caixa = document.querySelector('#book-cover-preview');
      if (caixa) caixa.innerHTML = Html.capa(livro.capa, 'cover-preview', livro.isbn || valor);
      const st = document.querySelector('#cover-preview-status');
      if (st) st.textContent = livro.capa ? 'Prévia da imagem encontrada.' : 'Nenhuma capa encontrada nesta consulta.';
      if (tipo === 'isbn') this.ultimoIsbn = Util.codigoIsbn(valor);
      if (status) status.textContent = `Dados recebidos de ${livro.origem}. Confira antes de salvar.`;
      Ui.toast(livro.capa ? 'Dados e capa carregados. Revise antes de salvar.' : 'Dados carregados; nenhuma capa pública encontrada.');
    } catch (erro) {
      if (status) status.textContent = 'Consulta não concluída. Verifique o ISBN ou tente buscar pelo título.';
      Ui.toast((erro as Error).message, true);
    } finally { this.consultando = false; }
  }
}
