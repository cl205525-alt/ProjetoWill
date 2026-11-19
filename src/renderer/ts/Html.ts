/** Construtores de HTML reutilizados pelas páginas. Todo valor dinâmico passa por Util.esc. */
class Html {
  static pill(texto: string, tom: Tom = 'neutral'): string { return `<span class="pill ${tom}">${Util.esc(texto)}</span>`; }

  static botao(acao: string, rotulo: string, icone: string, classe = 'btn-primary app-primary', extras = ''): string {
    return `<button type="button" class="btn ${classe}" data-action="${acao}" ${extras}><i class="bi bi-${icone} me-2"></i>${rotulo}</button>`;
  }

  static botaoIcone(acao: string, id: unknown, icone: string, titulo: string, perigo = false): string {
    return `<button type="button" class="action-btn ${perigo ? 'danger' : ''}" data-action="${acao}" data-id="${Util.esc(id)}" title="${Util.esc(titulo)}" aria-label="${Util.esc(titulo)}"><i class="bi bi-${icone}"></i></button>`;
  }

  static cabecalho(titulo: string, descricao: string, botoes = ''): string {
    return `<div class="page-heading"><div><span class="eyebrow">GESTÃO DA BIBLIOTECA</span><h1>${titulo}</h1><p>${descricao}</p></div><div class="heading-actions">${botoes}</div></div>`;
  }

  static vazio(texto = 'Nenhum registro encontrado.', icone = 'journal-x'): string {
    return `<div class="empty-state"><i class="bi bi-${icone}"></i><h3>Por enquanto, nada por aqui</h3><p>${Util.esc(texto)}</p></div>`;
  }

  static capa(url: unknown, classe = 'cover-mini', isbn: unknown = ''): string {
    const codigo = Util.codigoIsbn(String(isbn ?? ''));
    const alternativa = Util.isbnCompleto(codigo) ? `https://covers.openlibrary.org/b/isbn/${codigo}-M.jpg?default=false` : '';
    const atual = Util.urlCapa(url) || Util.urlCapa(alternativa);
    return atual
      ? `<img class="${classe}" src="${Util.esc(atual)}" data-cover-url="${Util.esc(atual)}" data-cover-isbn="${Util.esc(codigo)}" alt="Capa do livro" loading="lazy" referrerpolicy="no-referrer" />`
      : `<span class="${classe} cover-placeholder"><i class="bi bi-book"></i></span>`;
  }

  static avatar(nome: unknown, classe = 'avatar'): string {
    return `<span class="${classe} tone-${Util.cor(nome)}">${Util.esc(Util.iniciais(nome))}</span>`;
  }

  static campo(nome: string, rotulo: string, valor: unknown = '', tipo = 'text', extras = '', ajuda = ''): string {
    return `<div class="field-block"><label class="field-label" for="field-${nome}">${rotulo}</label><input class="form-control field-input" id="field-${nome}" name="${nome}" type="${tipo}" value="${Util.esc(valor)}" ${extras} />${ajuda ? `<div class="field-helper">${ajuda}</div>` : ''}</div>`;
  }

  static area(nome: string, rotulo: string, valor: unknown = '', extras = ''): string {
    return `<div class="field-block"><label class="field-label" for="field-${nome}">${rotulo}</label><textarea class="form-control field-input" id="field-${nome}" name="${nome}" ${extras}>${Util.esc(valor)}</textarea></div>`;
  }

  static selecao(nome: string, rotulo: string, opcoes: Registro[], valor: unknown = '', extras = '', vazio = 'Selecione...', texto?: (o: Registro) => string): string {
    const itens = opcoes.map(o => `<option value="${Util.numero(o.id)}" ${String(o.id) === String(valor ?? '') ? 'selected' : ''}>${Util.esc(texto ? texto(o) : (o.nome || o.titulo))}</option>`).join('');
    return `<div class="field-block"><label class="field-label" for="field-${nome}">${rotulo}</label><select class="form-select field-input" id="field-${nome}" name="${nome}" ${extras}><option value="">${vazio}</option>${itens}</select></div>`;
  }

