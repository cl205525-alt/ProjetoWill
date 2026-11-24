/** Cache dos dados exibidos. Após qualquer alteração, tudo é recarregado do MySQL (a lista nunca fica velha). */
class Estado {
  livros: Registro[] = [];
  leitores: Registro[] = [];
  emprestimos: Registro[] = [];
  reservas: Registro[] = [];
  autores: Registro[] = [];
  editoras: Registro[] = [];
  notificacoes: Registro[] = [];
  equipe: Registro[] = [];
  stats: Registro = {};
  graficos: Registro | null = null;
  private versaoCarga = 0;

  get notificacoesPendentes(): number {
    return Math.max(0, Util.numero(this.stats.avisos));
  }

  async carregar(admin: boolean): Promise<void> {
    const versao = ++this.versaoCarga;
    const [livros, leitores, emprestimos, reservas, autores, editoras, notificacoes, stats, graficos] = await Promise.all([
      Api.chamar<Registro[]>('books:list'), Api.chamar<Registro[]>('readers:list'), Api.chamar<Registro[]>('loans:list'),
      Api.chamar<Registro[]>('reservations:list'), Api.chamar<Registro[]>('authors:list'), Api.chamar<Registro[]>('publishers:list'),
      Api.chamar<Registro[]>('notifications:list'), Api.chamar<Registro>('dashboard:stats'), Api.chamar<Registro>('dashboard:charts')
    ]);
    if (versao !== this.versaoCarga) return;
    Object.assign(this, { livros, leitores, emprestimos, reservas, autores, editoras, notificacoes, stats, graficos });
    const equipe = admin ? await Api.chamar<Registro[]>('staff:list') : [];
    if (versao === this.versaoCarga) this.equipe = equipe;
  }

  livre(livro: Registro): number { return Util.numero(livro.quantidade) - Util.numero(livro.emprestados) - Util.numero(livro.separados); }
  livroPorId(id: unknown): Registro | undefined { return this.livros.find(l => String(l.id) === String(id)); }
  leitorPorId(id: unknown): Registro | undefined { return this.leitores.find(l => String(l.id) === String(id)); }
}

