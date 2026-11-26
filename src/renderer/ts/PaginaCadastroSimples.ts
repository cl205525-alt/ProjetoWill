abstract class PaginaCadastroSimples extends PaginaBase {
  protected abstract readonly lista: 'autores' | 'editoras';
  protected abstract readonly rotas: { salvar: string; excluir: string };
  protected abstract readonly textos: { singular: string; artigo: string; titulo: string; descricao: string; novo: string; coluna: string; campo: 'nacionalidade' | 'cidade'; rotuloCampo: string; icone: string; avisoExcluir: (r: Registro) => string };

  render(): string {
    const t = this.textos;
    return `${Html.cabecalho(t.titulo, t.descricao, Html.botao('novo', t.novo, 'plus-lg'))}<div class="surface">${Html.barra({ busca: this.busca, placeholder: 'Pesquisar por nome...' })}${this.area()}</div>`;
  }

  protected override listaHtml(): string {
    const t = this.textos;
    const itens = this.ctx.estado[this.lista].filter(r => this.pesquisa(`${r.nome} ${r[t.campo]}`));
    const linhas = Html.fatiar(itens, this.numeroPagina, this.porPagina).map(r => `<tr><td><div class="d-flex align-items-center gap-3"><span class="badge-circle"><i class="bi bi-${t.icone}"></i></span><span class="cell-title">${Util.esc(r.nome)}</span></div></td>
      <td>${Util.esc(r[t.campo] || '—')}</td><td>${this.totalLivrosHtml(r)}</td>
      <td><div class="cell-actions">${Html.botaoIcone('editar', r.id, 'pencil', 'Editar cadastro')}${this.ctx.ehAdmin ? Html.botaoIcone('excluir', r.id, 'trash3', 'Excluir cadastro', true) : ''}</div></td></tr>`);
    return Html.tabela([t.coluna.toUpperCase(), t.rotuloCampo.toUpperCase(), 'LIVROS', 'AÇÕES'], linhas, itens.length, this.numeroPagina, this.porPagina);
  }

  protected totalLivrosHtml(r: Registro): string {
    const total = Util.numero(r.total_livros);
    return Html.pill(Util.plural(total, 'livro', 'livros'), total ? 'info' : 'neutral');
  }

  override async acao(nome: string, el: HTMLElement): Promise<void> {
    const r = this.achar(this.ctx.estado[this.lista], el);
    if (nome === 'novo') this.formulario({});
    else if (nome === 'editar') this.formulario(r);
    else if (nome === 'excluir') {
      await this.confirmarEExecutar({ titulo: `Excluir ${this.textos.singular}?`, mensagem: this.textos.avisoExcluir(r), rotulo: 'Excluir' }, this.rotas.excluir, r.id, `${this.textos.singular[0].toUpperCase()}${this.textos.singular.slice(1)} excluíd${this.textos.artigo}.`);
    } else await super.acao(nome, el);
  }

  private formulario(r: Registro): void {
    const t = this.textos;
    Ui.abrirFormulario({
      kicker: t.titulo.toUpperCase(), titulo: r.id ? 'Editar cadastro' : t.novo,
      corpo: `${Html.campo('nome', `Nome d${t.artigo} ${t.singular} *`, r.nome, 'text', 'required maxlength="160"')}${Html.campo(t.campo, `${t.rotuloCampo} (opcional)`, r[t.campo], 'text', t.campo === 'nacionalidade' ? 'maxlength="80"' : 'maxlength="100"')}`,
      salvar: async form => {
        const dados: Registro = Object.fromEntries(new FormData(form).entries());
        if (r.id) dados.id = r.id;
        await this.executar(this.rotas.salvar, dados, 'Cadastro salvo com sucesso!');
      }
    });
  }
}

class PaginaAutores extends PaginaCadastroSimples {
  readonly id = 'authors' as const;
  readonly nome = 'Autores';
  protected readonly lista = 'autores' as const;
  protected readonly rotas = { salvar: 'authors:save', excluir: 'authors:delete' };
  protected readonly textos = { singular: 'autor', artigo: 'o', titulo: 'Autores', descricao: 'Organize os autores associados aos títulos do acervo.', novo: 'Novo autor', coluna: 'Autor', campo: 'nacionalidade' as const, rotuloCampo: 'Nacionalidade', icone: 'pen',
    avisoExcluir: (r: Registro) => `${r.nome} será apagado. Autores ligados a livros não podem ser excluídos.` };