  /** Lista de caixas de marcação em forma de "chips" (melhor que select múltiplo com Ctrl). */
  static checks(nome: string, rotulo: string, opcoes: Registro[], marcados: unknown = ''): string {
    const ids = String(marcados ?? '').split(',').filter(Boolean);
    const itens = opcoes.map(o => `<label class="chip"><input type="checkbox" name="${nome}" value="${Util.numero(o.id)}" ${ids.includes(String(o.id)) ? 'checked' : ''} /><span>${Util.esc(o.nome)}</span></label>`).join('');
    return `<div class="field-block"><span class="field-label">${rotulo}</span><div class="chip-list">${itens || '<span class="small-muted">Nenhum autor cadastrado ainda.</span>'}</div></div>`;
  }

  static secao(icone: string, texto: string): string { return `<div class="section-detail"><i class="bi bi-${icone}"></i><span>${texto}</span></div>`; }

  static barra(opcoes: { busca: string; filtros?: [string, string][]; atual?: string; extra?: string; placeholder?: string }): string {
    const filtros = opcoes.filtros?.length
      ? `<div class="filter-buttons">${opcoes.filtros.map(([valor, rotulo]) => `<button type="button" class="filter-btn ${opcoes.atual === valor ? 'active' : ''}" data-action="filtro" data-valor="${valor}">${rotulo}</button>`).join('')}</div>` : '';
    return `<div class="toolbar"><div class="toolbar-search"><i class="bi bi-search"></i><input id="busca-local" type="search" data-input="busca" placeholder="${Util.esc(opcoes.placeholder ?? 'Pesquisar nesta lista...')}" value="${Util.esc(opcoes.busca)}" /></div>${filtros}${opcoes.extra ?? ''}</div>`;
  }

  static fatiar<T>(lista: T[], pagina: number, porPagina: number): T[] { return lista.slice((pagina - 1) * porPagina, pagina * porPagina); }

  static paginacao(total: number, pagina: number, porPagina: number): string {
    const paginas = Math.max(1, Math.ceil(total / porPagina));
    if (paginas <= 1) return '';
    const botoes: string[] = [`<button type="button" class="page-btn" data-action="pg" data-pg="${pagina - 1}" ${pagina <= 1 ? 'disabled' : ''} aria-label="Página anterior"><i class="bi bi-chevron-left"></i></button>`];
    for (let p = 1; p <= paginas; p++) {
      if (p === 1 || p === paginas || Math.abs(p - pagina) <= 1) botoes.push(`<button type="button" class="page-btn ${p === pagina ? 'active' : ''}" data-action="pg" data-pg="${p}">${p}</button>`);
      else if (Math.abs(p - pagina) === 2) botoes.push('<span class="page-gap">…</span>');
    }
    botoes.push(`<button type="button" class="page-btn" data-action="pg" data-pg="${pagina + 1}" ${pagina >= paginas ? 'disabled' : ''} aria-label="Próxima página"><i class="bi bi-chevron-right"></i></button>`);
    return `<nav class="pager" aria-label="Paginação">${botoes.join('')}</nav>`;
  }

  static tabela(cabecalhos: string[], linhas: string[], total: number, pagina: number, porPagina: number): string {
    const corpo = linhas.length ? linhas.join('') : `<tr><td colspan="${cabecalhos.length}">${Html.vazio()}</td></tr>`;
    return `<div class="table-responsive"><table class="app-table"><thead><tr>${cabecalhos.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${corpo}</tbody></table></div>
      <div class="table-foot"><span class="count-note">${Util.plural(total, 'registro', 'registros')}</span>${Html.paginacao(total, pagina, porPagina)}</div>`;
  }

  static detalhe(rotulo: string, valor: string): string { return `<div class="detail-item"><span>${rotulo}</span><b>${valor}</b></div>`; }
}
