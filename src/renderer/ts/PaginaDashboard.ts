class PaginaDashboard extends PaginaBase {
  readonly id = 'dashboard' as const;
  readonly nome = 'Visão geral';

  render(): string {
    const e = this.ctx.estado, s = e.stats, g = e.graficos;
    const pessoa = String(this.ctx.usuario.nome ?? 'Usuario').trim().split(' ')[0];
    const cartoes: [string, unknown, string, string, IdPagina][] = [
      ['Títulos no acervo', s.titulos, 'bookshelf', 'blue', 'books'], ['Exemplares', s.exemplares, 'collection', 'purple', 'books'],
      ['Leitores ativos', s.leitores, 'people', 'green', 'readers'], ['Empréstimos ativos', s.emprestimos, 'arrow-left-right', 'orange', 'loans'],
      ['Em atraso', s.atrasados, 'exclamation-triangle', 'red', 'loans'], ['Fila de reservas', s.reservas, 'bookmark-heart', 'teal', 'reservations'],
      ['Prontos p/ retirada', s.retiradas, 'box-seam', 'indigo', 'reservations'], ['Avisos pendentes', e.notificacoesPendentes, 'bell', 'pink', 'notifications']
    ];
    const atrasados = e.emprestimos.filter(l => l.situacao === 'atrasado').sort((a, b) => Util.numero(b.dias_atraso) - Util.numero(a.dias_atraso)).slice(0, 5);
    const proximos = e.emprestimos.filter(l => !l.data_devolucao && l.situacao !== 'atrasado').slice(0, 5);
    const novos = e.livros.filter(l => l.ativo).slice(0, 5);
    const linha = (l: Registro, extra: string): string => `<div class="entry-row">${Html.capa(l.capa_url, 'cover-mini', l.isbn)}<div class="entry-info"><b>${Util.esc(l.livro)}</b><small>${Util.esc(l.leitor)} · prazo ${Util.esc(Util.data(l.data_prevista))}</small></div>${extra}</div>`;
    return `${Html.cabecalho(`Olá, ${pessoa}! 👋`, 'Aqui está o que acontece na sua biblioteca hoje.')}
      <section class="hero"><div class="hero-text"><span class="eyebrow light">A SUA BIBLIOTECA EM BOAS MÃOS</span><h2>Todo livro tem uma história.<br />Ajude alguém a encontrá-la.</h2><p>Organize o acervo, acompanhe empréstimos e conecte mais leitores às histórias certas.</p>
        <div class="hero-buttons">${Html.botao('loans.novo', 'Novo empréstimo', 'plus-lg', 'btn-light')}${Html.botao('books.novo', 'Cadastrar livro', 'book', 'btn-hero-outline')}</div></div>
        <div class="hero-books" aria-hidden="true"><div class="hbook"></div><div class="hbook"></div><div class="hbook"></div><div class="hbook"></div><div class="hbook"></div></div></section>
      <div class="stats-grid">${cartoes.map(([rotulo, valor, icone, cor, pagina]) => `<button type="button" class="stat-card" data-page="${pagina}"><span class="stat-icon ${cor}"><i class="bi bi-${icone}"></i></span><strong>${Util.milhar(valor)}</strong><p>${rotulo}</p></button>`).join('')}</div>
      <div class="charts-grid">
        <div class="surface chart-card"><div class="surface-header"><div><h3>Empréstimos por mês</h3><p>Últimos 6 meses</p></div></div>${g ? Graficos.barrasMensais(g.meses) : ''}</div>
        <div class="surface chart-card"><div class="surface-header"><div><h3>Situação dos empréstimos</h3><p>Visão do histórico completo</p></div></div>${g ? Graficos.rosca(g.situacao) : ''}</div>
        <div class="surface chart-card"><div class="surface-header"><div><h3>Livros mais emprestados</h3><p>Top 5 de todos os tempos</p></div></div>${g ? Graficos.barrasHorizontais(g.topLivros.map((l: Registro) => ({ rotulo: l.titulo, total: l.total })), 'Os empréstimos aparecerão aqui.') : ''}</div>
        <div class="surface chart-card"><div class="surface-header"><div><h3>Acervo por gênero</h3><p>Exemplares ativos</p></div></div>${g ? Graficos.barrasHorizontais(g.generos.map((l: Registro) => ({ rotulo: l.genero, total: l.total })), 'Cadastre livros com gênero para ver o gráfico.') : ''}</div>
      </div>
      <div class="dashboard-grid">
        <div class="surface"><div class="surface-header"><div><h3>Atenção: devoluções em atraso</h3><p>Entre em contato com os leitores</p></div><button type="button" class="text-link" data-page="loans">Ver todos <i class="bi bi-arrow-right"></i></button></div><div class="entry-list">${atrasados.length ? atrasados.map(l => linha(l, Html.pill(Util.plural(Util.numero(l.dias_atraso), 'dia', 'dias'), 'danger'))).join('') : Html.vazio('Nenhum atraso. Excelente!', 'emoji-smile')}</div></div>
        <div class="surface"><div class="surface-header"><div><h3>Próximas devoluções</h3><p>Empréstimos em dia</p></div></div><div class="entry-list">${proximos.length ? proximos.map(l => linha(l, Html.pill('Em dia', 'success'))).join('') : Html.vazio('Os empréstimos feitos aparecerão aqui.')}</div></div>
      </div>
      <div class="surface mt-4"><div class="surface-header"><div><h3>Recém-adicionados ao acervo</h3><p>Os últimos títulos catalogados</p></div><button type="button" class="text-link" data-page="books">Ver acervo <i class="bi bi-arrow-right"></i></button></div>
        <div class="entry-list">${novos.length ? novos.map(l => `<div class="entry-row">${Html.capa(l.capa_url, 'cover-mini', l.isbn)}<div class="entry-info"><b>${Util.esc(l.titulo)}</b><small>${Util.esc(l.autores || 'Autoria não informada')}</small></div>${Html.pill(`${e.livre(l)} livre(s)`, 'info')}</div>`).join('') : Html.vazio('Cadastre seu primeiro livro para começar.')}</div></div>`;
  }
}

