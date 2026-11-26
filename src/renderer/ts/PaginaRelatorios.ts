class PaginaRelatorios extends PaginaBase {
  readonly id = 'reports' as const;
  readonly nome = 'Relatórios e backup';

  render(): string {
    const rel: [string, string, string, string][] = [
      ['acervo', 'Acervo', 'Todos os livros com autores, editoras e disponibilidade.', 'bookshelf'],
      ['emprestimos', 'Empréstimos', 'Histórico completo de retiradas e devoluções.', 'arrow-left-right'],
      ['atrasados', 'Atrasos', 'Quem está com livros além do prazo, com dias de atraso.', 'exclamation-triangle'],
      ['leitores', 'Leitores', 'Cadastro de leitores com contatos e uso.', 'people']
    ];
    const admin = this.ctx.ehAdmin;
    return `${Html.cabecalho('Relatórios e backup', 'Gere arquivos para imprimir, abrir no Excel ou guardar uma cópia de segurança.')}
      <div class="surface"><div class="surface-header"><div><h3>Relatórios</h3><p>Escolha o tipo e, na janela de salvar, a extensão: .txt (texto) ou .csv (planilha).</p></div></div>
        <div class="report-grid">${rel.map(([tipo, titulo, texto, icone]) => `<div class="report-card"><span class="stat-icon blue"><i class="bi bi-${icone}"></i></span><h4>${titulo}</h4><p>${texto}</p><button type="button" class="btn btn-soft" data-action="relatorio" data-tipo="${tipo}"><i class="bi bi-download me-2"></i>Exportar</button></div>`).join('')}</div></div>
      <div class="surface mt-4"><div class="surface-header"><div><h3>Backup dos dados</h3><p>Arquivo JSON com livros, autores, editoras, leitores, empréstimos, reservas e avisos.</p></div>${admin ? '' : Html.pill('Somente administradores', 'warning')}</div>
        <div class="backup-row">${Html.secao('shield-lock', 'Por segurança, contas da equipe e senhas não entram no backup. Ao importar, registros de mesmo ID são atualizados e nada é apagado.')}
        <div class="d-flex gap-2 flex-wrap">${Html.botao('backup-exportar', 'Exportar backup', 'cloud-arrow-down', 'btn-primary app-primary', admin ? '' : 'disabled')}${Html.botao('backup-importar', 'Importar backup', 'cloud-arrow-up', 'btn-soft', admin ? '' : 'disabled')}</div></div></div>`;
  }

  override async acao(nome: string, el: HTMLElement): Promise<void> {
    if (nome === 'relatorio') await this.relatorio(el.dataset.tipo || 'acervo');
    else if (nome === 'backup-exportar') await this.backupExportar();
    else if (nome === 'backup-importar') await this.backupImportar();
    else await super.acao(nome, el);
  }

  async relatorio(tipo: string): Promise<void> {
    const r = await Api.chamar<Registro>('files:report', { tipo });
    if (r.salvo) Ui.toast(`Relatório salvo com ${Util.plural(r.registros, 'registro', 'registros')}: ${r.caminho}`);
  }

  async backupExportar(): Promise<void> {
    const r = await Api.chamar<Registro>('files:backup-export');
    if (r.salvo) Ui.toast(`Backup salvo (${Util.plural(r.registros, 'registro', 'registros')}): ${r.caminho}`);
  }

  async backupImportar(): Promise<void> {
    const r = await Api.chamar<Registro>('files:backup-import');
    if (!r.salvo) return;
    await this.ctx.recarregar();
    Ui.toast(`Backup importado: ${Util.plural(r.registros, 'registro processado', 'registros processados')}.`);
  }
}
