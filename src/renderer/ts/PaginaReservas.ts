class PaginaReservas extends PaginaBase {
  readonly id = 'reservations' as const;
  readonly nome = 'Reservas';
  protected override filtroPadrao = 'ativas';
  protected override filtro = 'ativas';

  private filtrados(): Registro[] {
    return this.ctx.estado.reservas
      .filter(r => this.pesquisa(`${r.livro} ${r.leitor} ${r.status}`))
      .filter(r => this.filtro === 'todas' || (this.filtro === 'ativas' && ['aguardando', 'disponivel'].includes(r.status)) || (this.filtro === 'encerradas' && ['concluida', 'cancelada'].includes(r.status)));
  }

  render(): string {
    return `${Html.cabecalho('Reservas', 'A fila respeita a ordem dos pedidos. Quando um exemplar volta, o primeiro leitor é avisado.', Html.botao('novo', 'Nova reserva', 'plus-lg'))}
      <div class="surface">${Html.barra({ busca: this.busca, atual: this.filtro, placeholder: 'Livro ou leitor...', filtros: [['ativas', 'Ativas'], ['encerradas', 'Encerradas'], ['todas', 'Todas']] })}${this.area()}</div>`;
  }

  protected override listaHtml(): string {
    const itens = this.filtrados();
    const rotulo: Record<string, [string, Tom]> = { aguardando: ['Na fila', 'warning'], disponivel: ['Retirada liberada', 'success'], concluida: ['Concluída', 'neutral'], cancelada: ['Cancelada', 'neutral'] };
    const linhas = Html.fatiar(itens, this.numeroPagina, this.porPagina).map(r => {
      const [texto, tom] = rotulo[r.status] ?? [r.status, 'neutral'];
      const ativa = ['aguardando', 'disponivel'].includes(r.status);
      return `<tr><td><div class="book-cell">${Html.capa(r.capa_url, 'cover-mini', r.isbn)}<div><div class="cell-title">${Util.esc(r.livro)}</div><div class="cell-sub">Reserva #${Util.numero(r.id)}</div></div></div></td>
        <td><div class="cell-title">${Util.esc(r.leitor)}</div><div class="cell-sub">${Util.esc(r.telefone || r.email || 'Sem contato')}</div></td><td>${Util.data(r.criada_em)}</td><td>${r.status === 'aguardando' ? `#${Util.numero(r.posicao)}` : '—'}</td><td>${Html.pill(texto, tom)}</td>
        <td><div class="cell-actions">${r.status === 'disponivel' ? Html.botaoIcone('emprestar', r.id, 'box-arrow-up-right', 'Registrar retirada (empréstimo)') : ''}${ativa ? Html.botaoIcone('cancelar', r.id, 'x-circle', 'Cancelar reserva', true) : ''}${r.status === 'cancelada' ? Html.botaoIcone('reativar', r.id, 'arrow-counterclockwise', 'Reativar (volta ao fim da fila)') : ''}${this.ctx.ehAdmin ? Html.botaoIcone('excluir', r.id, 'trash3', 'Excluir reserva', true) : ''}</div></td></tr>`;
    });
    return Html.tabela(['LIVRO', 'LEITOR / CONTATO', 'SOLICITADA', 'POSIÇÃO', 'STATUS', 'AÇÕES'], linhas, itens.length, this.numeroPagina, this.porPagina);
  }

  override async acao(nome: string, el: HTMLElement): Promise<void> {
    const r = this.achar(this.ctx.estado.reservas, el);
    switch (nome) {
      case 'novo': this.novo({}); return;
      case 'emprestar': (this.ctx.pagina('loans') as PaginaEmprestimos).novo({ livro_id: r.livro_id, leitor_id: r.leitor_id }); return;
      case 'cancelar': await this.confirmarEExecutar({ titulo: 'Cancelar reserva?', mensagem: `Reserva de ${r.leitor} para "${r.livro}".`, rotulo: 'Cancelar reserva' }, 'reservations:cancel', r.id, 'Reserva cancelada.'); return;
      case 'reativar': await this.executar('reservations:reactivate', r.id, 'Reserva reativada no fim da fila.'); return;
      case 'excluir': await this.confirmarEExecutar({ titulo: 'Excluir reserva?', mensagem: 'O registro e seus avisos serão apagados.', rotulo: 'Excluir' }, 'reservations:delete', r.id, 'Reserva excluída.'); return;
      default: await super.acao(nome, el);
    }
  }

  novo(pre: Registro): void {
    const e = this.ctx.estado;
    Ui.abrirFormulario({
      kicker: 'RESERVAS', titulo: 'Reservar livro', rotuloSalvar: 'Entrar na fila',
      corpo: `${Html.secao('bookmark-heart', 'Reserve títulos sem exemplares livres. O sistema respeita a ordem dos pedidos.')}
        ${Html.selecao('livro_id', 'Livro *', e.livros.filter(l => l.ativo), pre.livro_id, 'required', 'Selecione...', l => `${l.titulo} (${e.livre(l)} livre${e.livre(l) === 1 ? '' : 's'})`)}
        ${Html.selecao('leitor_id', 'Leitor *', e.leitores.filter(l => l.ativo), pre.leitor_id, 'required')}`,
      salvar: async form => { await this.executar('reservations:create', Object.fromEntries(new FormData(form).entries()), 'Reserva incluída na fila!'); }
    });
  }
}
