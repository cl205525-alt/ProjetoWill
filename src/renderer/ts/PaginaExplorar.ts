type OrigemExplorar = 'lista' | 'isbn';
interface ResultadoExplorar { edicao: EdicaoAssistida; local?: Registro; }
interface BuscaExplorar {
  rodada: number;
  carregando: boolean;
  mensagem: string;
  resultados: ResultadoExplorar[];
}

class PaginaExplorar extends PaginaBase {
  readonly id = 'explore' as const;
  readonly nome = 'Descobrir livros';
  private consulta = '';
  private modo = 'titulo';
  private isbn = '';
  private ativa: OrigemExplorar = 'lista';
  private readonly buscas: Record<OrigemExplorar, BuscaExplorar> = {
    lista: { rodada: 0, carregando: false, mensagem: '', resultados: [] },
    isbn: { rodada: 0, carregando: false, mensagem: '', resultados: [] }
  };

  private cartao({ edicao, local }: ResultadoExplorar, i: number, origem: OrigemExplorar, generos: string[]): string {
    const r = edicao.livro;
    const capa = local ? Html.capa(r.capa, 'cover-large', r.isbn) : Html.capaPesquisa(r.capa, 'cover-large', r.isbn);
    const genero = local && local.genero ? `Gênero: ${local.genero}` : edicao.genero.texto(generos);
    const botao = local
      ? Html.botao('books.ver', 'Abrir livro do acervo', 'journal-text', 'btn-sm btn-outline-primary', `data-id="${Util.numero(local.id)}"`)
      : `<button type="button" class="btn btn-sm btn-outline-primary" data-action="usar" data-id="${i}" data-origem="${origem}"><i class="bi bi-plus-circle me-1"></i> Usar dados no cadastro</button>`;
    const ano = r.ano ? `Ano da edição: ${r.ano}${r.fonteAno ? ` (${r.fonteAno})` : ''}` : 'Ano da edição não confirmado';
    return `<article class="result-card">${capa}<div class="result-text"><b>${Util.esc(r.titulo)}</b><p>${Util.esc(r.autores.join(', ') || 'Sem autoria informada')} · ${Util.esc(ano)}</p>
      <small class="small-muted"><span id="explore-editora-${origem}-${i}">${Util.esc(edicao.texto)}</span> · ${Util.esc(r.isbn || 'ISBN não informado')} · ${Util.esc(r.origem)}</small>
      <small id="explore-genero-${origem}-${i}" class="small-muted d-block">${Util.esc(genero)}</small>
      <div class="mt-2">${botao}</div></div></article>`;
  }

  private status(origem: OrigemExplorar): string {
    const busca = this.buscas[origem];
    if (busca.carregando) return 'Consultando as fontes bibliográficas…';
    if (busca.mensagem) return busca.mensagem;
    if (busca.resultados.length) return Util.plural(busca.resultados.length, 'edição encontrada', 'edições encontradas');
    return origem === 'isbn' ? 'Informe um ISBN válido de 10 ou 13 dígitos.' : 'Pesquise por título ou autoria para ver os resultados.';
  }

  private resultadosHtml(origem: OrigemExplorar): string {
    const resultados = this.buscas[origem].resultados;
    if (!resultados.length) return '';
    const generos = GeneroAssistido.doAcervo(this.ctx.estado.livros);
    return `<div class="result-grid">${resultados.map((r, i) => this.cartao(r, i, origem, generos)).join('')}</div>`;
  }

  private atualizarResultados(): void {
    for (const origem of ['lista', 'isbn'] as const) {
      const painel = document.getElementById(`explore-painel-${origem}`);
      const status = document.getElementById(`explore-status-${origem}`);
      const caixa = document.getElementById(`explore-resultados-${origem}`);
      if (painel) painel.hidden = this.ativa !== origem;
      if (status && status.textContent !== this.status(origem)) status.textContent = this.status(origem);
      if (caixa) caixa.innerHTML = this.resultadosHtml(origem);
    }
  }

  private limpar(origem: OrigemExplorar): number {
    const busca = this.buscas[origem];
    busca.carregando = false;
    busca.mensagem = '';
    busca.resultados = [];
    return ++busca.rodada;
  }

