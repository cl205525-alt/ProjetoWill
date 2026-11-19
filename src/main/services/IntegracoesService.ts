import axios from 'axios';
import { ErroDominio, Validacao as V } from '../validacao';

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

/**
 * Quatro consumos de API, cada um com uma finalidade real no sistema:
 *  1. Google Books  - descobrir livros por título/autor e complementar o ISBN
 *  2. Open Library  - identificar a edição pelo ISBN (dados, autores e capa)
 *  3. ViaCEP        - cidade/UF no cadastro de leitores
 *  4. BrasilAPI     - feriados nacionais para calcular prazos em dias úteis
 * Todas as chamadas partem do processo principal (Axios); o renderer nunca acessa a rede.
 */
export class IntegracoesService {
  private readonly chaveGoogle = process.env.GOOGLE_BOOKS_API_KEY || '';
  private readonly cliente = axios.create({
    timeout: 9000,
    maxContentLength: 1024 * 1024,
    headers: { Accept: 'application/json', 'User-Agent': 'LumiBiblioteca/1.2 (projeto escolar COTIL)' }
  });

  // Mantemos apenas pequenas imagens na memória durante a execução.
  private readonly capas = new Map<string, string | null>();
  private readonly dominiosCapas = new Set([
    'books.google.com',
    'books.googleusercontent.com',
    'lh3.googleusercontent.com',
    'covers.openlibrary.org'
  ]);

  /** A Open Library redireciona capas para o Internet Archive; só aceitamos esse destino em redirecionamentos. */
  private hostRedirecionamentoPermitido(host: string): boolean {
    return this.dominiosCapas.has(host) || host === 'archive.org' || host.endsWith('.archive.org');
  }