  private autorSelecionado = '';

  override reiniciar(): void { super.reiniciar(); this.autorSelecionado = ''; }

  protected override totalLivrosHtml(r: Registro): string {
    const rotulo = Util.plural(Util.numero(r.total_livros), 'livro', 'livros');
    return Html.botao('livros-do-autor', rotulo, 'book', 'btn-sm btn-outline-primary',
      `data-id="${Util.numero(r.id)}" aria-label="${Util.esc(`Ver ${rotulo} de ${r.nome}`)}"`);
  }

  override render(): string {
    const autor = this.ctx.estado.autores.find(a => String(a.id) === this.autorSelecionado);
    if (!autor) return super.render();
    const livros = this.ctx.estado.livros
      .filter(livro => String(livro.autor_ids ?? '').split(',').some(id => id.trim() === String(autor.id)))
      .sort((a, b) => String(a.titulo).localeCompare(String(b.titulo), 'pt-BR'));
    const linhas = livros.map(livro => `<tr>
      <td><div class="book-cell">${Html.capa(livro.capa_url, 'cover-mini', livro.isbn)}<span class="cell-title">${Util.esc(livro.titulo)}</span></div></td>
      <td>${Util.esc(livro.isbn || 'Não informado')}</td>
      <td>${Html.pill(livro.ativo ? 'Ativo' : 'Arquivado', livro.ativo ? 'success' : 'neutral')}</td>
      <td>${Html.botao('books.ver', 'Ver detalhes', 'journal-text', 'btn-sm btn-outline-primary', `data-id="${Util.numero(livro.id)}"`)}</td></tr>`);
    return `${Html.cabecalho(`Livros de ${autor.nome}`, `${Util.plural(livros.length, 'título vinculado', 'títulos vinculados')} · inclui arquivados`,
      Html.botao('voltar-autores', 'Voltar para Autores', 'arrow-left', 'btn-outline-secondary'))}
      <section class="surface" aria-label="Livros vinculados ao autor">${linhas.length
        ? Html.tabela(['TÍTULO', 'ISBN', 'SITUAÇÃO', 'DETALHES'], linhas, linhas.length, 1, linhas.length)
        : Html.vazio('Nenhum livro vinculado a este autor.', 'book')}</section>`;
  }

  override async acao(nome: string, el: HTMLElement): Promise<void> {
    if (nome === 'livros-do-autor') {
      const autor = this.achar(this.ctx.estado.autores, el);
      if (!autor.id) return;
      this.autorSelecionado = String(autor.id);
      this.ctx.redesenhar();
      document.querySelector<HTMLElement>('[data-action="voltar-autores"]')?.focus();
    } else if (nome === 'voltar-autores') {
      const id = this.autorSelecionado;
      this.autorSelecionado = '';
      this.ctx.redesenhar();
      const botoes = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-action="livros-do-autor"]'));
      (botoes.find(botao => botao.dataset.id === id) ?? document.getElementById('busca-local'))?.focus();
    } else await super.acao(nome, el);
  }
}

class PaginaEditoras extends PaginaCadastroSimples {
  readonly id = 'publishers' as const;
  readonly nome = 'Editoras';
  protected readonly lista = 'editoras' as const;
  protected readonly rotas = { salvar: 'publishers:save', excluir: 'publishers:delete' };
  protected readonly textos = { singular: 'editora', artigo: 'a', titulo: 'Editoras', descricao: 'Mantenha o cadastro das editoras dos livros.', novo: 'Nova editora', coluna: 'Editora', campo: 'cidade' as const, rotuloCampo: 'Cidade', icone: 'building',
    avisoExcluir: (r: Registro) => `${r.nome} será apagada${Util.numero(r.total_livros) ? `; ${Util.plural(Util.numero(r.total_livros), 'livro ficará', 'livros ficarão')} sem editora` : ''}.` };
}
