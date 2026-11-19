class PaginaEmprestimos extends PaginaBase {
  readonly id = 'loans' as const;
  readonly nome = 'Empréstimos';
  protected override filtroPadrao = 'ativos';
  protected override filtro = 'ativos';

  private filtrados(): Registro[] {
    return this.ctx.estado.emprestimos
      .filter(l => this.pesquisa(`${l.livro} ${l.leitor} ${l.situacao} ${l.atendente}`))
      .filter(l => this.filtro === 'todos' || (this.filtro === 'ativos' && !l.data_devolucao) || (this.filtro === 'atrasados' && l.situacao === 'atrasado') || (this.filtro === 'devolvidos' && !!l.data_devolucao));
  }

  render(): string {
    return `${Html.cabecalho('Empréstimos', 'Acompanhe prazos, atrasos e devoluções em um só lugar.', Html.botao('novo', 'Novo empréstimo', 'plus-lg'))}
      <div class="surface">${Html.barra({ busca: this.busca, atual: this.filtro, placeholder: 'Livro, leitor ou atendente...', filtros: [['ativos', 'Em aberto'], ['atrasados', 'Atrasados'], ['devolvidos', 'Devolvidos'], ['todos', 'Todos']] })}${this.area()}</div>`;
  }

  protected override listaHtml(): string {
    const itens = this.filtrados();
    const linhas = Html.fatiar(itens, this.numeroPagina, this.porPagina).map(l => {
      const aberto = !l.data_devolucao;
      const status = l.situacao === 'devolvido' ? Html.pill('Devolvido', 'neutral') : l.situacao === 'atrasado' ? Html.pill(`Atrasado · ${Util.plural(Util.numero(l.dias_atraso), 'dia', 'dias')}`, 'danger') : Html.pill('Em dia', 'success');
      return `<tr><td><div class="book-cell">${Html.capa(l.capa_url, 'cover-mini', l.isbn)}<div><div class="cell-title">${Util.esc(l.livro)}</div><div class="cell-sub">#${Util.numero(l.id)} · ${Util.esc(l.atendente)}</div></div></div></td>
        <td><div class="d-flex align-items-center gap-2">${Html.avatar(l.leitor, 'avatar sm')}<span class="cell-title">${Util.esc(l.leitor)}</span></div></td><td>${Util.data(l.data_retirada)}</td><td>${Util.data(l.data_prevista)}</td><td>${Util.data(l.data_devolucao)}</td><td>${status}</td>
        <td><div class="cell-actions">${aberto ? Html.botaoIcone('devolver', l.id, 'arrow-return-left', 'Registrar devolução') + Html.botaoIcone('renovar', l.id, 'calendar2-plus', 'Renovar / ajustar prazo') : ''}${this.ctx.ehAdmin ? Html.botaoIcone('excluir', l.id, 'trash3', 'Excluir registro', true) : ''}</div></td></tr>`;
    });
    return Html.tabela(['LIVRO', 'LEITOR', 'RETIRADA', 'PRAZO', 'DEVOLVIDO', 'STATUS', 'AÇÕES'], linhas, itens.length, this.numeroPagina, this.porPagina);
  }

  override async acao(nome: string, el: HTMLElement): Promise<void> {
    const emp = this.achar(this.ctx.estado.emprestimos, el);
    switch (nome) {
      case 'novo': this.novo({}); return;
      case 'devolver':
        await this.confirmarEExecutar({ titulo: 'Registrar devolução?', mensagem: `"${emp.livro}" de ${emp.leitor}. Se houver fila, o próximo leitor será avisado.`, rotulo: 'Confirmar devolução', perigo: false, icone: 'arrow-return-left' }, 'loans:return', emp.id, 'Devolução registrada.'); return;
      case 'renovar': this.renovar(emp); return;
      case 'excluir':
        await this.confirmarEExecutar({ titulo: 'Excluir registro de empréstimo?', mensagem: 'O registro será apagado do histórico. Use apenas para corrigir lançamentos errados.', rotulo: 'Excluir' }, 'loans:delete', emp.id, 'Registro excluído.'); return;
      case 'calcular-prazo': await this.calcularPrazo(el.dataset.alvo || 'data_prevista', el.dataset.inicio || 'data_retirada', el.dataset.dias || 'prazo-dias', el.dataset.ajuda || 'prazo-ajuda'); return;
      default: await super.acao(nome, el);
    }
  }

  private blocoPrazo(inicio: string, alvo: string, padrao = '10'): string {
    const opcoes = ['5', '7', '10', '14', '21'].map(n => `<option value="${n}" ${n === padrao ? 'selected' : ''}>${n} dias úteis</option>`).join('');
    return `<div class="field-block"><label class="field-label" for="prazo-dias">Calcular prazo em dias úteis (BrasilAPI)</label><div class="d-flex gap-2"><select class="form-select" id="prazo-dias">${opcoes}</select>
      <button type="button" class="btn btn-soft" data-action="loans.calcular-prazo" data-alvo="${alvo}" data-inicio="${inicio}"><i class="bi bi-calendar-check me-1"></i> Calcular</button></div>
      <div class="field-helper" id="prazo-ajuda">Considera fins de semana e feriados nacionais. Você também pode escolher a data manualmente.</div></div>`;
  }

  novo(pre: Registro): void {
    const e = this.ctx.estado, hoje = Util.hoje();
    const livros = e.livros.filter(l => l.ativo && (e.livre(l) > 0 || String(l.id) === String(pre.livro_id)));
    const leitores = e.leitores.filter(l => l.ativo);
    Ui.abrirFormulario({
      kicker: 'CIRCULAÇÃO', titulo: 'Novo empréstimo', rotuloSalvar: 'Registrar empréstimo',
      corpo: `${Html.secao('arrow-left-right', 'O estoque e as reservas são conferidos de novo no banco ao confirmar.')}
        ${Html.selecao('livro_id', 'Livro *', livros, pre.livro_id, 'required', 'Selecione...', l => `${l.titulo} (${e.livre(l)} livre${e.livre(l) === 1 ? '' : 's'})`)}
        ${Html.selecao('leitor_id', 'Leitor *', leitores, pre.leitor_id, 'required')}
        <div class="two-fields">${Html.campo('data_retirada', 'Data da retirada *', hoje, 'date', 'required')}${Html.campo('data_prevista', 'Prazo de devolução *', Util.somarDias(hoje, 14), 'date', 'required')}</div>${this.blocoPrazo('data_retirada', 'data_prevista')}`,
      salvar: async form => { await this.executar('loans:borrow', Object.fromEntries(new FormData(form).entries()), 'Empréstimo registrado!'); }
    });
  }

  private renovar(emp: Registro): void {
    if (!emp.id) return;
    Ui.abrirFormulario({
      kicker: 'CIRCULAÇÃO', titulo: 'Renovar empréstimo', rotuloSalvar: 'Salvar novo prazo',
      corpo: `<div class="detail-hero compact">${Html.capa(emp.capa_url, 'cover-mini', emp.isbn)}<div><h3>${Util.esc(emp.livro)}</h3><p class="small-muted">${Util.esc(emp.leitor)} · retirada em ${Util.data(emp.data_retirada)} · prazo atual ${Util.data(emp.data_prevista)}</p></div></div>
        <input type="hidden" id="field-data_retirada" value="${Util.esc(String(emp.data_prevista).slice(0, 10))}" />
        ${Html.campo('data_prevista', 'Novo prazo de devolução *', Util.somarDias(Util.hoje(), 7), 'date', `required min="${Util.esc(String(emp.data_retirada).slice(0, 10))}"`)}${this.blocoPrazo('data_retirada', 'data_prevista', '7')}
        ${Html.secao('info-circle', 'Não é possível estender o prazo se houver leitores na fila de reserva deste livro.')}`,
      salvar: async form => { await this.executar('loans:renew', { id: emp.id, data_prevista: new FormData(form).get('data_prevista') }, 'Prazo atualizado!'); }
    });
  }

  /** API 4 (BrasilAPI): calcula o vencimento em dias úteis descontando feriados nacionais. */
  private async calcularPrazo(alvo: string, inicioId: string, diasId: string, ajudaId: string): Promise<void> {
    const inicio = document.querySelector<HTMLInputElement>(`#field-${inicioId}`)?.value || Util.hoje();
    const dias = Number(document.querySelector<HTMLSelectElement>(`#${diasId}`)?.value);
    const r = await Api.chamar<{ vencimento: string; feriadosConsiderados: string[]; aviso?: string }>('apis:holidays', { inicio, dias });
    const campo = document.querySelector<HTMLInputElement>(`#field-${alvo}`);
    if (campo) campo.value = r.vencimento;
    const texto = r.feriadosConsiderados.length ? `Feriados no intervalo: ${r.feriadosConsiderados.join('; ')}.` : 'Nenhum feriado nacional no intervalo.';
    const ajuda = document.querySelector(`#${ajudaId}`);
    if (ajuda) ajuda.textContent = r.aviso ? r.aviso : `Prazo calculado pela BrasilAPI. ${texto}`;
    Ui.toast(`Prazo calculado: ${Util.data(r.vencimento)}.`);
  }
}
