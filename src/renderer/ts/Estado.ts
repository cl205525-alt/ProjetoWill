class Estado {
  livros: Registro[] = [];
  leitores: Registro[] = [];
  emprestimos: Registro[] = [];
  reservas: Registro[] = [];
  autores: Registro[] = [];
  editoras: Registro[] = [];
  notificacoes: Notificacao[] = [];
  notificacoesPendentes = 0;
  equipe: Registro[] = [];
  stats: Registro = {};
  graficos: Registro | null = null;
  private consultaNotificacoes = 0;

  async carregar(admin: boolean): Promise<void> {
    const [livros, leitores, emprestimos, reservas, autores, editoras, stats, graficos] = await Promise.all([
      Api.chamar<Registro[]>('books:list'), Api.chamar<Registro[]>('readers:list'), Api.chamar<Registro[]>('loans:list'),
      Api.chamar<Registro[]>('reservations:list'), Api.chamar<Registro[]>('authors:list'), Api.chamar<Registro[]>('publishers:list'),
      Api.chamar<Registro>('dashboard:stats'), Api.chamar<Registro>('dashboard:charts'), this.carregarNotificacoes()
    ]);
    Object.assign(this, { livros, leitores, emprestimos, reservas, autores, editoras, stats, graficos });
    this.equipe = admin ? await Api.chamar<Registro[]>('staff:list') : [];
  }

  async carregarNotificacoes(): Promise<boolean> {
    const consulta = ++this.consultaNotificacoes;
    const resumo = await Api.chamar<ResumoNotificacoes>('notifications:list');
    if (consulta !== this.consultaNotificacoes) return false;
    this.notificacoes = resumo.itens;
    this.notificacoesPendentes = resumo.pendentes;
    return true;
  }

  livre(livro: Registro): number { return Util.numero(livro.quantidade) - Util.numero(livro.emprestados) - Util.numero(livro.separados); }
  livroPorId(id: unknown): Registro | undefined { return this.livros.find(l => String(l.id) === String(id)); }
  leitorPorId(id: unknown): Registro | undefined { return this.leitores.find(l => String(l.id) === String(id)); }
}