  private urlCapa(valor: unknown, redirecionamento = false): string | null {
    if (typeof valor !== 'string' || valor.length > 500) return null;
    try {
      const url = new URL(valor.replace(/^http:\/\//i, 'https://'));
      const hostOk = redirecionamento ? this.hostRedirecionamentoPermitido(url.hostname) : this.dominiosCapas.has(url.hostname);
      if (url.protocol !== 'https:' || !hostOk) return null;
      if (url.username || url.password || (url.port && url.port !== '443')) return null;
      return url.toString();
    } catch {
      return null;
    }
  }

  private extrairGoogle(item: any): ResultadoLivro {
    const info = item?.volumeInfo || {};
    const identificadores = Array.isArray(info.industryIdentifiers) ? info.industryIdentifiers : [];
    const codigo = identificadores.find((i: any) => i?.type === 'ISBN_13')
      || identificadores.find((i: any) => i?.type === 'ISBN_10');
    const anoTexto = String(info.publishedDate || '');
    return {
      titulo: String(info.title || '').slice(0, 240),
      autores: (Array.isArray(info.authors) ? info.authors : []).slice(0, 10).map((a: unknown) => String(a).slice(0, 160)),
      editora: String(info.publisher || '').slice(0, 160),
      ano: /^\d{4}/.test(anoTexto) ? Number(anoTexto.slice(0, 4)) : null,
      isbn: String(codigo?.identifier || ''),
      sinopse: String(info.description || '').replace(/<[^>]*>/g, '').slice(0, 3000),
      capa: this.urlCapa(info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail),
      origem: 'Google Books'
    };
  }

  // API 1: pesquisar várias obras. Aceita texto (busca por título) ou { consulta, modo }.
  async googleBooks(dado: unknown): Promise<ResultadoLivro[]> {
    const entrada = typeof dado === 'string' ? { consulta: dado, modo: 'titulo' } : V.objeto(dado);
    const consulta = V.texto(entrada.consulta, 'pesquisa', 120);
    const modo = V.opcao(entrada.modo ?? 'titulo', ['titulo', 'autor', 'livre'] as const, 'modo de busca');
    const prefixo = modo === 'titulo' ? 'intitle:' : modo === 'autor' ? 'inauthor:' : '';
    const { data } = await this.cliente.get('https://www.googleapis.com/books/v1/volumes', {
      params: { q: `${prefixo}${consulta}`, maxResults: 12, printType: 'books', ...(this.chaveGoogle ? { key: this.chaveGoogle } : {}) }
    });
    const itens: any[] = Array.isArray(data?.items) ? data.items : [];
    return itens.map(item => this.extrairGoogle(item)).filter(livro => livro.titulo);
  }

  private async googlePorIsbn(isbn: string): Promise<ResultadoLivro | null> {
    const { data } = await this.cliente.get('https://www.googleapis.com/books/v1/volumes', {
      params: { q: `isbn:${isbn}`, maxResults: 5, printType: 'books', ...(this.chaveGoogle ? { key: this.chaveGoogle } : {}) }
    });
    const itens: any[] = Array.isArray(data?.items) ? data.items : [];
    const resultados = itens.map(item => this.extrairGoogle(item)).filter(livro => livro.titulo);
    // Não associar a capa de uma edição qualquer quando a API não devolve o ISBN pedido.
    return resultados.find(livro => livro.isbn === isbn) || resultados[0] || null;
  }

  private async openLibraryPorIsbn(isbn: string): Promise<ResultadoLivro | null> {
    const resposta = await this.cliente.get(`https://openlibrary.org/isbn/${isbn}.json`, {
      validateStatus: (status: number) => status === 200 || status === 404
    });
    if (resposta.status === 404) return null;
    const data = resposta.data;
    const descricao = typeof data?.description === 'string' ? data.description : data?.description?.value || '';
    let autoresReferencias: any[] = Array.isArray(data?.authors) ? data.authors : [];
    const chaveObra = String(data?.works?.[0]?.key || '');
    if (!autoresReferencias.length && /^\/works\/OL[0-9]+W$/.test(chaveObra)) {
      try {
        const obra = await this.cliente.get(`https://openlibrary.org${chaveObra}.json`);
        autoresReferencias = Array.isArray(obra.data?.authors) ? obra.data.authors : [];
      } catch { /* O título pode ser aproveitado sem os autores. */ }
    }
    const chaves = autoresReferencias
      .map((a: any) => String(a?.author?.key || a?.key || ''))
      .filter((chave: string) => /^\/authors\/OL[0-9]+A$/.test(chave)).slice(0, 6);
    const respostas = await Promise.allSettled(chaves.map((chave: string) => this.cliente.get(`https://openlibrary.org${chave}.json`)));
    const autores = respostas
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .map(r => String(r.value.data?.name || '').slice(0, 160)).filter(Boolean);

    // Preferir o identificador da capa da edição. Se a API não o fornecer,
    // ?default=false faz a Open Library responder 404, em vez de um GIF vazio.
    const idCapa = Array.isArray(data?.covers) ? Number(data.covers[0]) : 0;
    const capa = idCapa > 0
      ? this.urlCapa(`https://covers.openlibrary.org/b/id/${idCapa}-M.jpg?default=false`)
      : this.urlCapa(`https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`);
    const anoTexto = String(data?.publish_date || '');
    return {
      titulo: String(data?.title || '').slice(0, 240),
      autores,
      editora: String(data?.publishers?.[0] || '').slice(0, 160),
      ano: /\d{4}/.test(anoTexto) ? Number(anoTexto.match(/\d{4}/)?.[0]) : null,
      isbn,
      sinopse: String(descricao).slice(0, 3000),
      capa,
      origem: 'Open Library'
    };
  }

  // API 2: identificar uma edição pelo ISBN. Usa Open Library e complementa
  // os dados ausentes com Google Books, inclusive quando não há capa no Open Library.
  async openLibrary(isbnDado: unknown): Promise<ResultadoLivro> {
    const isbn = V.isbn(isbnDado);
    if (!isbn) throw new ErroDominio('Informe um ISBN de 10 ou 13 dígitos.');
    const [open, google] = await Promise.allSettled([
      this.openLibraryPorIsbn(isbn),
      this.googlePorIsbn(isbn)
    ]);
    const original = open.status === 'fulfilled' ? open.value : null;
    const complementar = google.status === 'fulfilled' ? google.value : null;
    if (!original && !complementar) {
      if (open.status === 'rejected' && google.status === 'rejected') {
        throw new ErroDominio('Não foi possível consultar as fontes bibliográficas. Verifique sua conexão.');
      }
      throw new ErroDominio('ISBN não encontrado na Open Library nem no Google Books.');
    }

    let capa = original?.capa || null;
    if (capa && !(await this.obterCapa(capa))) capa = null;
    if (!capa && complementar?.capa && await this.obterCapa(complementar.capa)) capa = complementar.capa;

    const base = original?.titulo ? original : complementar!;
    return {
      titulo: base.titulo,
      autores: original?.autores.length ? original.autores : complementar?.autores || [],
      editora: original?.editora || complementar?.editora || '',
      ano: original?.ano || complementar?.ano || null,
      isbn,
      sinopse: original?.sinopse || complementar?.sinopse || '',
      capa,
      origem: original && complementar ? 'Open Library + Google Books' : original ? 'Open Library' : 'Google Books'
    };
  }

  // Imagens passam pelo processo principal: contorna bloqueios de conteúdo
  // remoto do Electron sem afrouxar a CSP nem expor Axios ao renderer.
  // Segue no máximo dois redirecionamentos, sempre validando o novo host.
  async obterCapa(valor: unknown): Promise<string | null> {
    const url = this.urlCapa(valor);
    if (!url) return null;
    if (this.capas.has(url)) return this.capas.get(url) || null;
    let atual = url;
    let imagem: string | null = null;
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      try {
        const resposta = await this.cliente.get<ArrayBuffer>(atual, {
          responseType: 'arraybuffer', timeout: 7000, maxContentLength: 700 * 1024,
          maxRedirects: 0, headers: { Accept: 'image/jpeg,image/png,image/webp,image/gif' },
          validateStatus: (status: number) => (status >= 200 && status < 400) || status === 404
        });
        if (resposta.status === 404) break;
        if (resposta.status >= 300) {
          const endereco = this.urlCapa(new URL(String(resposta.headers.location || ''), atual).toString(), true);
          if (!endereco) break;
          atual = endereco;
          continue;
        }
        const bytes = Buffer.from(resposta.data);
        const tipo = String(resposta.headers['content-type'] || '').split(';')[0].toLowerCase();
        if (bytes.length < 250 || bytes.length > 700 * 1024) break;
        const jpeg = tipo === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8;
        const png = tipo === 'image/png' && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
        const webp = tipo === 'image/webp' && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
        const gif = tipo === 'image/gif' && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString());
        if (!(jpeg || png || webp || gif)) break;
        imagem = `data:${tipo};base64,${bytes.toString('base64')}`;
        break;
      } catch { break; }
    }
    // Evita refazer transferências repetidas durante a sessão.
    if (this.capas.size >= 60) this.capas.delete(this.capas.keys().next().value!);
    this.capas.set(url, imagem);
    return imagem;
  }

