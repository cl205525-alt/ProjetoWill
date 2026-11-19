/** CRUD de entidades simples (nome + um campo extra): base de Autores e Editoras. */
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
      <td>${Util.esc(r[t.campo] || '—')}</td><td>${Html.pill(Util.plural(Util.numero(r.total_livros), 'livro', 'livros'), Util.numero(r.total_livros) ? 'info' : 'neutral')}</td>
      <td><div class="cell-actions">${Html.botaoIcone('editar', r.id, 'pencil', 'Editar cadastro')}${this.ctx.ehAdmin ? Html.botaoIcone('excluir', r.id, 'trash3', 'Excluir cadastro', true) : ''}</div></td></tr>`);
    return Html.tabela([t.coluna.toUpperCase(), t.rotuloCampo.toUpperCase(), 'LIVROS', 'AÇÕES'], linhas, itens.length, this.numeroPagina, this.porPagina);
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
      corpo: `${Html.campo('nome', `Nome d${t.artigo} ${t.singular} *`, r.nome, 'text', 'required maxlength="160"')}${Html.campo(t.campo, `${t.rotuloCampo} (opcional)`, r[t.campo], 'text', 'maxlength="100"')}`,
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
}

class PaginaEditoras extends PaginaCadastroSimples {
  readonly id = 'publishers' as const;
  readonly nome = 'Editoras';
  protected readonly lista = 'editoras' as const;
  protected readonly rotas = { salvar: 'publishers:save', excluir: 'publishers:delete' };
  protected readonly textos = { singular: 'editora', artigo: 'a', titulo: 'Editoras', descricao: 'Mantenha o cadastro das editoras dos livros.', novo: 'Nova editora', coluna: 'Editora', campo: 'cidade' as const, rotuloCampo: 'Cidade', icone: 'building',
    avisoExcluir: (r: Registro) => `${r.nome} será apagada${Util.numero(r.total_livros) ? `; ${Util.plural(Util.numero(r.total_livros), 'livro ficará', 'livros ficarão')} sem editora` : ''}.` };
}
