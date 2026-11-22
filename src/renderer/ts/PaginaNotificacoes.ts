class PaginaNotificacoes extends PaginaBase {
  readonly id = 'notifications' as const;
  readonly nome = 'Notificações';
  protected override filtroPadrao = 'pendentes';
  protected override filtro = 'pendentes';
  private static readonly formatarEnvio = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  render(): string {
    const pendentes = this.ctx.estado.notificacoesPendentes;
    const filtros: [string, string, number?][] = [['pendentes', 'Não lidas', pendentes], ['todas', 'Todas']];
    if (this.ctx.ehAdmin) filtros.push(['lembretes', 'Lembretes de devolução']);
    const subtitulo = this.ctx.ehAdmin
      ? 'Acompanhe os lembretes de devolução por e-mail. Para reservas disponíveis, a equipe deve avisar o leitor.'
      : 'Avisos de reservas disponíveis. Entre em contato com o leitor pelo contato cadastrado.';
    return `${Html.cabecalho('Notificações', subtitulo, Html.botao('ler-todas', 'Marcar todas como lidas', 'check2-all', 'btn-soft', pendentes ? '' : 'disabled'))}
      <div class="surface">${Html.barra({ busca: this.busca, atual: this.filtro, placeholder: 'Leitor, livro ou mensagem...', filtros })}${this.area()}</div>`;
  }

  protected override listaHtml(): string {
    const itens = this.ctx.estado.notificacoes
      .filter(n => this.pesquisa(`${n.leitor} ${n.livro ?? ''} ${n.mensagem}`))
      .filter(n => this.filtro === 'todas' || (this.filtro === 'lembretes' ? n.tipo === 'devolucao' : !n.lida));
    if (!itens.length) return Html.vazio(this.busca ? 'Nenhum aviso com essa busca.' : this.filtro === 'pendentes' ? 'Nenhum aviso não lido.' : 'Não há avisos para exibir.', 'bell-slash');
    this.numeroPagina = Math.min(this.numeroPagina, Math.ceil(itens.length / this.porPagina));
    return `<div class="notice-list">${Html.fatiar(itens, this.numeroPagina, this.porPagina).map(n => this.aviso(n)).join('')}</div>
      <div class="table-foot"><span class="count-note">${Util.plural(itens.length, 'aviso', 'avisos')}</span>${Html.paginacao(itens.length, this.numeroPagina, this.porPagina)}</div>`;
  }

  private aviso(n: Notificacao): string {
    const lembrete = n.tipo === 'devolucao';
    const icone = lembrete ? 'envelope' : n.lida ? 'bell' : 'bell-fill';
    const detalhe = lembrete ? this.estadoDoEnvio(n)
      : `<p>${Util.esc(n.mensagem)}</p><small class="small-muted"><i class="bi bi-telephone"></i> ${Util.esc(n.telefone || 'Sem telefone')} &nbsp; <i class="bi bi-envelope"></i> ${Util.esc(n.email || 'Sem e-mail')} &nbsp;·&nbsp; ${Util.esc(Util.dataHora(n.criada_em))}</small>`;
    const leitura = n.lida ? Html.pill('Lido', 'neutral')
      : `<button type="button" class="btn btn-sm btn-soft" data-action="${lembrete ? 'ler-lembrete' : 'ler'}" data-id="${Util.numero(n.id)}">Marcar lido</button>`;
    return `<div class="notice-item ${n.lida ? 'lida' : ''}"><span class="notice-icon" aria-hidden="true"><i class="bi bi-${icone}"></i></span>
      <div class="notice-text"><b>${Util.esc(n.leitor)} · ${Util.esc(n.livro || 'Livro')}</b>${detalhe}</div>
      <div class="notice-actions">${leitura}${lembrete ? '' : Html.botaoIcone('excluir', n.id, 'trash3', 'Excluir aviso', true)}</div></div>`;
  }

  private estadoDoEnvio(n: Notificacao): string {
    let rotulo = 'Envio pendente', tom: Tom = 'neutral', detalhe = 'Aguardando confirmação do envio.';
    if (n.status_envio === 'enviado') {
      rotulo = 'Enviado';
      tom = 'success';
      const instante = Number(n.envio_epoch);
      detalhe = n.envio_epoch !== null && Number.isFinite(instante)
        ? `Envio confirmado em ${PaginaNotificacoes.formatarEnvio.format(instante * 1000)}.`
        : 'Envio aceito pelo provedor.';
    } else if (n.status_envio === 'sem_email') {
      rotulo = 'Sem e-mail';
      tom = 'warning';
      detalhe = 'Não enviado. Cadastre um e-mail válido para o leitor.';
    } else if (n.status_envio === 'falha') {
      rotulo = 'Falha no envio';
      tom = 'danger';
      detalhe = 'Envio não confirmado. Confira a configuração ou o histórico do provedor.';
    } else if (n.data_prevista && n.data_prevista <= Util.hoje()) {
      rotulo = 'Envio não confirmado';
      tom = 'warning';
      detalhe = 'A véspera passou sem confirmação. Confira o histórico do provedor.';
    }
    return `<p>${Util.esc(n.mensagem)} · Devolução em ${Util.esc(Util.data(n.data_prevista))} ${Html.pill(rotulo, tom)}</p><small class="small-muted">${Util.esc(detalhe)}</small>`;
  }

  /** Atualiza a lista sem recriar a busca nem tirar o foco de quem está digitando. */
  atualizarAvisos(): void {
    const pendentes = this.ctx.estado.notificacoesPendentes;
    const contador = document.querySelector('[data-valor="pendentes"] [data-filter-count]');
    if (contador) contador.textContent = String(pendentes);
    const marcarTodas = document.querySelector<HTMLButtonElement>('button[data-action="ler-todas"]');
    if (marcarTodas) marcarTodas.disabled = pendentes === 0;
    const foco = document.activeElement;
    this.atualizarLista();
    if (foco instanceof HTMLButtonElement && !foco.isConnected) {
      const equivalente = Array.from(document.querySelectorAll<HTMLButtonElement>('#area-lista button')).find(botao =>
        botao.dataset.action === foco.dataset.action && botao.dataset.id === foco.dataset.id && botao.dataset.pg === foco.dataset.pg);
      (equivalente ?? document.querySelector<HTMLInputElement>('#busca-local'))?.focus({ preventScroll: true });
    }
  }

  override async acao(nome: string, el: HTMLElement): Promise<void> {
    if (nome === 'ler') await this.executar('notifications:read', Number(el.dataset.id), 'Aviso marcado como lido.');
    else if (nome === 'ler-lembrete') await this.executar('notifications:read-reminder', Number(el.dataset.id), 'Lembrete marcado como lido.');
    else if (nome === 'ler-todas') await this.executar('notifications:readall', null, 'Todos os avisos foram marcados como lidos.');
    else if (nome === 'excluir') await this.confirmarEExecutar({ titulo: 'Excluir aviso?', mensagem: 'O aviso será removido da central.', rotulo: 'Excluir' }, 'notifications:delete', Number(el.dataset.id), 'Aviso excluído.');
    else await super.acao(nome, el);
  }
}
