class PaginaEquipe extends PaginaBase {
  readonly id = 'team' as const;
  readonly nome = 'Equipe';

  render(): string {
    return `${Html.cabecalho('Equipe', 'Apenas administradores cadastram e gerenciam funcionários.', Html.botao('novo', 'Novo colaborador', 'person-plus'))}<div class="surface">${Html.barra({ busca: this.busca, placeholder: 'Nome ou usuário...' })}${this.area()}</div>`;
  }

  protected override listaHtml(): string {
    const itens = this.ctx.estado.equipe.filter(u => this.pesquisa(`${u.nome} ${u.usuario}`));
    const linhas = Html.fatiar(itens, this.numeroPagina, this.porPagina).map(u => {
      const eu = Number(u.id) === Number(this.ctx.usuario.id);
      return `<tr><td><div class="d-flex align-items-center gap-3">${Html.avatar(u.nome)}<div><div class="cell-title">${Util.esc(u.nome)} ${eu ? Html.pill('você', 'info') : ''}</div><div class="cell-sub">@${Util.esc(u.usuario)}</div></div></div></td>
        <td>${Html.pill(u.perfil === 'admin' ? 'Administrador' : 'Atendente', u.perfil === 'admin' ? 'info' : 'neutral')}</td><td>${Html.pill(u.ativo ? 'Ativo' : 'Inativo', u.ativo ? 'success' : 'neutral')}</td><td>${Util.numero(u.emprestimos_registrados)}</td><td>${Util.data(u.criado_em)}</td>
        <td><div class="cell-actions">${Html.botaoIcone('editar', u.id, 'pencil', 'Editar colaborador')}${eu ? '' : Html.botaoIcone('excluir', u.id, 'trash3', 'Excluir colaborador', true)}</div></td></tr>`;
    });
    return Html.tabela(['COLABORADOR', 'PERFIL', 'SITUAÇÃO', 'EMPRÉSTIMOS', 'CADASTRADO', 'AÇÕES'], linhas, itens.length, this.numeroPagina, this.porPagina);
  }

  override async acao(nome: string, el: HTMLElement): Promise<void> {
    const u = this.achar(this.ctx.estado.equipe, el);
    if (nome === 'novo') this.formulario({});
    else if (nome === 'editar') this.formulario(u);
    else if (nome === 'excluir') await this.confirmarEExecutar({ titulo: 'Excluir colaborador?', mensagem: `${u.nome} perderá o acesso. Quem registrou empréstimos só pode ser desativado.`, rotulo: 'Excluir' }, 'staff:delete', u.id, 'Colaborador excluído.');
    else await super.acao(nome, el);
  }

  private formulario(u: Registro): void {
    const edicao = !!u.id;
    Ui.abrirFormulario({
      kicker: 'ACESSO', titulo: edicao ? 'Editar colaborador' : 'Novo colaborador',
      corpo: `${Html.campo('nome', 'Nome do funcionário *', u.nome, 'text', 'required maxlength="120"')}
        ${Html.campo('usuario', 'Usuário *', u.usuario, 'text', `required minlength="3" maxlength="60" pattern="[a-z0-9._\\-]{3,60}" ${edicao ? 'disabled' : ''}`, 'Letras minúsculas, números, ponto, hífen ou sublinhado.')}
        ${Html.campo('senha', edicao ? 'Nova senha (deixe em branco para manter)' : 'Senha inicial (mínimo 10 caracteres) *', '', 'password', `${edicao ? '' : 'required'} minlength="10" maxlength="72" autocomplete="new-password"`)}
        <div class="field-block"><label class="field-label" for="field-perfil">Perfil</label><select class="form-select field-input" name="perfil" id="field-perfil"><option value="atendente" ${u.perfil !== 'admin' ? 'selected' : ''}>Atendente</option><option value="admin" ${u.perfil === 'admin' ? 'selected' : ''}>Administrador</option></select></div>
        ${edicao ? `<label class="switch-row"><input type="checkbox" name="ativo" value="1" ${u.ativo ? 'checked' : ''} /><span>Acesso ativo</span></label>` : ''}
        ${Html.secao('shield-lock', 'A senha é protegida por hash bcrypt no processo principal e nunca é gravada em texto puro.')}`,
      salvar: async form => {
        const f = new FormData(form);
        const dados: Registro = { nome: f.get('nome'), perfil: f.get('perfil'), senha: f.get('senha') || undefined };
        if (edicao) { dados.id = u.id; dados.ativo = f.get('ativo') === '1'; await this.executar('staff:update', dados, 'Colaborador atualizado!'); }
        else { dados.usuario = f.get('usuario'); await this.executar('staff:create', dados, 'Colaborador cadastrado!'); }
      }
    });
  }
}
