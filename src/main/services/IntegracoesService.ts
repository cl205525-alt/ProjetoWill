import axios, { type AxiosInstance } from 'axios';
import { ErroDominio, Validacao as V } from '../validacao';
import { ano, autores, completarEdicao, incompleto, isbn13, lista, objeto, reunirCandidatos, sinopse, texto, type ResultadoLivro } from './PesquisaBibliografica';

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
  constructor(private readonly cliente: AxiosInstance = axios.create({
    timeout: 9000, maxContentLength: 1024 * 1024,
    headers: { Accept: 'application/json', 'User-Agent': 'LumiBiblioteca/1.2 (projeto escolar COTIL)' }
  })) {}

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

  private extrairGoogle(item: unknown, esperado?: string): ResultadoLivro {
    const info = objeto(objeto(item).volumeInfo);
    const codigos = lista(info.industryIdentifiers).map(objeto)
      .filter(i => i.type === 'ISBN_13' || i.type === 'ISBN_10').map(i => isbn13(i.identifier));
    const imagens = objeto(info.imageLinks);
    return {
      titulo: texto(info.title, 240), autores: autores(info.authors), editora: texto(info.publisher, 160),
      ano: ano(info.publishedDate),
      isbn: esperado ? (codigos.includes(esperado) ? esperado : '') : codigos.find(Boolean) ?? '',
      sinopse: sinopse(info.description),
      capa: this.urlCapa(imagens.thumbnail) ?? this.urlCapa(imagens.smallThumbnail),
      origem: 'Google Books'
    };
  }

  // API 1: pesquisar várias obras. Aceita texto (busca por título) ou { consulta, modo }.
  async googleBooks(dado: unknown): Promise<ResultadoLivro[]> {
    const entrada = typeof dado === 'string' ? { consulta: dado, modo: 'titulo' } : V.objeto(dado);
    const consulta = V.texto(entrada.consulta, 'pesquisa', 120);
    const modo = V.opcao(entrada.modo ?? 'titulo', ['titulo', 'autor', 'livre'] as const, 'modo de busca');
    const prefixo = modo === 'titulo' ? 'intitle:' : modo === 'autor' ? 'inauthor:' : '';
    const { data } = await this.cliente.get<unknown>('https://www.googleapis.com/books/v1/volumes', {
      params: { q: `${prefixo}${consulta}`, maxResults: 12, printType: 'books', ...(this.chaveGoogle ? { key: this.chaveGoogle } : {}) }
    });
    return lista(objeto(data).items).map(item => this.extrairGoogle(item)).filter(livro => livro.titulo);
  }

  async buscarTitulo(tituloDado: unknown): Promise<ResultadoLivro[]> {
    const titulo = V.texto(tituloDado, 'título para pesquisa', 240);
    let resultados: ResultadoLivro[] = [];
    try { resultados = await this.googleBooks({ consulta: titulo.slice(0, 120), modo: 'titulo' }); }
    catch { /* A Open Library pode responder mesmo quando o Google Books não responde. */ }
    if (resultados.length && !resultados.some(incompleto)) return reunirCandidatos(resultados);
    try {
      const open = await this.openLibraryPorTitulo(titulo);
      return reunirCandidatos([...resultados, ...open]).slice(0, 20);
    } catch {
      if (resultados.length) return reunirCandidatos(resultados);
      throw new ErroDominio('Não foi possível concluir a pesquisa por título. Tente novamente ou preencha manualmente.');
    }
  }

  private async openLibraryPorTitulo(titulo: string): Promise<ResultadoLivro[]> {
    const { data } = await this.cliente.get<unknown>('https://openlibrary.org/search.json', {
      params: { q: titulo.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim() || titulo, lang: 'pt', limit: 8,
        fields: 'key,title,author_name,editions,editions.title,editions.isbn,editions.publisher,editions.publish_date,editions.cover_i' }
    });
    const obras = lista(objeto(data).docs).slice(0, 8).map(objeto);
    const chaveTitulo = (valor: unknown): string => texto(valor, 240).normalize('NFD').toLowerCase()
      .replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const obraExata = obras.find(obra => chaveTitulo(obra.title) === chaveTitulo(titulo)
      && !lista(objeto(obra.editions).docs).length && /^\/works\/OL[0-9]+W$/.test(texto(obra.key, 80)));
    let edicoesDaObra: Record<string, unknown>[] = [];
    if (obraExata) {
      try {
        const detalhe = await this.cliente.get<unknown>(`https://openlibrary.org${texto(obraExata.key, 80)}/editions.json`, { params: { limit: 12 } });
        edicoesDaObra = lista(objeto(detalhe.data).entries).map(objeto).filter(e => chaveTitulo(e.title) === chaveTitulo(titulo)).slice(0, 4);
      } catch { /* A obra ainda pode ser sugerida, sem dados de edição. */ }
    }
    return obras.flatMap(obra => {
      const edicoes = obra === obraExata && edicoesDaObra.length ? edicoesDaObra : lista(objeto(obra.editions).docs).slice(0, 2);
      // Sem uma edição, jamais use ISBN, capa ou editora agregados no nível da obra.
      return (edicoes.length ? edicoes : [null]).map(itemEdicao => {
        const edicao = objeto(itemEdicao);
        const isbn = [...lista(edicao.isbn), ...lista(edicao.isbn_13), ...lista(edicao.isbn_10)].map(isbn13).find(Boolean) ?? '';
        const idCapa = typeof edicao.cover_i === 'number' ? edicao.cover_i : lista(edicao.covers)[0];
        return {
          titulo: texto(edicao.title, 240) || texto(obra.title, 240), autores: autores(obra.author_name),
          editora: texto([...lista(edicao.publisher), ...lista(edicao.publishers)][0], 160),
          ano: ano(lista(edicao.publish_date)[0] ?? edicao.publish_date), isbn, sinopse: sinopse(edicao.description),
          capa: typeof idCapa === 'number' && Number.isSafeInteger(idCapa) && idCapa > 0 ? this.urlCapa(`https://covers.openlibrary.org/b/id/${idCapa}-M.jpg?default=false`) : null,
          origem: itemEdicao ? 'Open Library' : 'Open Library (obra sem edição identificada)'
        };
      });
    }).filter(livro => livro.titulo);
  }

  private async googlePorIsbn(isbn: string): Promise<ResultadoLivro | null> {
    const { data } = await this.cliente.get<unknown>('https://www.googleapis.com/books/v1/volumes', {
      params: { q: `isbn:${isbn}`, maxResults: 5, printType: 'books', ...(this.chaveGoogle ? { key: this.chaveGoogle } : {}) }
    });
    return reunirCandidatos(lista(objeto(data).items).map(item => this.extrairGoogle(item, isbn))
      .filter(livro => livro.titulo && livro.isbn === isbn))[0] ?? null;
  }

  private async openLibraryPorIsbn(isbn: string, esperado: string): Promise<ResultadoLivro | null> {
    const resposta = await this.cliente.get<unknown>(`https://openlibrary.org/isbn/${isbn}.json`, {
      validateStatus: (status: number) => status === 200 || status === 404
    });
    if (resposta.status === 404) return null;
    const data = objeto(resposta.data);
    const titulo = texto(data.title, 240);
    if (!titulo || ![...lista(data.isbn_10), ...lista(data.isbn_13)].some(c => isbn13(c) === esperado)) return null;
    let descricao = sinopse(data.description), autoresReferencias = lista(data.authors);
    const chaveObra = texto(objeto(lista(data.works)[0]).key, 80);
    if ((!autoresReferencias.length || !descricao) && /^\/works\/OL[0-9]+W$/.test(chaveObra)) {
      try {
        const obra = objeto((await this.cliente.get<unknown>(`https://openlibrary.org${chaveObra}.json`)).data);
        if (!autoresReferencias.length) autoresReferencias = lista(obra.authors);
        if (!descricao) descricao = sinopse(obra.description);
      } catch { /* O título pode ser aproveitado sem os autores. */ }
    }
    const chaves = [...new Set(autoresReferencias.map(objeto)
      .map(a => texto(objeto(a.author).key ?? a.key, 80))
      .filter(chave => /^\/authors\/OL[0-9]+A$/.test(chave)))].slice(0, 6);
    const respostas = await Promise.allSettled(chaves.map(chave => this.cliente.get<unknown>(`https://openlibrary.org${chave}.json`)));
    const nomes = autores(respostas.flatMap(r => r.status === 'fulfilled' ? [objeto(r.value.data).name] : []));

    // Preferir o identificador da capa da edição. Se a API não o fornecer,
    // ?default=false faz a Open Library responder 404, em vez de um GIF vazio.
    const idCapa = lista(data.covers)[0];
    const capa = typeof idCapa === 'number' && Number.isSafeInteger(idCapa) && idCapa > 0
      ? this.urlCapa(`https://covers.openlibrary.org/b/id/${idCapa}-M.jpg?default=false`)
      : this.urlCapa(`https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`);
    return {
      titulo, autores: nomes, editora: texto(lista(data.publishers)[0], 160), ano: ano(data.publish_date),
      isbn: esperado, sinopse: descricao, capa, origem: 'Open Library'
    };
  }

  private async brasilApiPorIsbn(isbn: string): Promise<ResultadoLivro | null> {
    const resposta = await this.cliente.get<unknown>(`https://brasilapi.com.br/api/isbn/v1/${isbn}`, {
      params: { providers: 'cbl,mercado-editorial' }, validateStatus: (status: number) => status === 200 || status === 404
    });
    if (resposta.status === 404) return null;
    const data = objeto(resposta.data);
    const titulo = texto(data.title, 240);
    if (!titulo || isbn13(data.isbn) !== isbn) return null;
    const origem = data.provider === 'cbl' ? 'BrasilAPI (CBL)' : data.provider === 'mercado-editorial' ? 'BrasilAPI (Mercado Editorial)' : 'BrasilAPI';
    const nomes = autores(data.authors).map(nome => {
      const partes = nome.split(',').map(parte => parte.trim());
      return data.provider === 'cbl' && partes.length === 2 && partes.every(Boolean) ? `${partes[1]} ${partes[0]}` : nome;
    });
    return {
      titulo, autores: nomes, editora: texto(data.publisher, 160), ano: ano(data.year),
      isbn, sinopse: sinopse(data.synopsis), capa: this.urlCapa(data.cover_url), origem
    };
  }

  // API 2: identificar uma edição pelo ISBN. Usa Open Library e complementa
  // os dados ausentes com Google Books, inclusive quando não há capa no Open Library.
  async openLibrary(isbnDado: unknown): Promise<ResultadoLivro> {
    const codigo = V.isbn(isbnDado), isbn = isbn13(codigo);
    if (!isbn) throw new ErroDominio('Informe um ISBN válido de 10 ou 13 dígitos, com o dígito verificador correto.');
    const [open, google] = await Promise.allSettled([
      this.openLibraryPorIsbn(codigo, isbn),
      this.googlePorIsbn(isbn)
    ]);
    const original = open.status === 'fulfilled' ? open.value : null;
    const complementar = google.status === 'fulfilled' ? google.value : null;
    let livro = original && complementar ? completarEdicao(original, complementar) : original ?? complementar;
    // Uma URL teórica por ISBN não equivale a uma capa disponível.
    let capaExtra = livro?.capa ?? null;
    if (capaExtra && !(await this.obterCapa(capaExtra))) {
      const alternativa = complementar?.capa;
      capaExtra = alternativa && alternativa !== capaExtra && await this.obterCapa(alternativa) ? alternativa : null;
      if (capaExtra && livro && complementar) livro = completarEdicao({ ...livro, capa: null }, complementar);
    }
    if (livro) livro = { ...livro, capa: capaExtra };

    if (!livro || incompleto(livro)) {
      try {
        const adicional = await this.brasilApiPorIsbn(isbn);
        if (adicional) {
          if (!livro?.capa && adicional.capa && !(await this.obterCapa(adicional.capa))) adicional.capa = null;
          livro = livro ? completarEdicao(livro, adicional) : adicional;
        }
      } catch {
        if (!livro) throw new ErroDominio('Não foi possível confirmar a edição em todas as fontes. Tente novamente ou preencha manualmente.');
      }
    }
    if (!livro) throw new ErroDominio('Não foi possível localizar uma edição com esse ISBN. Confira o código ou tente buscar pelo título.');
    return livro;
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
