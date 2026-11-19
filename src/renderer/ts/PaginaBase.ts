/** Classe base das páginas (a "View" do MVC). Cada página cuida da sua tela, formulários e ações. */
abstract class PaginaBase {
  abstract readonly id: IdPagina;
  abstract readonly nome: string;
  protected busca = '';
  protected filtro = '';
  protected filtroPadrao = '';
  protected numeroPagina = 1;
  protected porPagina = 10;

  constructor(protected readonly ctx: Contexto) {}

  abstract render(): string;

  /** Chamado depois que o HTML da página entra no DOM. */
  montar(): void { Util.aplicarLarguras(); }

  reiniciar(): void { this.busca = ''; this.filtro = this.filtroPadrao; this.numeroPagina = 1; }

  protected listaHtml(): string { return ''; }

  buscar(valor: string): void { this.busca = valor; this.numeroPagina = 1; this.atualizarLista(); }

  entrada(nome: string, valor: string): void { if (nome === 'busca') this.buscar(valor); }

  async enviar(_nome: string, _form: HTMLFormElement): Promise<void> { /* só páginas com formulário próprio */ }

  async acao(nome: string, el: HTMLElement): Promise<void> {
    if (nome === 'filtro') { this.filtro = el.dataset.valor || this.filtroPadrao; this.numeroPagina = 1; this.ctx.redesenhar(); }
    else if (nome === 'pg') { this.numeroPagina = Number(el.dataset.pg) || 1; this.atualizarLista(); }
  }

  protected pesquisa(texto: unknown): boolean { return Util.semAcento(String(texto ?? '')).includes(Util.semAcento(this.busca.trim())); }

  protected atualizarLista(): void {
    const area = document.querySelector('#area-lista');
    if (!area) return;
    area.innerHTML = this.listaHtml();
    Util.aplicarLarguras(area);
  }

  protected area(): string { return `<div id="area-lista">${this.listaHtml()}</div>`; }

  protected achar(lista: Registro[], el: HTMLElement): Registro { return lista.find(x => String(x.id) === el.dataset.id) ?? {}; }

  /** Chama o main, recarrega os dados e avisa o usuário. */
  protected async executar(acao: string, dados: unknown, sucesso: string): Promise<void> {
    await Api.chamar(acao, dados);
    await this.ctx.recarregar();
    Ui.toast(sucesso);
  }

  /** Modal de confirmação (aula 5: nunca excluir direto no clique). */
  protected async confirmarEExecutar(opcoes: OpcoesConfirmacao, acao: string, id: unknown, sucesso: string): Promise<void> {
    if (!(await Ui.confirmar(opcoes))) return;
    await this.executar(acao, id, sucesso);
  }
}
