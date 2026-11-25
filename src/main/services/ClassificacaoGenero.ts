import { objeto } from './PesquisaBibliografica';

const sinonimos: Readonly<Record<string, readonly string[]>> = {
  Literatura: ['literatura', 'literature', 'literary collections'],
  Ficção: ['ficção', 'fiction', 'ficção literária', 'literary fiction', 'ficção moderna e contemporânea', 'ficção e temas relacionados', 'fiction and related items'],
  'Não Ficção': ['não ficção', 'non fiction', 'nonfiction'],
  'Ficção Clássica': ['ficção clássica', 'classic fiction', 'classics'],
  Distopia: ['distopia', 'distopias', 'dystopia', 'dystopias', 'dystopian', 'dystopian fiction'],
  'Ficção Científica': ['ficção científica', 'science fiction', 'sci-fi', 'space opera'],
  Fantasia: ['fantasia', 'fantasy', 'fantasy fiction', 'epic fantasy', 'fantasia épica', 'high fantasy', 'urban fantasy', 'fantasia urbana'],
  Terror: ['terror', 'horror', 'horror fiction', 'ficção de terror'],
  Mistério: ['mistério', 'mystery', 'mystery fiction', 'mystery & detective', 'mystery and detective'],
  Suspense: ['suspense', 'thriller', 'thrillers', 'thriller fiction', 'suspense fiction', 'thriller psicológico', 'psychological thriller'],
  Romance: ['romance', 'romances', 'romance fiction', 'romantic fiction', 'romance romântico', 'ficção romântica', 'romance de amor', 'love stories'],
  'Ficção Histórica': ['ficção histórica', 'romance histórico', 'historical fiction'],
  'Realismo Mágico': ['realismo mágico', 'magical realism', 'magic realism'],
  Poesia: ['poesia', 'poetry'],
  Biografia: ['biografia', 'biografias', 'biography', 'biographies'],
  Autobiografia: ['autobiografia', 'autobiografias', 'autobiography', 'autobiographies'],
  Contos: ['conto', 'contos', 'short stories', 'short story collections'],
  Crônicas: ['crônica', 'crônicas'],
  Drama: ['drama', 'peças teatrais', 'plays'],
  'História em Quadrinhos': ['histórias em quadrinhos', 'quadrinhos', 'comics', 'comics and graphic novels', 'graphic novels', 'mangá', 'manga'],
  Ensaio: ['ensaio', 'ensaios', 'essays']
};

function normalizar(rotulo: string): string {
  return rotulo.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const porRotulo: ReadonlyMap<string, string> = new Map(Object.entries(sinonimos)
  .flatMap(([genero, rotulos]) => rotulos.map(rotulo => [normalizar(rotulo), genero] as const)));

export function generosEncontrados(rotulos: readonly unknown[]): string[] {
  const achados = new Set<string>();
  for (const valor of rotulos.slice(0, 80)) {
    const rotulo = typeof valor === 'string' ? valor : objeto(valor).name ?? objeto(valor).label;
    if (typeof rotulo !== 'string' || rotulo.length > 240) continue;
    const niveis = rotulo.split(/[/>]|\s*--\s*/u).map(normalizar);
    while (niveis.at(-1) === 'general' || niveis.at(-1) === 'geral') niveis.pop();
    const folha = niveis.at(-1) ?? '';
    const genero = porRotulo.get(folha) ?? (/^literatura (?:brasileira|portuguesa|inglesa|francesa|americana|estrangeira)\b/.test(folha) ? 'Literatura' : null);
    if (genero) achados.add(genero);
  }
  return [...achados];
}

export function generoEspecifico(genero: string): boolean {
  return !['Literatura', 'Ficção', 'Não Ficção'].includes(genero);
}

export function classificarGenero(rotulos: readonly unknown[]): string | null {
  return classificarGenerosConhecidos(generosEncontrados(rotulos));
}

export function classificarGenerosConhecidos(valores: readonly string[]): string | null {
  const achados = [...new Set(valores.filter(Boolean))];
  const especificos = achados.filter(generoEspecifico);
  if (especificos.length === 1) return especificos[0];
  if (especificos.length > 1) return null;
  const base = achados.filter(genero => genero !== 'Literatura');
  return base.length === 1 ? base[0] : base.length ? null : achados[0] ?? null;
}