  override reiniciar(): void {
    super.reiniciar();
    this.ativa = 'lista';
    this.limpar('lista');
    this.limpar('isbn');
  }

  override entrada(nome: string, valor: string): void {
    if (nome === 'consulta' || nome === 'modo' || nome === 'isbn') {
      if (this[nome] === valor) return;
      this[nome] = valor;
      const origem = nome === 'isbn' ? 'isbn' : 'lista';
      this.limpar(origem);
      if (this.ativa === origem) this.atualizarResultados();
    } else super.entrada(nome, valor);
  }

  private rodadaAtual(origem: OrigemExplorar, rodada: number): boolean {
    return this.buscas[origem].rodada === rodada && this.ativa === origem
      && !!document.querySelector(`#app-shell:not(.d-none) #explore-resultados-${origem}`);
  }

  private acompanharMetadados(origem: OrigemExplorar, rodada: number): void {
    for (const [i, { edicao }] of this.buscas[origem].resultados.entries()) {
      const atualizar = (campo: string, obterTexto: () => string): void => {
        if (!this.rodadaAtual(origem, rodada)) return;
        const status = document.getElementById(`explore-${campo}-${origem}-${i}`);
        if (status) status.textContent = obterTexto();
      };
      void edicao.consulta?.then(() => atualizar('editora', () => edicao.texto));
      void edicao.genero.consulta?.then(() => atualizar('genero', () => edicao.genero.texto(GeneroAssistido.doAcervo(this.ctx.estado.livros))));
    }
  }

  private procurarNoAcervo(origem: OrigemExplorar, entrada: string): ResultadoExplorar[] {
    const chave = (texto: unknown): string => Util.semAcento(String(texto ?? '')).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const termo = chave(entrada);
    const isbn = origem === 'isbn' ? isbn13Assistido(entrada) : null;
    return this.ctx.estado.livros.filter(l => {
      if (origem === 'isbn') return isbn !== null && isbn13Assistido(l.isbn) === isbn;
      const campo = this.modo === 'titulo' ? l.titulo : this.modo === 'autor' ? l.autores : `${l.titulo} ${l.autores ?? ''} ${l.editora ?? ''} ${l.isbn ?? ''}`;
      return !!termo && termo.split(' ').every(palavra => chave(campo).includes(palavra));
    }).slice(0, 20).map(local => ({
      local, edicao: new EdicaoAssistida({
        titulo: String(local.titulo), autores: local.autores ? [String(local.autores)] : [], editora: String(local.editora ?? ''),
        ano: Number(local.ano_publicacao) || null, isbn: String(local.isbn ?? ''), genero: String(local.genero ?? ''),
        capa: Util.urlCapa(local.capa_url), origem: local.ativo ? 'Acervo local' : 'Acervo local (arquivado)'
      }, undefined, false)
    }));
  }

  render(): string {
    const opcao = (v: string, t: string): string => `<option value="${v}" ${this.modo === v ? 'selected' : ''}>${t}</option>`;
    const painel = (origem: OrigemExplorar): string => `<section class="surface mt-3" id="explore-painel-${origem}" aria-label="${origem === 'isbn' ? 'Resultados por ISBN' : 'Resultados da pesquisa'}"${this.ativa !== origem ? ' hidden' : ''}>
      <p id="explore-status-${origem}" class="book-result-help" role="status">${Util.esc(this.status(origem))}</p>
      <div id="explore-resultados-${origem}">${this.resultadosHtml(origem)}</div></section>`;
    return `${Html.cabecalho('Descobrir livros', 'Pesquise em fontes externas e confira os dados antes de cadastrar.')}
      <div class="explore-grid">
        <div class="surface"><div class="surface-header"><div><h3>Pesquisa bibliográfica</h3><p>Por título, autor ou qualquer termo</p></div></div>
          <form class="explore-search" data-form="explore.google"><select class="form-select" id="explore-modo" data-input="explore.modo" aria-label="Tipo de busca">${opcao('titulo', 'Título')}${opcao('autor', 'Autor')}${opcao('livre', 'Qualquer termo')}</select>
          <input class="form-control field-input" id="explore-query" data-input="explore.consulta" aria-label="Termo da pesquisa bibliográfica" maxlength="240" value="${Util.esc(this.consulta)}" placeholder="Ex.: Dom Casmurro" required /><button class="btn btn-primary app-primary" type="submit"><i class="bi bi-search me-2"></i> Buscar</button></form></div>
        <div class="surface"><div class="surface-header"><div><h3>Consulta por ISBN</h3><p>Identifica uma edição específica</p></div></div>
          <form class="explore-search" data-form="explore.isbn"><input class="form-control field-input" id="explore-isbn" data-input="explore.isbn" aria-label="ISBN" maxlength="20" value="${Util.esc(this.isbn)}" placeholder="Ex.: 978-85-…" required /><button class="btn btn-primary app-primary" type="submit"><i class="bi bi-upc-scan me-2"></i> Consultar</button></form></div>
      </div>${painel('lista')}${painel('isbn')}`;
  }

