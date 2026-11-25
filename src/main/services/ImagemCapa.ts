function pngInteiro(bytes: Buffer): boolean {
  let pos = 8, temDados = false;
  while (pos + 12 <= bytes.length) {
    const tamanho = bytes.readUInt32BE(pos);
    const tipo = bytes.toString('latin1', pos + 4, pos + 8);
    const fim = pos + tamanho + 12;
    if (fim > bytes.length) return false;
    if (tipo === 'IDAT' && tamanho > 0) temDados = true;
    if (tipo === 'IEND') return temDados && tamanho === 0 && fim === bytes.length;
    pos = fim;
  }
  return false;
}

function dimensoes(bytes: Buffer, tipo: string): [number, number] | null {
  if (tipo === 'image/png' && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
      && bytes.readUInt32BE(8) === 13 && bytes.toString('latin1', 12, 16) === 'IHDR' && pngInteiro(bytes)) {
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  if (tipo === 'image/gif' && bytes.at(-1) === 0x3b && /^GIF8[79]a$/.test(bytes.toString('latin1', 0, 6))) {
    return [bytes.readUInt16LE(6), bytes.readUInt16LE(8)];
  }
  if (tipo === 'image/webp' && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.readUInt32LE(4) + 8 === bytes.length
      && bytes.toString('latin1', 8, 12) === 'WEBP') {
    switch (bytes.toString('latin1', 12, 16)) {
      case 'VP8X': return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
      case 'VP8L':
        if (bytes[20] === 0x2f) {
          const medidas = bytes.readUInt32LE(21);
          return [1 + (medidas & 0x3fff), 1 + ((medidas >>> 14) & 0x3fff)];
        }
        return null;
      case 'VP8 ':
        if (bytes.subarray(23, 26).toString('hex') === '9d012a') {
          return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
        }
        return null;
    }
  }
  if (tipo === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) {
    let pos = 2;
    while (pos < bytes.length && bytes[pos++] === 0xff) {
      while (bytes[pos] === 0xff) pos++;
      const marcador = bytes[pos++];
      if (marcador === 0xda || marcador === 0xd9 || pos + 2 > bytes.length) break;
      const tamanho = bytes.readUInt16BE(pos);
      if (tamanho < 2 || pos + tamanho > bytes.length) break;
      if (marcador >= 0xc0 && marcador <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marcador) && tamanho >= 8) {
        return [bytes.readUInt16BE(pos + 5), bytes.readUInt16BE(pos + 3)];
      }
      pos += tamanho;
    }
  }
  return null;
}

export const LIMITE_BYTES_CAPA = 700 * 1024;

export function imagemCapa(valor: unknown, tipo: string): string | null {
  const bytes = Buffer.isBuffer(valor) ? valor : valor instanceof ArrayBuffer ? Buffer.from(valor) : null;
  if (!bytes || bytes.length < 250 || bytes.length > LIMITE_BYTES_CAPA) return null;
  const tamanho = dimensoes(bytes, tipo);
  if (!tamanho || tamanho.some(lado => lado <= 1 || lado > 4096)) return null;
  return `data:${tipo};base64,${bytes.toString('base64')}`;
}
