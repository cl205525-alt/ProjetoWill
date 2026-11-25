export class ErroDominio extends Error {
  constructor(mensagem: string, readonly codigo?: 'SESSAO') {
    super(mensagem);
    this.name = 'ErroDominio';
  }
}

export class Validacao {
  static objeto(dado: unknown): Record<string, unknown> {
    if (!dado || typeof dado !== 'object' || Array.isArray(dado)) throw new ErroDominio('Dados inválidos.');
    return dado as Record<string, unknown>;
  }

  static texto(dado: unknown, campo: string, max = 180, obrigatorio = true): string {
    if (dado === undefined || dado === null || dado === '') {
      if (obrigatorio) throw new ErroDominio(`Preencha ${campo}.`);
      return '';
    }
    if (typeof dado !== 'string') throw new ErroDominio(`${campo}: texto inválido.`);
    const valor = dado.trim();
    if (obrigatorio && !valor) throw new ErroDominio(`Preencha ${campo}.`);
    if (valor.length > max) throw new ErroDominio(`${campo}: informe até ${max} caracteres.`);
    return valor;
  }

  static inteiro(dado: unknown, campo: string, minimo = 1, maximo = 1_000_000): number {
    if (typeof dado !== 'number' && typeof dado !== 'string') throw new ErroDominio(`${campo}: número inválido.`);
    if (typeof dado === 'string' && dado.trim() === '') throw new ErroDominio(`${campo}: número inválido.`);
    const n = Number(dado);
    if (!Number.isSafeInteger(n) || n < minimo || n > maximo) throw new ErroDominio(`${campo}: número inválido.`);
    return n;
  }

  static email(dado: unknown): string {
    const texto = this.texto(dado, 'e-mail', 180, false).toLowerCase();
    if (texto && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto)) throw new ErroDominio('E-mail inválido.');
    return texto;
  }

  static data(dado: unknown, campo: string): string {
    const valor = this.texto(dado, campo, 10);
    const dia = new Date(`${valor}T12:00:00Z`);
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(valor)
      && Number.isFinite(dia.valueOf()) && dia.toISOString().slice(0, 10) === valor;
    if (!ok) throw new ErroDominio(`${campo}: data inválida.`);
    return valor;
  }

  static listaIds(dado: unknown): number[] {
    if (!Array.isArray(dado) || dado.length > 30) throw new ErroDominio('Selecione os autores (até 30).');
    return [...new Set(dado.map(id => this.inteiro(id, 'autor')))];
  }

  static isbn(dado: unknown): string {
    const s = this.texto(dado, 'ISBN', 20, false).replace(/[\s-]/g, '');
    if (s && !/^(?:[0-9]{13}|[0-9]{9}[0-9Xx])$/.test(s)) throw new ErroDominio('ISBN precisa de 10 ou 13 dígitos.');
    return s.toUpperCase();
  }

  static senha(dado: unknown): string {
    if (typeof dado !== 'string' || dado.length < 10 || Buffer.byteLength(dado, 'utf8') > 72) {
      throw new ErroDominio('A senha deve ter de 10 caracteres até 72 bytes.');
    }
    return dado;
  }

  static booleano(dado: unknown): boolean {
    return dado === true || dado === 1 || dado === '1' || dado === 'true';
  }

  static opcao<T extends string>(dado: unknown, opcoes: readonly T[], campo: string): T {
    if (typeof dado !== 'string' || !(opcoes as readonly string[]).includes(dado)) throw new ErroDominio(`${campo}: opção inválida.`);
    return dado as T;
  }
}
