/** Orquestra login, navegaÃ§Ã£o entre pÃ¡ginas, eventos globais e tema. */
class Aplicacao {
  private readonly estado = new Estado();
  private usuarioAtual: Registro | null = null;
  private primeiraConfiguracao = false;
  private paginas = new Map<IdPagina, PaginaBase>();
  private atual: IdPagina = 'dashboard';
  private carregando = false;
  private atualizandoAvisos = false;

  private async sincronizarAvisos(): Promise<void> {
    if (!this.usuarioAtual || this.carregando || this.atualizandoAvisos) return;

    const usuario = this.usuarioAtual;
    this.atualizandoAvisos = true;

    try {
      const [avisos, stats] = await Promise.all([
        Api.chamar<Registro[]>('notifications:list'),
        Api.chamar<Registro>('dashboard:stats')
      ]);

      if (this.usuarioAtual !== usuario || this.carregando) return;

      const mudou = JSON.stringify(avisos) !== JSON.stringify(this.estado.notificacoes);
      this.estado.notificacoes = avisos;
      this.estado.stats = stats;
      this.atualizarBadges();

      if (mudou && this.atual === 'notifications') {
        (this.paginas.get('notifications') as PaginaNotificacoes)?.atualizarAvisos();
      }

      if (mudou && this.atual === 'dashboard') {
        this.renderizar();
      }
    } catch {
      // A proxima consulta tentara atualizar novamente.
    } finally {
      this.atualizandoAvisos = false;
    }
  }

