class PaginaNotificacoes extends PaginaBase {
  readonly id = 'notifications' as const;
  readonly nome = 'Notificações';
  protected override filtroPadrao = 'pendentes';
  protected override filtro = 'pendentes';

  render(): string {
    const pendentes = this.ctx.estado.notificacoes.filter(n => !n.lida).length;
    return `${Html.cabecalho('Notificações', 'Avisos gerados quando livros reservados ficam disponíveis. O app não envia mensagens: avise o leitor pelo contato cadastrado.', pendentes ? Html.botao('ler-todas', 'Marcar todas como lidas', 'check2-all', 'btn-soft') : '')}
      <div class="surface">${Html.barra({ busca: this.busca, atual: this.filtro, placeholder: 'Leitor, livro ou mensagem...', filtros: [['pendentes', `Pendentes (${pendentes})`], ['todas', 'Todas']] })}${this.area()}</div>`;
  }

  protected override listaHtml(): string {
    const itens = this.ctx.estado.notificacoes.filter(n => this.pesquisa(`${n.leitor} ${n.livro} ${n.mensagem}`)).filter(n => this.filtro === 'todas' || !n.lida);
    if (!itens.length) return Html.vazio(this.filtro === 'pendentes' ? 'Nenhum aviso pendente. Tudo em dia!' : 'Os avisos de reservas aparecerão aqui.', 'bell-slash');
    return `<div class="notice-list">${Html.fatiar(itens, this.numeroPagina, this.porPagina).map(n => `<div class="notice-item ${n.lida ? 'lida' : ''}"><span class="notice-icon"><i class="bi bi-bell${n.lida ? '' : '-fill'}"></i></span>
      <div class="notice-text"><b>${Util.esc(n.leitor)} · ${Util.esc(n.livro || 'Livro')}</b><p>${Util.esc(n.mensagem)}</p><small class="small-muted"><i class="bi bi-telephone"></i> ${Util.esc(n.telefone || 'Sem telefone')} &nbsp; <i class="bi bi-envelope"></i> ${Util.esc(n.email || 'Sem e-mail')} &nbsp;·&nbsp; ${Util.dataHora(n.criada_em)}</small></div>
      <div class="notice-actions">${n.lida ? Html.pill('Lido', 'neutral') : `<button type="button" class="btn btn-sm btn-soft" data-action="ler" data-id="${Util.numero(n.id)}">Marcar lido</button>`}${Html.botaoIcone('excluir', n.id, 'trash3', 'Excluir aviso', true)}</div></div>`).join('')}</div>
      <div class="table-foot"><span class="count-note">${Util.plural(itens.length, 'aviso', 'avisos')}</span>${Html.paginacao(itens.length, this.numeroPagina, this.porPagina)}</div>`;
  }

  override async acao(nome: string, el: HTMLElement): Promise<void> {
    if (nome === 'ler') await this.executar('notifications:read', Number(el.dataset.id), 'Aviso marcado como lido.');
    else if (nome === 'ler-todas') await this.executar('notifications:readall', null, 'Todos os avisos foram marcados como lidos.');
    else if (nome === 'excluir') await this.confirmarEExecutar({ titulo: 'Excluir aviso?', mensagem: 'O aviso será removido da central.', rotulo: 'Excluir' }, 'notifications:delete', Number(el.dataset.id), 'Aviso excluído.');
    else await super.acao(nome, el);
  }
}