  override async enviar(nome: string, form: HTMLFormElement): Promise<void> {
    if (nome !== 'google' && nome !== 'isbn') return;
    const origem = nome === 'isbn' ? 'isbn' : 'lista';
    const busca = this.buscas[origem];
    if (busca.carregando) return;
    if (this.ativa !== origem) this.limpar(this.ativa);
    this.ativa = origem;
    const rodada = this.limpar(origem);
    if (origem === 'isbn') this.isbn = form.querySelector<HTMLInputElement>('#explore-isbn')!.value;
    else {
      this.consulta = form.querySelector<HTMLInputElement>('#explore-query')!.value;
      this.modo = form.querySelector<HTMLSelectElement>('#explore-modo')!.value;
    }
    const entrada = (origem === 'isbn' ? this.isbn : this.consulta).trim();
    if (origem === 'isbn' ? !isbn13Assistido(entrada) : !/[\p{L}\p{N}]/u.test(entrada)) {
      busca.mensagem = origem === 'isbn' ? 'Confira o ISBN: ele precisa ter 10 ou 13 dígitos e o dígito verificador correto.' : 'Informe um termo com letras ou números para pesquisar.';
      this.atualizarResultados();
      return;
    }
    busca.carregando = true;
    this.atualizarResultados();
    try {
      const resultados = origem === 'isbn'
        ? [await Api.chamar<ResultadoBibliografico>('apis:isbn', entrada)]
        : this.modo === 'titulo' ? await Api.chamar<ResultadoBibliografico[]>('apis:titulo', entrada)
          : await Api.chamar<ResultadoBibliografico[]>('apis:google', { consulta: entrada, modo: this.modo });
      if (!this.rodadaAtual(origem, rodada)) return;
      if (origem === 'isbn' && isbn13Assistido(resultados[0]?.isbn) !== isbn13Assistido(entrada)) {
        throw new Error('A resposta recebida não confirma o ISBN informado.');
      }
      busca.resultados = resultados.map(livro => ({ edicao: new EdicaoAssistida(livro, origem === 'isbn' ? entrada : undefined) }));
      if (!busca.resultados.length) {
        busca.resultados = this.procurarNoAcervo(origem, entrada);
        busca.mensagem = busca.resultados.length ? 'Nenhum resultado externo. Mostrando livros do acervo local.'
          : 'Nenhum resultado encontrado. Tente outro termo ou consulte pelo ISBN.';
      }
    } catch (erro) {
      if (!this.rodadaAtual(origem, rodada)) return;
      busca.resultados = this.procurarNoAcervo(origem, entrada);
      busca.mensagem = busca.resultados.length ? 'A consulta externa não foi concluída. Mostrando livros do acervo local.'
        : (erro instanceof Error ? erro.message : 'Não foi possível concluir a busca. Tente novamente.');
    } finally {
      if (this.rodadaAtual(origem, rodada)) {
        busca.carregando = false;
        this.atualizarResultados();
        this.acompanharMetadados(origem, rodada);
      }
    }
  }

  override async acao(nome: string, el: HTMLElement): Promise<void> {
    if (nome !== 'usar') { await super.acao(nome, el); return; }
    const origem = el.dataset.origem;
    if (origem !== this.ativa) return;
    const resultado = this.buscas[origem].resultados[Number(el.dataset.id)];
    if (resultado && !resultado.local) await (this.ctx.pagina('books') as PaginaLivros).usarResultadoPesquisa(resultado.edicao);
  }
}
