/** Gráficos em SVG/HTML puros (sem bibliotecas). Cores vêm de classes CSS, compatíveis com o tema escuro. */
class Graficos {
  static barrasMensais(meses: { mes: string; total: number }[]): string {
    const maximo = Math.max(1, ...meses.map(m => m.total));
    const largura = 420, altura = 190, base = 160, passo = largura / meses.length, barra = 34;
    const colunas = meses.map((m, i) => {
      const h = Math.round((m.total / maximo) * 120);
      const x = Math.round(i * passo + (passo - barra) / 2);
      return `<g><rect class="g-bar ${i === meses.length - 1 ? 'atual' : ''}" x="${x}" y="${base - h}" width="${barra}" height="${Math.max(h, 2)}" rx="7" />
        <text class="g-valor" x="${x + barra / 2}" y="${base - h - 8}" text-anchor="middle">${Util.numero(m.total)}</text>
        <text class="g-rotulo" x="${x + barra / 2}" y="${base + 20}" text-anchor="middle">${Util.esc(Util.mesCurto(m.mes))}</text></g>`;
    }).join('');
    return `<svg class="g-svg" viewBox="0 0 ${largura} ${altura}" role="img" aria-label="Empréstimos por mês"><line class="g-eixo" x1="0" y1="${base}" x2="${largura}" y2="${base}" />${colunas}</svg>`;
  }

  static rosca(situacao: { em_dia: number; atrasados: number; devolvidos: number }): string {
    const emDia = Util.numero(situacao.em_dia), atrasados = Util.numero(situacao.atrasados), devolvidos = Util.numero(situacao.devolvidos);
    const total = emDia + atrasados + devolvidos;
    const partes: [number, string][] = [[emDia, 'seg-ok'], [atrasados, 'seg-late'], [devolvidos, 'seg-done']];
    let acumulado = 0;
    const arcos = total === 0 ? '' : partes.filter(([n]) => n > 0).map(([n, classe]) => {
      const pct = (n / total) * 100;
      const arco = `<circle class="g-seg ${classe}" cx="21" cy="21" r="15.915" fill="none" stroke-width="5.5" stroke-dasharray="${pct.toFixed(2)} ${(100 - pct).toFixed(2)}" stroke-dashoffset="${(25 - acumulado).toFixed(2)}" />`;
      acumulado += pct;
      return arco;
    }).join('');
    const legenda = [['seg-ok', 'Em dia', emDia], ['seg-late', 'Atrasados', atrasados], ['seg-done', 'Devolvidos', devolvidos]]
      .map(([classe, rotulo, n]) => `<li><i class="dot ${classe}"></i>${rotulo}<b>${n}</b></li>`).join('');
    return `<div class="donut-wrap"><svg class="donut" viewBox="0 0 42 42" role="img" aria-label="Situação dos empréstimos"><circle class="g-trilho" cx="21" cy="21" r="15.915" fill="none" stroke-width="5.5" />${arcos}<text class="donut-num" x="21" y="22.5" text-anchor="middle">${total}</text><text class="donut-sub" x="21" y="27.5" text-anchor="middle">empréstimos</text></svg><ul class="donut-legenda">${legenda}</ul></div>`;
  }

  static barrasHorizontais(itens: { rotulo: string; total: number }[], vazio: string): string {
    if (!itens.length) return Html.vazio(vazio, 'bar-chart');
    const maximo = Math.max(1, ...itens.map(i => i.total));
    return `<ul class="hbars">${itens.map((i, n) => `<li><div class="hbar-top"><span title="${Util.esc(i.rotulo)}">${Util.esc(i.rotulo)}</span><b>${Util.numero(i.total)}</b></div><div class="hbar-trilho"><div class="hbar-fill tone-${n % 6}" data-w="${Math.round((i.total / maximo) * 100)}"></div></div></li>`).join('')}</ul>`;
  }
}
