class PaginaExplorar extends PaginaBase {
  readonly id = 'explore' as const;
  readonly nome = 'Descobrir livros';
  private resultados: ResultadoBibliografico[] = [];
  private consulta = '';
  private modo = 'titulo';
  private buscando = false;
  private isbn = '';
  private porIsbn: ResultadoBibliografico | null = null;

  override reiniciar(): void { super.reiniciar(); }

  render(): string {
    const cartao = (r: ResultadoBibliografico, i: number, origem: 'lista' | 'isbn'): string => `<div class="result-card">${Html.capa(r.capa, 'cover-large', r.isbn)}<div class="result-text"><b>${Util.esc(r.titulo)}</b><p>${Util.esc((r.autores || []).join(', ') || 'Sem autoria informada')} · ${Util.esc(r.ano || 'Ano desconhecido')}</p><small class="small-muted">${Util.esc(r.editora || 'Editora não informada')} · ${Util.esc(r.origem)} · ISBN: ${Util.esc(r.isbn || "Nao informado")}</small>
      <div class="mt-2"><button type="button" class="btn btn-sm btn-outline-primary" data-action="usar" data-id="${i}" data-origem="${origem}"><i class="bi bi-plus-circle me-1"></i> Usar dados no cadastro</button></div></div></div>`;
    const opcao = (v: string, t: string): string => `<option value="${v}" ${this.modo === v ? 'selected' : ''}>${t}</option>`;
    return `${Html.cabecalho('Descobrir livros', 'Pesquise em fontes externas e preencha cadastros automaticamente.')}
      <div class="api-banner"><i class="bi bi-cloud-arrow-down"></i><div><h3>Integrações com Google Books e Open Library</h3><p>Veja capa, autoria, editora e descrição. Os dados vêm de APIs públicas: confira antes de salvar.</p></div></div>
      <div class="explore-grid">
        <div class="surface"><div class="surface-header"><div><h3>Busca no Google Books</h3><p>Por título, autor ou qualquer termo</p></div></div>
          <form class="explore-search" data-form="explore.google"><select class="form-select" id="explore-modo" aria-label="Tipo de busca">${opcao('titulo', 'Título')}${opcao('autor', 'Autor')}${opcao('livre', 'Qualquer termo')}</select>
          <input class="form-control field-input" id="explore-query" maxlength="120" value="${Util.esc(this.consulta)}" placeholder="Ex.: Dom Casmurro, Clarice Lispector..." required /><button class="btn btn-primary app-primary" type="submit"><i class="bi bi-search me-2"></i> Buscar</button></form>
          ${this.buscando ? '<div class="book-result-help">Consultando Google Books...</div>' : this.resultados.length ? `<div class="result-grid">${this.resultados.map((r, i) => cartao(r, i, 'lista')).join('')}</div>` : '<div class="book-result-help">Comece pesquisando. Os resultados aparecem aqui.</div>'}</div>
        <div class="surface"><div class="surface-header"><div><h3>Consulta por ISBN</h3><p>Open Library, com apoio do Google Books</p></div></div>
          <form class="explore-search" data-form="explore.isbn"><input class="form-control field-input" id="explore-isbn" maxlength="20" inputmode="numeric" value="${Util.esc(this.isbn)}" placeholder="978-85-..." required /><button class="btn btn-primary app-primary" type="submit"><i class="bi bi-upc-scan me-2"></i> Consultar</button></form>
          ${this.porIsbn ? `<div class="result-grid single">${cartao(this.porIsbn, 0, 'isbn')}</div>` : '<div class="book-result-help">Informe um ISBN de 10 ou 13 dígitos.</div>'}</div>
      </div>`;
  }

  override async enviar(nome: string, form: HTMLFormElement): Promise<void> {
    if (nome === 'google') {
      this.consulta = form.querySelector<HTMLInputElement>('#explore-query')!.value.trim();
      this.modo = form.querySelector<HTMLSelectElement>('#explore-modo')!.value;
      if (!this.consulta.trim()) return;
      this.buscando = true; this.ctx.redesenhar();
      try {
        this.resultados = await Api.chamar<ResultadoBibliografico[]>('apis:google', { consulta: this.consulta, modo: this.modo });
        Ui.toast(`${Util.plural(this.resultados.length, 'resultado encontrado', 'resultados encontrados')} no Google Books.`);
      } finally { this.buscando = false; this.ctx.redesenhar(); }
    } else if (nome === 'isbn') {
      this.isbn = form.querySelector<HTMLInputElement>('#explore-isbn')!.value.trim();
      if (!Util.isbnCompleto(Util.codigoIsbn(this.isbn))) {
        Ui.toast('Informe um ISBN de 10 ou 13 caracteres.', true);
        return;
      }
      this.porIsbn = await Api.chamar<ResultadoBibliografico>('apis:isbn', this.isbn);
      this.ctx.redesenhar();
    }
  }

  override async acao(nome: string, el: HTMLElement): Promise<void> {
    if (nome !== 'usar') { await super.acao(nome, el); return; }
    const r = el.dataset.origem === 'isbn' ? this.porIsbn : this.resultados[Number(el.dataset.id)];
    if (!r) return;
    await (this.ctx.pagina('books') as PaginaLivros).usarResultadoPesquisa(r);
  }
}

