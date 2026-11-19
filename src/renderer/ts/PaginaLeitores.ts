class PaginaLeitores extends PaginaBase {
  readonly id = 'readers' as const;
  readonly nome = 'Leitores';
  protected override filtroPadrao = 'ativos';
  protected override filtro = 'ativos';

  render(): string {
    return `${Html.cabecalho('Leitores', 'Pessoas que tornam a biblioteca um lugar vivo.', Html.botao('novo', 'Cadastrar leitor', 'person-plus'))}
      <div class="surface">${Html.barra({ busca: this.busca, atual: this.filtro, placeholder: 'Nome, e-mail, telefone ou cidade...', filtros: [['ativos', 'Ativos'], ['inativos', 'Inativos'], ['todos', 'Todos']] })}${this.area()}</div>`;
  }

  protected override listaHtml(): string {
    const itens = this.ctx.estado.leitores
      .filter(r => this.pesquisa([r.nome, r.email, r.telefone, r.cidade, r.uf].join(' ')))
      .filter(r => this.filtro === 'todos' || (this.filtro === 'ativos' && r.ativo) || (this.filtro === 'inativos' && !r.ativo));
    const linhas = Html.fatiar(itens, this.numeroPagina, this.porPagina).map(r => `<tr><td><div class="d-flex align-items-center gap-3">${Html.avatar(r.nome)}<div><div class="cell-title">${Util.esc(r.nome)}</div><div class="cell-sub">Cadastro #${Util.numero(r.id)}</div></div></div></td>
      <td>${Util.esc(r.email || '—')}</td><td>${Util.esc(r.telefone || '—')}</td><td>${Util.esc([r.cidade, r.uf].filter(Boolean).join(' / ') || '—')}</td><td>${Util.numero(r.emprestimos_ativos)}</td><td>${Html.pill(r.ativo ? 'Ativo' : 'Inativo', r.ativo ? 'success' : 'neutral')}</td>
      <td><div class="cell-actions">${Html.botaoIcone('historico', r.id, 'clock-history', 'Ver histórico')}${Html.botaoIcone('editar', r.id, 'pencil', 'Editar leitor')}${this.ctx.ehAdmin ? (r.ativo ? Html.botaoIcone('desativar', r.id, 'person-x', 'Desativar leitor', true) : Html.botaoIcone('reativar', r.id, 'person-check', 'Reativar leitor')) + Html.botaoIcone('excluir', r.id, 'trash3', 'Excluir leitor', true) : ''}</div></td></tr>`);
    return Html.tabela(['LEITOR', 'E-MAIL', 'TELEFONE', 'CIDADE / UF', 'COM LIVROS', 'STATUS', 'AÇÕES'], linhas, itens.length, this.numeroPagina, this.porPagina);
  }

  override async acao(nome: string, el: HTMLElement): Promise<void> {
    const r = this.achar(this.ctx.estado.leitores, el);
    switch (nome) {
      case 'novo': this.formulario({}); return;
      case 'editar': this.formulario(r); return;
      case 'historico': this.historico(r); return;
      case 'desativar': await this.confirmarEExecutar({ titulo: 'Desativar leitor?', mensagem: `${r.nome} não poderá fazer empréstimos nem reservas até ser reativado.`, rotulo: 'Desativar' }, 'readers:disable', r.id, 'Leitor desativado.'); return;
      case 'reativar': await this.executar('readers:enable', r.id, 'Leitor reativado.'); return;
      case 'excluir': await this.confirmarEExecutar({ titulo: 'Excluir leitor?', mensagem: `${r.nome} será apagado. Leitores com histórico só podem ser desativados.`, rotulo: 'Excluir' }, 'readers:delete', r.id, 'Leitor excluído.'); return;
      case 'cep': await this.consultarCep(); return;
      default: await super.acao(nome, el);
    }
  }

  private historico(r: Registro): void {
    if (!r.id) return;
    const e = this.ctx.estado;
    const emp = e.emprestimos.filter(x => String(x.leitor_id) === String(r.id));
    const res = e.reservas.filter(x => String(x.leitor_id) === String(r.id));
    Ui.abrirFormulario({
      kicker: 'LEITOR', titulo: 'Histórico do leitor', somenteLeitura: true, tamanho: 'lg',
      corpo: `<div class="detail-hero compact">${Html.avatar(r.nome, 'avatar lg')}<div><h3>${Util.esc(r.nome)}</h3><p class="small-muted">${Util.esc([r.email, r.telefone].filter(Boolean).join(' · ') || 'Sem contato')}</p></div></div>
        <div class="field-block"><span class="field-label">Empréstimos (${emp.length})</span>${emp.length ? emp.map(x => `<div class="mini-row"><b>${Util.esc(x.livro)}</b><span>${Util.data(x.data_retirada)} → ${Util.data(x.data_devolucao || x.data_prevista)}</span>${Html.pill(x.situacao === 'devolvido' ? 'Devolvido' : x.situacao === 'atrasado' ? 'Atrasado' : 'Em dia', x.situacao === 'devolvido' ? 'neutral' : x.situacao === 'atrasado' ? 'danger' : 'success')}</div>`).join('') : '<span class="small-muted">Nenhum empréstimo.</span>'}</div>
        <div class="field-block"><span class="field-label">Reservas (${res.length})</span>${res.length ? res.map(x => `<div class="mini-row"><b>${Util.esc(x.livro)}</b><span>${Util.data(x.criada_em)}</span>${Html.pill(x.status, x.status === 'disponivel' ? 'success' : x.status === 'aguardando' ? 'warning' : 'neutral')}</div>`).join('') : '<span class="small-muted">Nenhuma reserva.</span>'}</div>`
    });
  }

  formulario(r: Registro): void {
    Ui.abrirFormulario({
      kicker: 'LEITOR', titulo: r.id ? 'Editar leitor' : 'Cadastrar leitor',
      corpo: `${Html.campo('nome', 'Nome completo *', r.nome, 'text', 'required maxlength="160"')}
        <div class="two-fields">${Html.campo('email', 'E-mail', r.email, 'email', 'maxlength="180" placeholder="nome@exemplo.com"')}${Html.campo('telefone', 'Telefone', r.telefone, 'tel', 'maxlength="24" placeholder="(19) 99999-9999"')}</div>
        <div class="field-block"><label class="field-label" for="reader-cep">Consulta de CEP (opcional)</label><div class="d-flex gap-2"><input class="form-control field-input" id="reader-cep" inputmode="numeric" maxlength="9" placeholder="13480-000" /><button class="btn btn-soft" type="button" data-action="readers.cep"><i class="bi bi-geo-alt me-1"></i> Consultar</button></div><div class="field-helper">O ViaCEP preenche só cidade e UF. Endereço e CEP não são armazenados.</div></div>
        <div class="two-fields">${Html.campo('cidade', 'Cidade', r.cidade, 'text', 'maxlength="100"')}${Html.campo('uf', 'UF', r.uf, 'text', 'maxlength="2" placeholder="SP"')}</div>`,
      salvar: async form => {
        const dados: Registro = Object.fromEntries(new FormData(form).entries());
        if (r.id) dados.id = r.id;
        await this.executar('readers:save', dados, r.id ? 'Leitor atualizado!' : 'Leitor cadastrado!');
      }
    });
  }

  /** API 3 (ViaCEP): preenche cidade e UF. */
  private async consultarCep(): Promise<void> {
    const cep = document.querySelector<HTMLInputElement>('#reader-cep')?.value ?? '';
    const r = await Api.chamar<{ cidade: string; uf: string }>('apis:cep', cep);
    document.querySelector<HTMLInputElement>('#field-cidade')!.value = r.cidade;
    document.querySelector<HTMLInputElement>('#field-uf')!.value = r.uf;
    Ui.toast('Cidade e UF preenchidas com o ViaCEP.');
  }
}
