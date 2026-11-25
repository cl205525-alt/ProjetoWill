export interface ResultadoLivro {
  titulo: string;
  autores: string[];
  editora: string;
  genero?: string;
  ano: number | null;
  fonteAno?: string;
  isbn: string;
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
  const iso = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(entrada);
  if (iso) {
    const data = `${iso[1]}-${iso[2]}-${iso[3] ?? '01'}`;
    const dia = new Date(`${data}T12:00:00Z`);
    if (!Number.isFinite(dia.valueOf()) || dia.toISOString().slice(0, 10) !== data) return null;
  }
  const diaMesAno = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(entrada);
  if (diaMesAno) {
    const data = `${diaMesAno[3]}-${diaMesAno[2].padStart(2, '0')}-${diaMesAno[1].padStart(2, '0')}`;
    const dia = new Date(`${data}T12:00:00Z`);
    if (!Number.isFinite(dia.valueOf()) || dia.toISOString().slice(0, 10) !== data) return null;
  }
  const ocorrencias = entrada.match(/(?<!\d)\d{4}(?!\d)/g);
  if (ocorrencias?.length !== 1) return null;
  if (!iso && !/^(?:\[?c?\.?\s*\d{4}\]?|[\p{L}. ]+[\d, ]*\d{4}|\d{1,2}[\s./-]+\d{1,2}[\s./-]+\d{4})$/iu.test(entrada)) return null;
  const numero = Number(ocorrencias[0]);
  return numero >= 1450 && numero <= new Date().getFullYear() + 2 ? numero : null;
}

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

export function isbn10Equivalente(isbn: string): string | null {
  if (!isbn.startsWith('978') || isbn13(isbn) !== isbn) return null;
  const base = isbn.slice(3, 12);
  const soma = [...base].reduce((total, c, i) => total + Number(c) * (10 - i), 0);
  const digito = (11 - soma % 11) % 11;
  return `${base}${digito === 10 ? 'X' : digito}`;
}

export function chaveBibliografica(valor: string): string {
  return valor.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function titulosCoerentes(titulos: unknown[]): boolean {
  const chaves = titulos.flatMap(valor => {
    if (typeof valor !== 'string') return [];
    const inteiro = chaveBibliografica(valor);
    const base = chaveBibliografica(valor.split(/:|\s+[-—–]\s+/u, 1)[0]);
    return inteiro && base ? [{ inteiro, base }] : [];
  });
  return chaves.every(a => chaves.every(b => a.inteiro === b.inteiro
    || (a.base === b.base && (a.inteiro === a.base || b.inteiro === b.base))));
}

export function completarEdicao(base: ResultadoLivro, outra: ResultadoLivro): ResultadoLivro {
  const codigo = isbn13(base.isbn);
  if (!codigo || codigo !== isbn13(outra.isbn) || !titulosCoerentes([base.titulo, outra.titulo])) return base;
  const ano = base.ano === null || outra.ano === null || base.ano === outra.ano ? base.ano ?? outra.ano : null;
  const combinado: ResultadoLivro = {
    ...base,
    autores: base.autores.length ? base.autores : outra.autores,
    editora: base.editora || outra.editora,
    genero: base.genero || outra.genero,
    ano,
    fonteAno: ano === null ? undefined : base.ano === ano ? base.fonteAno : outra.fonteAno,
    capa: base.capa ?? outra.capa
  };
  if (combinado.autores !== base.autores || combinado.editora !== base.editora
      || combinado.ano !== base.ano || combinado.genero !== base.genero || combinado.capa !== base.capa) {
    combinado.origem = [...new Set([base.origem, outra.origem].flatMap(s => s.split(' + ')))].join(' + ');
  }
  return combinado;
}

export function reunirCandidatos(livros: ResultadoLivro[]): ResultadoLivro[] {
  const reunidos: ResultadoLivro[] = [], porCodigo = new Map<string, number>();
  const anosPorCodigo = new Map<string, Set<number>>();
  const entradas = livros.map(livro => ({ livro, codigo: isbn13(livro.isbn) }));
  const titulosPorCodigo = new Map<string, string[]>();
  for (const { livro, codigo } of entradas) {
    if (!codigo) continue;
    const titulos = titulosPorCodigo.get(codigo);
    if (titulos) titulos.push(livro.titulo);
    else titulosPorCodigo.set(codigo, [livro.titulo]);
  }

  const discordantes = new Set([...titulosPorCodigo].filter(([, titulos]) => !titulosCoerentes(titulos)).map(([codigo]) => codigo));
  for (const { livro, codigo } of entradas) {
    const chave = codigo && (discordantes.has(codigo) ? `${codigo}:${chaveBibliografica(livro.titulo)}` : codigo);
    const posicao = chave ? porCodigo.get(chave) : undefined;
    if (chave && livro.ano !== null) {
      const anos = anosPorCodigo.get(chave) ?? new Set<number>();
      anos.add(livro.ano);
      anosPorCodigo.set(chave, anos);
    }
    if (posicao === undefined) {
      if (chave) porCodigo.set(chave, reunidos.length);
      reunidos.push(livro);
    } else reunidos[posicao] = completarEdicao(reunidos[posicao], livro);
  }
  for (const [chave, anos] of anosPorCodigo) {
    if (anos.size > 1) {
      const posicao = porCodigo.get(chave)!;
      reunidos[posicao] = { ...reunidos[posicao], ano: null, fonteAno: undefined };
    }
  }
  return reunidos;
}
