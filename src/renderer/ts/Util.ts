/** Funções utilitárias puras (formatação, escape de HTML, datas). */
class Util {
  /** Escapa texto para HTML — defesa contra XSS (somado à CSP restritiva do index.html). */
  static esc(valor: unknown): string {
    return String(valor ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  static semAcento(valor: string): string {
    return valor.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  static numero(valor: unknown): number { return Number(valor || 0); }

  static milhar(valor: unknown): string { return Util.numero(valor).toLocaleString('pt-BR'); }

  static plural(n: number, singular: string, plural: string): string { return `${n} ${n === 1 ? singular : plural}`; }

  /** 2026-03-04 → 04/03/2026 */
  static data(valor: unknown): string {
    if (!valor) return '—';
    const texto = String(valor).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return String(valor);
    return `${texto.slice(8, 10)}/${texto.slice(5, 7)}/${texto.slice(0, 4)}`;
  }

  static dataHora(valor: unknown): string {
    if (!valor) return '—';
    const texto = String(valor);
    const hora = /[ T](\d{2}:\d{2})/.exec(texto);
    return `${Util.data(texto)}${hora ? ` às ${hora[1]}` : ''}`;
  }

  static hoje(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  static somarDias(data: string, quantidade: number): string {
    const d = new Date(`${data}T12:00:00`);
    d.setDate(d.getDate() + quantidade);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  static mesCurto(chave: string): string {
    const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    return nomes[Number(chave.slice(5, 7)) - 1] ?? chave;
  }

  static iniciais(nome: unknown): string {
    const partes = String(nome ?? '').trim().split(/\s+/).filter(Boolean);
    return ((partes[0]?.[0] ?? '?') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
  }

  /** Cor estável (0 a 7) para avatares, a partir do nome. */
  static cor(nome: unknown): number {
    let h = 0;
    for (const c of String(nome ?? '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return h % 8;
  }

  static codigoIsbn(valor: string): string { return valor.replace(/[\s-]/g, '').toUpperCase(); }
  static isbnCompleto(codigo: string): boolean { return /^(?:\d{13}|\d{9}[\dX])$/.test(codigo); }

  static urlCapa(valor: unknown): string | null {
    if (typeof valor !== 'string') return null;
    try {
      const u = new URL(valor.replace(/^http:\/\//i, 'https://'));
      const permitidos = ['books.google.com', 'books.googleusercontent.com', 'lh3.googleusercontent.com', 'covers.openlibrary.org'];
      if (u.protocol === 'https:' && permitidos.includes(u.hostname)) return u.toString();
    } catch { /* URL inválida: sem capa */ }
    return null;
  }

  /** Larguras de barras vêm de data-w e são aplicadas via CSSOM (a CSP proíbe style="" no HTML). */
  static aplicarLarguras(raiz: ParentNode = document): void {
    raiz.querySelectorAll<HTMLElement>('[data-w]').forEach(e => { e.style.width = `${e.dataset.w}%`; });
  }
}
