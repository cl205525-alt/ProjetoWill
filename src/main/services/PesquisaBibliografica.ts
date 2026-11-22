export interface ResultadoLivro {
  titulo: string;
  autores: string[];
  editora: string;
  ano: number | null;
  isbn: string;
  sinopse: string;
  capa: string | null;
  origem: string;
}

export function objeto(valor: unknown): Record<string, unknown> {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor)
    ? valor as Record<string, unknown> : {};
}

export function lista(valor: unknown): unknown[] { return Array.isArray(valor) ? valor as unknown[] : []; }
export function texto(valor: unknown, limite: number): string { return typeof valor === 'string' ? valor.trim().slice(0, limite) : ''; }
export function autores(valor: unknown): string[] { return [...new Set(lista(valor).slice(0, 10).map(v => texto(v, 160)).filter(Boolean))]; }
export function ano(valor: unknown): number | null {
  const entrada = typeof valor === 'number' ? String(valor) : texto(valor, 100);
  const numero = Number(entrada.match(/\b\d{4}\b/)?.[0]);
  return numero >= 1450 && numero <= 2100 ? numero : null;
}
export function sinopse(valor: unknown): string {
  const entrada = typeof valor === 'string' ? valor : objeto(valor).value;
  return typeof entrada === 'string' ? entrada.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000) : '';
}

/** Um ISBN-10 válido identifica a mesma edição que seu ISBN-13 com prefixo 978. */
export function isbn13(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const codigo = valor.replace(/[\s-]/g, '').toUpperCase();
  const digito13 = (base: string): number => (10 - [...base].reduce((total, c, i) => total + Number(c) * (i % 2 ? 3 : 1), 0) % 10) % 10;
  if (/^\d{13}$/.test(codigo) && /^97[89]/.test(codigo)) return Number(codigo[12]) === digito13(codigo.slice(0, 12)) ? codigo : null;
  if (!/^\d{9}[\dX]$/.test(codigo)) return null;
  const total = [...codigo].reduce((soma, digito, i) => soma + (digito === 'X' ? 10 : Number(digito)) * (10 - i), 0);
  if (total % 11 !== 0) return null;
  const base = `978${codigo.slice(0, 9)}`;
  return `${base}${digito13(base)}`;
}

export function incompleto(livro: ResultadoLivro): boolean {
  return !livro.isbn || !livro.autores.length || !livro.editora || !livro.ano || !livro.sinopse || !livro.capa;
}

/** Só complementa dados com a identidade da edição confirmada; fontes ficam visíveis. */
export function completarEdicao(base: ResultadoLivro, outra: ResultadoLivro): ResultadoLivro {
  const codigo = isbn13(base.isbn);
  if (!codigo || codigo !== isbn13(outra.isbn)) return base;
  const combinado = {
    ...base,
    autores: base.autores.length ? base.autores : outra.autores,
    editora: base.editora || outra.editora,
    ano: base.ano ?? outra.ano,
    sinopse: base.sinopse || outra.sinopse,
    capa: base.capa ?? outra.capa
  };
  if (combinado.autores !== base.autores || combinado.editora !== base.editora
      || combinado.ano !== base.ano || combinado.sinopse !== base.sinopse || combinado.capa !== base.capa) {
    combinado.origem = [...new Set([base.origem, outra.origem].flatMap(s => s.split(' + ')))].join(' + ');
  }
  return combinado;
}

export function reunirCandidatos(livros: ResultadoLivro[]): ResultadoLivro[] {
  const reunidos: ResultadoLivro[] = [], porCodigo = new Map<string, number>();
  for (const livro of livros) {
    const codigo = isbn13(livro.isbn);
    const posicao = codigo ? porCodigo.get(codigo) : undefined;
    if (posicao === undefined) {
      if (codigo) porCodigo.set(codigo, reunidos.length);
      reunidos.push(livro);
    } else reunidos[posicao] = completarEdicao(reunidos[posicao], livro);
  }
  return reunidos;
}