  // API 3: buscar cidade e UF por CEP (não armazenamos o endereço).
  async viaCep(cepDado: unknown): Promise<{ cidade: string; uf: string }> {
    const cep = V.texto(cepDado, 'CEP', 10).replace(/\D/g, '');
    if (!/^\d{8}$/.test(cep)) throw new ErroDominio('CEP deve ter 8 números.');
    const { data } = await this.cliente.get(`https://viacep.com.br/ws/${cep}/json/`);
    if (data.erro || !data.localidade) throw new ErroDominio('CEP não encontrado.');
    return { cidade: String(data.localidade).slice(0, 100), uf: String(data.uf).slice(0, 2) };
  }

  // API 4: prazo em dias úteis, excluindo fins de semana e feriados nacionais.
  // Se a BrasilAPI estiver fora do ar, calcula só com fins de semana e avisa.
  async calcularPrazo(dados: unknown): Promise<{ vencimento: string; feriadosConsiderados: string[]; diasUteis: number; aviso?: string }> {
    const d = V.objeto(dados), inicio = V.data(d.inicio, 'retirada'), dias = V.inteiro(d.dias, 'dias úteis', 1, 90);
    const inicial = new Date(`${inicio}T12:00:00Z`);
    const ultimo = new Date(inicial.getTime() + (dias * 3 + 20) * 86400000);
    const anos = [...new Set([inicial.getUTCFullYear(), ultimo.getUTCFullYear()])];
    const feriados = new Map<string, string>();
    let aviso: string | undefined;
    try {
      for (const ano of anos) {
        const { data } = await this.cliente.get(`https://brasilapi.com.br/api/feriados/v1/${ano}`);
        if (!Array.isArray(data)) throw new Error('resposta inesperada');
        for (const f of data) if (/^\d{4}-\d{2}-\d{2}$/.test(String(f.date))) feriados.set(f.date, String(f.name));
      }
    } catch {
      feriados.clear();
      aviso = 'A BrasilAPI não respondeu: o prazo considera apenas fins de semana.';
    }
    const considerados: string[] = [];
    const cursor = new Date(inicial);
    let faltam = dias;
    while (faltam > 0) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      const data = cursor.toISOString().slice(0, 10);
      if (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) continue;
      if (feriados.has(data)) { considerados.push(`${data} — ${feriados.get(data)}`); continue; }
      faltam--;
    }
    return { vencimento: cursor.toISOString().slice(0, 10), feriadosConsiderados: considerados, diasUteis: dias, ...(aviso ? { aviso } : {}) };
  }
}
