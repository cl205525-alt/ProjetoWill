class Aplicacao {
  private estado = new Estado();
  private usuarioAtual: Registro | null = null;
  private primeiraConfiguracao = false;
  private paginas = new Map<IdPagina, PaginaBase>();
  private atual: IdPagina = 'dashboard';
  private revisaoAcervo = 0;
  private recargaEmCurso?: { revisaoAcervo: number; resultado: Promise<void> };
  private readonly capasEmCurso = new Map<string, Promise<string | null>>();
  private readonly capasRecuperadas = new Map<string, string>();

  private readonly ctx: Contexto = {
    get estado(): Estado { return app().estado; },
    get usuario(): Registro { return app().usuarioAtual ?? {}; },
    get ehAdmin(): boolean { return app().usuarioAtual?.perfil === 'admin'; },
    recarregar: () => this.recarregar(),
    redesenhar: () => this.renderizar(),
    irPara: p => this.navegar(p),
    pagina: id => this.paginas.get(id)!
  };

  constructor() {
    Ui.iniciar();
    this.aplicarTema(this.lerTema());
    Api.aoExpirarSessao = () => this.mostrarAutenticacao('Sessão encerrada. Faça login novamente.');
    document.querySelector<HTMLFormElement>('#auth-form')!.addEventListener('submit', e => void this.autenticar(e));
    document.addEventListener('click', e => void this.clique(e));
    document.addEventListener('submit', e => void this.formulario(e));
    document.addEventListener('input', e => this.entrada(e));
    document.addEventListener('keydown', e => { if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); document.querySelector<HTMLInputElement>('#global-search')?.focus(); } });
    document.addEventListener('error', e => void this.erroCapa(e), true);
    document.addEventListener('load', e => {
      const img = e.target;
      if (img instanceof HTMLImageElement && img.dataset.coverUrl) {
        this.informarPreviaRecuperada(img, img.dataset.coverUrl);
      }
    }, true);
    this.observarCapasPesquisa();
    window.biblioteca.aoMenu(acao => void this.acaoMenu(acao));
    window.biblioteca.aoAtualizarNotificacoes(() => {
      if (this.usuarioAtual?.perfil === 'admin') void this.atualizarNotificacoes();
    });
    void this.inicializar();
  }

  private lerTema(): 'light' | 'dark' {
    try { if (localStorage.getItem('lumi-tema') === 'dark') return 'dark'; } catch {   }
    return 'light';
  }
  private aplicarTema(tema: 'light' | 'dark'): void {
    document.documentElement.setAttribute('data-bs-theme', tema);
    const icone = document.querySelector('#tema-icone');
    if (icone) icone.className = `bi bi-${tema === 'dark' ? 'sun' : 'moon-stars'}`;
    try { localStorage.setItem('lumi-tema', tema); } catch {   }
  }
  private alternarTema(): void { this.aplicarTema(document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark'); }

  private async inicializar(): Promise<void> {
    try {
      const estado = await Api.chamar<{ necessitaConfiguracao: boolean; usuario: Registro | null }>('auth:status');
      this.primeiraConfiguracao = estado.necessitaConfiguracao;
      if (estado.usuario) { this.usuarioAtual = estado.usuario; await this.mostrarSistema(); return; }
      this.mostrarAutenticacao();
    } catch (e) { this.mostrarAutenticacao((e as Error).message); }
  }

  private mostrarAutenticacao(erro = ''): void {
    this.usuarioAtual = null;
    this.paginas.clear();
    this.estado = new Estado();
    this.recargaEmCurso = undefined;
    ++this.revisaoAcervo;
    this.capasEmCurso.clear();
    this.capasRecuperadas.clear();
    document.querySelectorAll('.modal.show').forEach(m => bootstrap.Modal.getOrCreateInstance(m).hide());
    document.querySelector('#auth-shell')!.classList.remove('d-none');
    document.querySelector('#app-shell')!.classList.add('d-none');
    const setup = this.primeiraConfiguracao;
    document.querySelector('#setup-name-group')!.classList.toggle('d-none', !setup);
    document.querySelector('#setup-confirm-group')!.classList.toggle('d-none', !setup);
    document.querySelector('#auth-title')!.textContent = setup ? 'Crie o primeiro acesso' : 'Entre na sua conta';
    document.querySelector('#auth-subtitle')!.textContent = setup ? 'Configure o administrador inicial. A senha deve ter pelo menos 10 caracteres.' : 'Use seus dados para acessar o painel da biblioteca.';
    document.querySelector('#auth-submit')!.innerHTML = `${setup ? 'Criar administrador' : 'Entrar no sistema'} <i class="bi bi-arrow-right ms-2"></i>`;
    document.querySelector<HTMLInputElement>('#auth-name')!.required = setup;
    document.querySelector<HTMLInputElement>('#auth-confirm')!.required = setup;
    document.querySelector<HTMLInputElement>('#auth-password')!.value = '';
    this.mostrarErroAuth(erro);
  }

  private mostrarErroAuth(mensagem: string): void {
    const caixa = document.querySelector('#auth-error')!;
    caixa.textContent = mensagem;
    caixa.classList.toggle('d-none', !mensagem);
  }

  private async autenticar(e: Event): Promise<void> {
    e.preventDefault();
    const botao = document.querySelector<HTMLButtonElement>('#auth-submit')!;
    const valor = (id: string): string => document.querySelector<HTMLInputElement>(id)!.value;
    this.mostrarErroAuth('');
    if (this.primeiraConfiguracao && valor('#auth-password') !== valor('#auth-confirm')) { this.mostrarErroAuth('As senhas não conferem.'); return; }
    botao.disabled = true;
    try {
      this.usuarioAtual = await Api.chamar<Registro>(this.primeiraConfiguracao ? 'auth:setup' : 'auth:login', { nome: valor('#auth-name'), usuario: valor('#auth-username').trim(), senha: valor('#auth-password') });
      this.primeiraConfiguracao = false;
      document.querySelector<HTMLInputElement>('#auth-password')!.value = '';
      document.querySelector<HTMLInputElement>('#auth-confirm')!.value = '';
      await this.mostrarSistema();
    } catch (erro) { this.mostrarErroAuth((erro as Error).message); } finally { botao.disabled = false; }
  }

  private async sair(): Promise<void> {
    try { await Api.chamar('auth:logout'); } catch {   }
    this.paginas.clear();
    this.mostrarAutenticacao();
  }

  private async mostrarSistema(): Promise<void> {
    const usuario = this.usuarioAtual;
    const u = this.usuarioAtual ?? {};
    const livros = new PaginaLivros(this.ctx, (pagina, formularioAtual) => this.recarregarAcervo(pagina, formularioAtual));
    this.paginas = new Map<IdPagina, PaginaBase>([
      new PaginaDashboard(this.ctx), livros, new PaginaEmprestimos(this.ctx), new PaginaReservas(this.ctx), new PaginaLeitores(this.ctx),
      new PaginaAutores(this.ctx), new PaginaEditoras(this.ctx), new PaginaExplorar(this.ctx), new PaginaNotificacoes(this.ctx), new PaginaRelatorios(this.ctx), new PaginaEquipe(this.ctx)
    ].map(p => [p.id, p] as [IdPagina, PaginaBase]));
    document.querySelector('#auth-shell')!.classList.add('d-none');
    document.querySelector('#app-shell')!.classList.remove('d-none');
    const nome = String(u.nome ?? 'Usuário');
    document.querySelector('#user-name')!.textContent = nome.split(' ')[0];
    document.querySelector('#user-avatar')!.textContent = Util.iniciais(nome);
    document.querySelector('#user-role')!.textContent = u.perfil === 'admin' ? 'Administrador' : 'Atendente';
    document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('d-none', u.perfil !== 'admin'));
    document.querySelector('#today')!.textContent = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    await this.recarregar(false);
    if (usuario && this.usuarioAtual === usuario) this.navegar('dashboard');
  }

  private iniciarRecarga() {
    const revisaoAcervo = this.revisaoAcervo;
    const estado = this.estado;
    const resultado = estado.carregar(this.usuarioAtual?.perfil === 'admin')
      .then(() => { if (this.estado === estado) this.atualizarBadges(); })
      .finally(() => { if (this.recargaEmCurso?.resultado === resultado) this.recargaEmCurso = undefined; });
    return this.recargaEmCurso = { revisaoAcervo, resultado };
  }

  async recarregar(redesenhar = true): Promise<void> {
    if (this.recargaEmCurso) return;
    const rodada = this.iniciarRecarga();
    try {
      await rodada.resultado;
    } catch (e) {
      if (rodada.revisaoAcervo === this.revisaoAcervo) Ui.toast((e as Error).message, true);
    }
    if (redesenhar && rodada.revisaoAcervo === this.revisaoAcervo) this.renderizar();
  }

  private async recarregarAcervo(pagina: PaginaLivros, formularioAtual?: () => boolean): Promise<boolean> {
    const vigente = (): boolean => !!this.usuarioAtual && this.paginas.get('books') === pagina;
    if (!vigente()) return false;
    if (formularioAtual) ++this.revisaoAcervo;
    while (vigente()) {

      const rodada = this.recargaEmCurso ?? this.iniciarRecarga();
      const atualizada = await rodada.resultado.then(() => true, () => false);

      if (rodada.revisaoAcervo !== this.revisaoAcervo) continue;
      if (!vigente()) return false;
      pagina.informarRecarga(atualizada);
      if (atualizada) {
        if (formularioAtual?.() && !document.querySelector('#page-content')?.contains(document.activeElement)) this.renderizar();
        else if (this.atual === 'books') pagina.atualizarListaPreservandoFoco();
      }
      return atualizada;
    }
    return false;
  }

  private atualizarBadges(): void {
    const s = this.estado.stats;
    const badge = (id: string, n: number): void => { const el = document.getElementById(id)!; el.textContent = String(n); el.classList.toggle('d-none', n === 0); };
    badge('side-reserves', Util.numero(s.reservas) + Util.numero(s.retiradas));
    const pendentes = this.estado.notificacoesPendentes;
    badge('side-notifs', pendentes);
    document.querySelector('#notif-dot')!.classList.toggle('d-none', pendentes === 0);
    const cartao = document.querySelector('.stat-card[data-page="notifications"] strong');
    if (cartao) cartao.textContent = Util.milhar(pendentes);
  }

  private navegar(id: IdPagina): void {
    if (id === 'team' && this.usuarioAtual?.perfil !== 'admin') return;
    const pagina = this.paginas.get(id);
    if (!pagina) return;
    this.atual = id;
    pagina.reiniciar();
    document.querySelectorAll<HTMLElement>('.side-link[data-page]').forEach(e => {
      const ativa = e.dataset.page === id;
      e.classList.toggle('active', ativa);
      if (ativa) e.setAttribute('aria-current', 'page');
      else e.removeAttribute('aria-current');
    });
    document.querySelector<HTMLInputElement>('#global-search')!.value = '';
    document.querySelector('#breadcrumb')!.textContent = `Biblioteca / ${pagina.nome}`;
    this.renderizar();
    document.querySelector('#page-content')!.scrollTop = 0;
    if (id === 'notifications') void this.atualizarNotificacoes(true);
  }

  private async atualizarNotificacoes(mostrarErro = false): Promise<void> {
    const usuario = this.usuarioAtual;
    if (!usuario) return;
    try {
      if (!(await this.estado.carregarNotificacoes()) || this.usuarioAtual !== usuario) return;
      this.atualizarBadges();
      const pagina = this.paginas.get(this.atual);
      if (pagina instanceof PaginaNotificacoes) pagina.atualizarAvisos();
    } catch (erro) {
      if (mostrarErro && this.usuarioAtual === usuario) Ui.toast((erro as Error).message, true);
    }
  }

  private renderizar(): void {
    const pagina = this.paginas.get(this.atual);
    if (!pagina) return;
    const raiz = document.querySelector('#page-content')!;
    raiz.innerHTML = `<div class="page-fade">${pagina.render()}</div>`;
    pagina.montar();
  }

  private async clique(e: Event): Promise<void> {
    const alvo = e.target as HTMLElement;
    const link = alvo.closest<HTMLElement>('[data-page]');
    if (link?.dataset.page) { this.navegar(link.dataset.page as IdPagina); return; }
    const botao = alvo.closest<HTMLElement>('[data-action]');
    if (!botao || botao.hasAttribute('disabled')) return;
    const bruto = botao.dataset.action ?? '';
    try {
      if (bruto === 'sair') { await this.sair(); return; }
      if (bruto === 'tema') { this.alternarTema(); return; }
      if (bruto === 'perfil') { this.abrirPerfil(); return; }
      if (bruto === 'ver-senha') { this.alternarSenha(botao); return; }
      const [prefixo, nome] = bruto.includes('.') ? bruto.split('.') : [this.atual, bruto];
      const pagina = this.paginas.get(prefixo as IdPagina);
      if (pagina) await pagina.acao(nome, botao);
    } catch (erro) { Ui.toast((erro as Error).message, true); }
  }

  private async formulario(e: Event): Promise<void> {
    const form = e.target as HTMLFormElement;
    const destino = form.dataset?.form;
    if (!destino) return;
    e.preventDefault();
    const [prefixo, nome] = destino.split('.');
    try { await this.paginas.get(prefixo as IdPagina)?.enviar(nome, form); } catch (erro) { Ui.toast((erro as Error).message, true); }
  }

  private entrada(e: Event): void {
    const el = (e.target as HTMLElement).closest<HTMLInputElement>('[data-input]');
    if (!el?.dataset.input) return;
    const bruto = el.dataset.input;
    const [prefixo, nome] = bruto.includes('.') ? bruto.split('.') : [this.atual, bruto];
    if (nome === 'busca') {

      const outro = document.querySelector<HTMLInputElement>(el.id === 'global-search' ? '#busca-local' : '#global-search');
      if (outro) outro.value = el.value;
    }
    this.paginas.get(prefixo as IdPagina)?.entrada(nome, el.value);
  }

  private alternarSenha(botao: HTMLElement): void {
    const campo = document.querySelector<HTMLInputElement>(`#${botao.dataset.alvo}`);
    if (!campo) return;
    campo.type = campo.type === 'password' ? 'text' : 'password';
    botao.innerHTML = `<i class="bi bi-eye${campo.type === 'password' ? '' : '-slash'}"></i>`;
  }

  private async acaoMenu(acao: string): Promise<void> {
    if (!this.usuarioAtual) return;
    const rel = this.paginas.get('reports') as PaginaRelatorios;
    try {
      if (acao.startsWith('relatorio:')) await rel.relatorio(acao.slice(10));
      else if (acao === 'backup:exportar') await rel.backupExportar();
      else if (acao === 'backup:importar') await rel.backupImportar();
    } catch (erro) { Ui.toast((erro as Error).message, true); }
  }

  private abrirPerfil(): void {
    const u = this.usuarioAtual ?? {};
    Ui.abrirFormulario({
      kicker: 'MINHA CONTA', titulo: 'Perfil e senha', rotuloSalvar: 'Alterar senha',
      corpo: `<div class="detail-hero compact">${Html.avatar(u.nome, 'avatar lg')}<div><h3>${Util.esc(u.nome)}</h3><p class="small-muted">@${Util.esc(u.usuario)} · ${u.perfil === 'admin' ? 'Administrador' : 'Atendente'}</p></div></div>
        ${Html.campo('atual', 'Senha atual *', '', 'password', 'required autocomplete="current-password"')}
        ${Html.campo('nova', 'Nova senha (mínimo 10 caracteres) *', '', 'password', 'required minlength="10" maxlength="72" autocomplete="new-password"')}
        ${Html.campo('confirmar', 'Repita a nova senha *', '', 'password', 'required minlength="10" maxlength="72" autocomplete="new-password"')}`,
      salvar: async form => {
        const f = new FormData(form);
        if (f.get('nova') !== f.get('confirmar')) throw new Error('As senhas novas não conferem.');
        await Api.chamar('auth:password', { atual: f.get('atual'), nova: f.get('nova') });
        Ui.toast('Senha alterada com sucesso!');
      }
    });
  }

  private observarCapasPesquisa(): void {
    const seletor = '[data-cover-fallback]';

    const observar = new MutationObserver(mudancas => {
      for (const mudanca of mudancas) for (const no of mudanca.addedNodes) {
        if (!(no instanceof HTMLElement) || !no.isConnected) continue;
        if (no.matches(seletor)) this.iniciarCapaAusente(no);
        no.querySelectorAll<HTMLElement>(seletor).forEach(el => this.iniciarCapaAusente(el));
      }
    });
    document.querySelectorAll('#page-content, #modal-fields').forEach(raiz => observar.observe(raiz, { childList: true, subtree: true }));
  }

  private iniciarCapaAusente(marcador: HTMLElement): void {
    const isbn = marcador.dataset.coverFallback;
    if (!isbn) return;
    delete marcador.dataset.coverFallback;
    void this.recuperarCapaPesquisa(marcador, isbn);
  }

  private consultarCapa(acao: string, dados: unknown): Promise<string | null> {
    const chave = JSON.stringify([acao, dados]);
    const recuperada = this.capasRecuperadas.get(chave);
    if (recuperada) return Promise.resolve(recuperada);
    const emCurso = this.capasEmCurso.get(chave);
    if (emCurso) return emCurso;
    const consulta = Api.chamar<string | null>(acao, dados)
      .then(async src => {
        if (typeof src !== 'string' || !/^data:image\/(?:jpeg|png|webp|gif);base64,/i.test(src)) return null;
        const img = new Image();
        img.src = src;
        await img.decode();
        return src;
      })
      .catch(() => null)
      .then(src => {
        if (this.capasEmCurso.get(chave) === consulta) {
          this.capasEmCurso.delete(chave);
          if (src) {
            if (this.capasRecuperadas.size >= 32) this.capasRecuperadas.delete(this.capasRecuperadas.keys().next().value!);
            this.capasRecuperadas.set(chave, src);
          }
        }
        return src;
      });
    this.capasEmCurso.set(chave, consulta);
    return consulta;
  }

  private async recuperarCapaPesquisa(marcador: HTMLElement, isbn: string, principal?: string): Promise<void> {
    const usuario = this.usuarioAtual;
    const vigente = (): boolean => marcador.isConnected && this.usuarioAtual === usuario;
    if (!usuario || !vigente()) return;
    const status = marcador.closest('.cover-preview-row')?.querySelector('#cover-preview-status');
    if (status) status.textContent = 'Buscando capa para esta edição…';
    let src = principal ? await this.consultarCapa('apis:cover', principal) : null;
    const urlVisualizada = src ? principal : undefined;
    if (!src && Util.isbnCompleto(isbn) && vigente()) {
      src = await this.consultarCapa('apis:cover-fallback', principal ? { isbn, excluir: principal } : { isbn });
    }
    if (!vigente()) return;
    if (src) {
      const img = new Image();
      img.className = marcador.className;
      img.classList.remove('cover-placeholder');
      img.alt = 'Capa do livro';
      img.src = src;
      marcador.replaceWith(img);
      this.informarPreviaRecuperada(img, urlVisualizada);
    } else if (status) {
      status.textContent = 'Capa indisponível para esta edição. Você pode cadastrar o livro mesmo assim.';
    }
  }

  private informarPreviaRecuperada(img: HTMLImageElement, urlVisualizada?: string): void {
    if (!img.isConnected) return;
    const status = img.closest('.cover-preview-row')?.querySelector('#cover-preview-status');
    const campo = img.closest('form')?.querySelector<HTMLInputElement>('#field-capa_url');
    if (!status || !campo) return;
    const mesmaUrl = !!urlVisualizada && campo.value === urlVisualizada;
    if (mesmaUrl && img.src === urlVisualizada) return;
    status.textContent = mesmaUrl
      ? 'Prévia recuperada da mesma URL do formulário. Será gravada somente a URL, não a imagem da prévia.'
      : campo.value
        ? 'Capa alternativa recuperada apenas para prévia. Ela não será gravada; será mantida a URL do formulário.'
        : 'Capa recuperada apenas para prévia. Ela não será gravada; o livro será salvo sem URL de capa.';
  }

  private substituirCapa(img: HTMLImageElement): HTMLElement {
    img.insertAdjacentHTML('afterend', Html.capaIndisponivel(img.className));
    const marcador = img.nextElementSibling as HTMLElement;
    img.remove();
    return marcador;
  }

  private async erroCapa(evento: Event): Promise<void> {
    const img = evento.target;
    if (!(img instanceof HTMLImageElement) || !img.isConnected) return;
    const principal = img.dataset.coverPrimary;
    if (principal) {
      await this.recuperarCapaPesquisa(this.substituirCapa(img), img.dataset.coverIsbn || '', principal);
      return;
    }

    const original = img.dataset.coverUrl;
    if (!original) return;
    if (!img.dataset.proxyTentado) {
      img.dataset.proxyTentado = '1';
      try {
        const src = await Api.chamar<string | null>('apis:cover', original);
        if (src && img.isConnected) { img.src = src; return; }
      } catch {   }
    }
    const isbn = img.dataset.coverIsbn || '';
    const alternativa = isbn ? Util.urlCapa(`https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`) : null;
    if (alternativa && !img.dataset.alternativaTentada && alternativa !== original) {
      img.dataset.alternativaTentada = '1';
      img.dataset.coverUrl = alternativa;
      img.dataset.proxyTentado = '';
      img.src = alternativa;
      return;
    }
    if (!img.isConnected) return;
    const marcador = this.substituirCapa(img);
    const status = marcador.closest('.cover-preview-row')?.querySelector('#cover-preview-status');
    if (status) status.textContent = 'Capa indisponível para esta edição. Você pode cadastrar o livro mesmo assim.';
  }
}

let instancia: Aplicacao | null = null;
function app(): Aplicacao { return instancia!; }
instancia = new Aplicacao();
