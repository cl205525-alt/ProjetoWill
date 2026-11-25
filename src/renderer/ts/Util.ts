class Util {

  static esc(valor: unknown): string {
    return String(valor ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  static semAcento(valor: string): string {
    return valor.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  static numero(valor: unknown): number {
    const numero = typeof valor === 'number' || typeof valor === 'string' ? Number(valor) : 0;
    return Number.isFinite(numero) ? numero : 0;
  }

  static titulosCompativeis(a: string, b: string): boolean {
    const chave = (valor: string): string => Util.semAcento(valor).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const inteiroA = chave(a), inteiroB = chave(b);
    if (!inteiroA || !inteiroB) return false;
    const baseA = chave(a.split(/:|\s+[—–]\s+/u, 1)[0]), baseB = chave(b.split(/:|\s+[—–]\s+/u, 1)[0]);
    return inteiroA === inteiroB || (baseA === baseB && (inteiroA === baseA || inteiroB === baseB));
  }

  static milhar(valor: unknown): string { return Util.numero(valor).toLocaleString('pt-BR'); }

  static plural(n: number, singular: string, plural: string): string { return `${n} ${n === 1 ? singular : plural}`; }

  static data(valor: unknown): string {
    if (!valor) return '—';
    const texto = String(valor).slice(0, 10);
    const dia = new Date(`${texto}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(texto) || !Number.isFinite(dia.valueOf()) || dia.toISOString().slice(0, 10) !== texto) return '—';
    return `${texto.slice(8, 10)}/${texto.slice(5, 7)}/${texto.slice(0, 4)}`;
  }

  static dataHora(valor: unknown): string {
    if (!valor) return '—';
    const texto = String(valor);
    const data = Util.data(texto);
    const hora = /^\d{4}-\d{2}-\d{2}[ T](\d{2}:\d{2})/.exec(texto);
    if (data === '—') return data;
    return `${data}${hora && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(hora[1]) ? ` às ${hora[1]}` : ''}`;
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
    } catch {   }
    return null;
  }

  static aplicarLarguras(raiz: ParentNode = document): void {
    raiz.querySelectorAll<HTMLElement>('[data-w]').forEach(e => { e.style.width = `${e.dataset.w}%`; });
  }
}