  private readonly ctx: Contexto = {
    estado: this.estado,
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
    Api.aoExpirarSessao = () => this.mostrarAutenticacao('SessÃ£o encerrada. FaÃ§a login novamente.');
    document.querySelector<HTMLFormElement>('#auth-form')!.addEventListener('submit', e => void this.autenticar(e));
    document.addEventListener('click', e => void this.clique(e));
    document.addEventListener('submit', e => void this.formulario(e));
    document.addEventListener('input', e => this.entrada(e));
    document.addEventListener('keydown', e => { if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); document.querySelector<HTMLInputElement>('#global-search')?.focus(); } });
    document.addEventListener('error', e => void this.erroCapa(e), true);
    window.biblioteca.aoMenu(acao => void this.acaoMenu(acao));
    void this.inicializar();
    window.setInterval(() => void this.sincronizarAvisos(), 15000);
  }

  // ---------- Tema ----------
  private lerTema(): 'light' | 'dark' {
    try { if (localStorage.getItem('lumi-tema') === 'dark') return 'dark'; } catch { /* sem armazenamento */ }
    return 'light';
  }
  private aplicarTema(tema: 'light' | 'dark'): void {
    document.documentElement.setAttribute('data-bs-theme', tema);
    const icone = document.querySelector('#tema-icone');
    if (icone) icone.className = `bi bi-${tema === 'dark' ? 'sun' : 'moon-stars'}`;
    try { localStorage.setItem('lumi-tema', tema); } catch { /* ignora */ }
  }
  private alternarTema(): void { this.aplicarTema(document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark'); }

  // ---------- AutenticaÃ§Ã£o ----------
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
    if (this.primeiraConfiguracao && valor('#auth-password') !== valor('#auth-confirm')) { this.mostrarErroAuth('As senhas nÃ£o conferem.'); return; }
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
    try { await Api.chamar('auth:logout'); } catch { /* jÃ¡ saiu */ }
    this.paginas.clear();
    this.mostrarAutenticacao();
  }

  // ---------- Shell ----------
  private async mostrarSistema(): Promise<void> {
    const u = this.usuarioAtual ?? {};
    this.paginas = new Map<IdPagina, PaginaBase>([
      new PaginaDashboard(this.ctx), new PaginaLivros(this.ctx), new PaginaEmprestimos(this.ctx), new PaginaReservas(this.ctx), new PaginaLeitores(this.ctx),
      new PaginaAutores(this.ctx), new PaginaEditoras(this.ctx), new PaginaExplorar(this.ctx), new PaginaNotificacoes(this.ctx), new PaginaRelatorios(this.ctx), new PaginaEquipe(this.ctx)
    ].map(p => [p.id, p] as [IdPagina, PaginaBase]));
    document.querySelector('#auth-shell')!.classList.add('d-none');
    document.querySelector('#app-shell')!.classList.remove('d-none');
    const nome = String(u.nome ?? 'UsuÃ¡rio');
    document.querySelector('#user-name')!.textContent = nome.split(' ')[0];
    document.querySelector('#user-avatar')!.textContent = Util.iniciais(nome);
    document.querySelector('#user-role')!.textContent = u.perfil === 'admin' ? 'Administrador' : 'Atendente';
    document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('d-none', u.perfil !== 'admin'));
    document.querySelector('#today')!.textContent = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    await this.recarregar(false);
    this.navegar('dashboard');
  }

  async recarregar(redesenhar = true): Promise<void> {
    if (this.carregando) return;
    this.carregando = true;
    try {
      await this.estado.carregar(this.usuarioAtual?.perfil === 'admin');
      this.atualizarBadges();
    } catch (e) { Ui.toast((e as Error).message, true); } finally { this.carregando = false; }
    if (redesenhar) this.renderizar();
  }

  private atualizarBadges(): void {
    const s = this.estado.stats;
    const badge = (id: string, n: number): void => { const el = document.getElementById(id)!; el.textContent = String(n); el.classList.toggle('d-none', n === 0); };
    badge('side-reserves', Util.numero(s.reservas) + Util.numero(s.retiradas));
    badge('side-notifs', Util.numero(s.avisos));
    document.querySelector('#notif-dot')!.classList.toggle('d-none', !Util.numero(s.avisos));
  }

  private navegar(id: IdPagina): void {
    if (id === 'team' && this.usuarioAtual?.perfil !== 'admin') return;
    const pagina = this.paginas.get(id);
    if (!pagina) return;
    this.atual = id;
    pagina.reiniciar();
    document.querySelectorAll<HTMLElement>('.side-link[data-page]').forEach(e => e.classList.toggle('active', e.dataset.page === id));
    document.querySelector<HTMLInputElement>('#global-search')!.value = '';
    document.querySelector('#breadcrumb')!.textContent = `Biblioteca / ${pagina.nome}`;
    this.renderizar();
    document.querySelector('#page-content')!.scrollTop = 0;
  }

  private renderizar(): void {
    const pagina = this.paginas.get(this.atual);
    if (!pagina) return;
    const raiz = document.querySelector('#page-content')!;
    raiz.innerHTML = `<div class="page-fade">${pagina.render()}</div>`;
    pagina.montar();
  }

  // ---------- Eventos ----------
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
      // MantÃ©m a busca do topo e a da lista sincronizadas.
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

  /** Alterar a prÃ³pria senha (qualquer perfil). */
  private abrirPerfil(): void {
    const u = this.usuarioAtual ?? {};
    Ui.abrirFormulario({
      kicker: 'MINHA CONTA', titulo: 'Perfil e senha', rotuloSalvar: 'Alterar senha',
      corpo: `<div class="detail-hero compact">${Html.avatar(u.nome, 'avatar lg')}<div><h3>${Util.esc(u.nome)}</h3><p class="small-muted">@${Util.esc(u.usuario)} Â· ${u.perfil === 'admin' ? 'Administrador' : 'Atendente'}</p></div></div>
        ${Html.campo('atual', 'Senha atual *', '', 'password', 'required autocomplete="current-password"')}
        ${Html.campo('nova', 'Nova senha (mÃ­nimo 10 caracteres) *', '', 'password', 'required minlength="10" maxlength="72" autocomplete="new-password"')}
        ${Html.campo('confirmar', 'Repita a nova senha *', '', 'password', 'required minlength="10" maxlength="72" autocomplete="new-password"')}`,
      salvar: async form => {
        const f = new FormData(form);
        if (f.get('nova') !== f.get('confirmar')) throw new Error('As senhas novas nÃ£o conferem.');
        await Api.chamar('auth:password', { atual: f.get('atual'), nova: f.get('nova') });
        Ui.toast('Senha alterada com sucesso!');
      }
    });
  }

  // ---------- Capas (imagens) ----------
  /** Se a imagem remota falhar, o main baixa por Axios (domÃ­nio/tipo/tamanho validados); sem isso, mostra o Ã­cone. */
  private async erroCapa(evento: Event): Promise<void> {
    const img = evento.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.coverUrl) return;
    const original = img.dataset.coverUrl;
    if (!img.dataset.proxyTentado) {
      img.dataset.proxyTentado = '1';
      try {
        const src = await Api.chamar<string | null>('apis:cover', original);
        if (src && img.isConnected) { img.src = src; return; }
      } catch { /* cai para a alternativa */ }
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
    const marcador = document.createElement('span');
    marcador.className = `${img.className} cover-placeholder`;
    marcador.innerHTML = '<i class="bi bi-book"></i>';
    img.replaceWith(marcador);
    const status = document.querySelector('#cover-preview-status');
    if (status && marcador.closest('#book-cover-preview')) status.textContent = 'Capa indisponÃ­vel para esta ediÃ§Ã£o. VocÃª pode cadastrar o livro mesmo assim.';
  }
}

let instancia: Aplicacao | null = null;
function app(): Aplicacao { return instancia!; }
instancia = new Aplicacao();

