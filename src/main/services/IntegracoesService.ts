import axios, { type AxiosInstance } from 'axios';
import { ErroDominio, Validacao as V } from '../validacao';
import { ano, autores, chaveBibliografica, completarEdicao, isbn10Equivalente, isbn13, lista, objeto, reunirCandidatos, texto, titulosCoerentes, type ResultadoLivro } from './PesquisaBibliografica';
import { imagemCapa, LIMITE_BYTES_CAPA } from './ImagemCapa';
import { classificarGenero, classificarGenerosConhecidos, generoEspecifico } from './ClassificacaoGenero';

const PRAZO_CAPA_PRINCIPAL = 1500;
const PRAZO_CAPA_ALTERNATIVA = 2500;
const PRAZO_CAPA_CANDIDATA = 1100;
const PRAZO_METADADOS_CAPA = 1200;
const PRAZO_EDITORA = 2500;
const PRAZO_METADADOS = 2500;
const PRAZO_PESQUISA = 6500;
const URL_GOOGLE = 'https://www.googleapis.com/books/v1/volumes';
const URL_ARCHIVE = 'https://archive.org/advancedsearch.php';
const CHAVE_OBRA_OPEN = /^\/works\/OL[0-9]{1,20}W$/;
const VALIDADE_EVIDENCIAS_EDITORA = 30_000;
const FONTES_EDITORA = ['open', 'google', 'brasil'] as const;
const AVISOS_EDITORA = new Set([
  '', 'consultando editora', 'editora nao confirmada', 'editora nao informada', 'editora nao identificada',
  'editora nao encontrada', 'editora desconhecida', 'editora indisponivel', 'editora nao disponivel',
  'sem editora', 'nao informada', 'nao informado', 'nao disponivel', 'n a', 'n d', 's n',
  'unknown publisher', 'publisher unknown', 'publisher not confirmed', 'publisher not available',
  'publisher not provided', 'publisher was not provided', 'no publisher provided', 'no publisher was provided',
  'no publisher', 'not available'
]);
type FonteEditora = typeof FONTES_EDITORA[number];
interface EvidenciaEditora { nomes: string[]; titulos: unknown[]; }
type EvidenciasEditora = Partial<Record<FonteEditora, EvidenciaEditora>>;
type ModoBibliografico = 'titulo' | 'autor' | 'livre';
interface CapaBaixada { src: string; urls: Set<string>; }
interface BaseMetadados {
  edicao: Record<string, unknown> | null;
  volumes: Record<string, unknown>[];
  nacional: Record<string, unknown> | null;
  titulos: unknown[];
}

function avisoEditora(nome: string): boolean {

  const chave = nome.normalize('NFKD').toLowerCase().replace(/[\p{M}\p{Cf}]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return AVISOS_EDITORA.has(chave);
}

function textoEditoraExterna(valor: unknown): string {
  const nome = texto(valor, 160);
  return avisoEditora(nome) ? '' : nome;
}

function nomesEditoras(valores: unknown[]): string[] {
  return valores.flatMap(valor => typeof valor === 'string'
    ? [valor.trim().normalize('NFC')].filter(nome => !avisoEditora(nome)) : []);
}

function editoraConfirmada(evidencias: EvidenciasEditora): string | null {
  if (!titulosCoerentes(Object.values(evidencias).flatMap(evidencia => evidencia.titulos))) return null;
  const nacional = evidencias.brasil?.nomes[0];
  if (nacional) return nacional.length <= 160 ? nacional : null;
  const nomes = new Map<string, { nome: string; fontes: Set<FonteEditora> }>();
  for (const fonte of FONTES_EDITORA) {
    for (const nome of evidencias[fonte]?.nomes ?? []) {
      const chave = chaveBibliografica(nome);
      const registro = nomes.get(chave) ?? { nome, fontes: new Set<FonteEditora>() };
      registro.fontes.add(fonte);
      nomes.set(chave, registro);
    }
  }
  const candidatos = [...nomes.values()].filter(registro => registro.nome.length <= 160);
  if (nomes.size === 1) return candidatos[0]?.nome ?? null;
  const concordantes = candidatos.filter(registro => registro.fontes.size >= 2);
  return concordantes.length === 1 ? concordantes[0].nome : null;
}

function provedorBrasilConhecido(data: Record<string, unknown> | null): data is Record<string, unknown> {
  return data !== null && (data.provider === 'cbl' || data.provider === 'mercado-editorial');
}

export class IntegracoesService {
  private readonly chaveGoogle = process.env.GOOGLE_BOOKS_API_KEY?.trim() ?? '';
  constructor(private readonly cliente: AxiosInstance = axios.create({
    timeout: 9000, maxContentLength: 1024 * 1024,
    headers: { Accept: 'application/json', 'User-Agent': 'LumiBiblioteca/1.2 (projeto escolar COTIL)' }
  })) {}

  private readonly capas = new Map<string, CapaBaixada>();
  private readonly evidenciasEditoras = new Map<string, { expira: number; fontes: EvidenciasEditora }>();
  private readonly basesEmCurso = new Map<string, Promise<BaseMetadados>>();
  private readonly basesRecentes = new Map<string, { valor: BaseMetadados; expira: number }>();
  private readonly dominiosCapas = new Set([
    'books.google.com',
    'books.googleusercontent.com',
    'lh3.googleusercontent.com',
    'covers.openlibrary.org'
  ]);

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
      url.hash = '';
      return url.toString();
    } catch {
      return null;
    }
  }

  private isbnUnico(codigos: unknown[]): string | null {
    const validos = new Set(codigos.map(isbn13).filter(codigo => codigo !== null));
    return validos.size === 1 ? [...validos][0] : null;
  }

  private isbnConsulta(dado: unknown): { codigo: string; isbn: string } {
    const codigo = V.isbn(dado), isbn = isbn13(codigo);
    if (!isbn) throw new ErroDominio('Informe um ISBN válido de 10 ou 13 dígitos, com o dígito verificador correto.');
    return { codigo, isbn };
  }

  private guardarEvidencia(isbn: string, fonte: FonteEditora, evidencia: EvidenciaEditora): void {
    const agora = Date.now();
    const anterior = this.evidenciasEditoras.get(isbn);
    const registro = anterior && anterior.expira > agora ? anterior : { expira: agora + VALIDADE_EVIDENCIAS_EDITORA, fontes: {} };
    registro.fontes[fonte] = evidencia;
    this.evidenciasEditoras.delete(isbn);
    if (this.evidenciasEditoras.size >= 20) {
      const maisAntigo = this.evidenciasEditoras.keys().next();
      if (!maisAntigo.done) this.evidenciasEditoras.delete(maisAntigo.value);
    }
    this.evidenciasEditoras.set(isbn, registro);
  }

  private capaOpenLibrary(id: unknown): string | null {
    return typeof id === 'number' && Number.isSafeInteger(id) && id > 0
      ? this.urlCapa(`https://covers.openlibrary.org/b/id/${id}-M.jpg?default=false`) : null;
  }

  private capasDaEdicao(edicao: Record<string, unknown>): string[] {
    return lista(edicao.covers).slice(0, 5).map(id => this.capaOpenLibrary(id)).filter(url => url !== null);
  }

  private isbnGoogle(info: Record<string, unknown>): string | null {
    const codigos = lista(info.industryIdentifiers).map(objeto)
      .filter(i => i.type === 'ISBN_13' || i.type === 'ISBN_10').map(i => i.identifier);
    return this.isbnUnico(codigos);
  }

  private extrairGoogle(info: Record<string, unknown>, codigo = this.isbnGoogle(info)): ResultadoLivro {
    const imagens = objeto(info.imageLinks);
    return {
      titulo: texto(info.title, 240), autores: autores(info.authors), editora: codigo ? textoEditoraExterna(info.publisher) : '',
      genero: classificarGenero(lista(info.categories)) ?? undefined,
      ano: ano(info.publishedDate),
      isbn: codigo ?? '',
      capa: this.urlCapa(imagens.thumbnail) ?? this.urlCapa(imagens.smallThumbnail),
      origem: 'Google Books'
    };
  }

  async googleBooks(dado: unknown): Promise<ResultadoLivro[]> {
    const entrada = typeof dado === 'string' ? { consulta: dado, modo: 'titulo' } : V.objeto(dado);
    const consulta = V.texto(entrada.consulta, 'pesquisa', 240).normalize('NFC').replace(/\s+/gu, ' ');
    const modo = V.opcao(entrada.modo ?? 'titulo', ['titulo', 'autor', 'livre'] as const, 'modo de busca');
    const chave = chaveBibliografica(consulta);
    if (!chave) throw new ErroDominio('Informe um termo com letras ou números para pesquisar.');

    const [google, open] = await Promise.allSettled([
      this.fonteNoPrazo(PRAZO_PESQUISA, signal => this.googlePorTermo(consulta, modo, signal)),
      this.fonteNoPrazo(PRAZO_PESQUISA, signal => this.openLibraryPorTitulo(consulta, modo, signal))
    ]);
    let livros = reunirCandidatos([
      ...(google.status === 'fulfilled' ? google.value : []), ...(open.status === 'fulfilled' ? open.value : [])
    ]);
    if (!livros.length) {
      try { livros = await this.fonteNoPrazo(4000, signal => this.archivePorTermo(consulta, modo, signal)); }
      catch {   }
    }
    if (!livros.length && (google.status === 'rejected' || open.status === 'rejected')) {
      const aviso = google.status === 'rejected' && open.status === 'rejected'
        ? 'As fontes de busca não responderam.' : 'Uma das fontes de busca não respondeu e a outra não encontrou resultados.';
      throw new ErroDominio(`${aviso} Tente novamente, consulte pelo ISBN ou preencha manualmente.`);
    }
    const relevancia = (livro: ResultadoLivro): number => {
      const campo = chaveBibliografica(modo === 'autor' ? livro.autores.join(' ') : livro.titulo);
      return campo === chave ? 2 : campo.includes(chave) ? 1 : 0;
    };
    return livros.sort((a, b) => relevancia(b) - relevancia(a) || Number(!!b.isbn) - Number(!!a.isbn)).slice(0, 20);
  }

  async buscarTitulo(tituloDado: unknown): Promise<ResultadoLivro[]> {
    return this.googleBooks({ consulta: tituloDado, modo: 'titulo' });
  }

  private async googlePorTermo(consulta: string, modo: ModoBibliografico, signal: AbortSignal): Promise<ResultadoLivro[]> {
    const termo = consulta.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/gu, ' ').trim();
    const prefixo = modo === 'titulo' ? 'intitle:' : modo === 'autor' ? 'inauthor:' : '';
    const buscar = async (q: string): Promise<ResultadoLivro[]> => {
      const { data, status } = await this.cliente.get<unknown>(URL_GOOGLE, {
        signal, timeout: 3600, maxRedirects: 0,
        params: { q, maxResults: 12, printType: 'books', ...(this.chaveGoogle ? { key: this.chaveGoogle } : {}) }
      });
      const resposta = objeto(data);
      if (status !== 200 || (!Array.isArray(resposta.items) && resposta.totalItems !== 0)) {
        throw new Error('Resposta inválida do catálogo Google Books.');
      }
      return lista(resposta.items).slice(0, 12).map(item => this.extrairGoogle(objeto(objeto(item).volumeInfo))).filter(livro => livro.titulo);
    };
    const preciso = await buscar(prefixo ? `${prefixo}"${termo}"` : termo);
    if (preciso.length || !prefixo) return preciso;
    const tokens = chaveBibliografica(termo).split(' ');
    return (await buscar(termo)).filter(livro => {
      const campo = chaveBibliografica(modo === 'autor' ? livro.autores.join(' ') : livro.titulo);
      return tokens.every(token => campo.includes(token));
    });
  }

  private async archivePorTermo(consulta: string, modo: ModoBibliografico, signal: AbortSignal): Promise<ResultadoLivro[]> {
    const termo = consulta.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/gu, ' ').trim();
    const filtro = modo === 'titulo' ? `title:"${termo}"` : modo === 'autor' ? `creator:"${termo}"`
      : `(title:"${termo}" OR creator:"${termo}")`;
    const { data, status } = await this.cliente.get<unknown>(URL_ARCHIVE, {
      signal, timeout: 3900, maxRedirects: 0,
      params: { q: `mediatype:texts AND ${filtro}`, fl: ['identifier', 'title', 'creator', 'isbn'], rows: 12, output: 'json' }
    });
    if (status !== 200) return [];
    const encontrados: ResultadoLivro[] = [];
    const vistas = new Set<string>(), chave = chaveBibliografica(termo);
    for (const entrada of lista(objeto(objeto(data).response).docs).slice(0, 12)) {
      const item = objeto(entrada);
      const titulo = texto(item.title, 240);
      const autoria = autores(Array.isArray(item.creator) ? item.creator : [item.creator]);
      const alvo = modo === 'titulo' ? titulo : modo === 'autor' ? autoria.join(' ') : `${titulo} ${autoria.join(' ')}`;
      if (!titulo || !chaveBibliografica(alvo).includes(chave) || !/^[\w.-]{1,160}$/.test(texto(item.identifier, 161))) continue;
      const isbn = this.isbnUnico(Array.isArray(item.isbn) ? item.isbn : [item.isbn]) ?? '';
      const identidade = `${chaveBibliografica(titulo)}:${isbn || chaveBibliografica(autoria.join(' '))}`;
      if (vistas.has(identidade)) continue;
      vistas.add(identidade);
      encontrados.push({ titulo, autores: autoria, isbn, editora: '', ano: null, capa: null, origem: 'Internet Archive (catálogo)' });
    }
    return encontrados;
  }

  private async fonteNoPrazo<T>(prazo: number, tarefa: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controle = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const expiracao = new Promise<never>((_resolve, rejeitar) => {
      timer = setTimeout(() => { rejeitar(new Error('Fonte bibliográfica não respondeu a tempo.')); controle.abort(); }, prazo);
    });
    try { return await Promise.race([tarefa(controle.signal), expiracao]); }
    finally {
      clearTimeout(timer);
      controle.abort();
    }
  }

  private async openLibraryPorTitulo(titulo: string, modo: ModoBibliografico, signal: AbortSignal): Promise<ResultadoLivro[]> {
    const { data } = await this.cliente.get<unknown>('https://openlibrary.org/search.json', {
      signal, timeout: 3600, maxRedirects: 0,
      params: { [modo === 'titulo' ? 'title' : modo === 'autor' ? 'author' : 'q']: titulo.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim(), lang: 'pt', limit: 8,
        fields: 'key,title,author_name,subject,editions,editions.title,editions.isbn,editions.publisher,editions.publish_date,editions.cover_i' }
    });
    const docs = objeto(data).docs;
    if (!Array.isArray(docs)) throw new Error('Resposta inválida da Open Library.');
    const obras = lista(docs).slice(0, 8).map(objeto);
    const chaveTitulo = (valor: unknown): string => chaveBibliografica(texto(valor, 240));
    const obraExata = modo === 'titulo' && obras.find(obra => chaveTitulo(obra.title) === chaveTitulo(titulo)
      && !lista(objeto(obra.editions).docs).length && CHAVE_OBRA_OPEN.test(texto(obra.key, 80)));
    let edicoesDaObra: Record<string, unknown>[] = [];
    if (obraExata) {
      try {
        const detalhe = await this.cliente.get<unknown>(`https://openlibrary.org${texto(obraExata.key, 80)}/editions.json`,
          { signal, timeout: 1700, maxRedirects: 0, params: { limit: 12 } });
        edicoesDaObra = lista(objeto(detalhe.data).entries).map(objeto).filter(e => chaveTitulo(e.title) === chaveTitulo(titulo)).slice(0, 4);
      } catch {   }
    }
    return obras.flatMap(obra => {
      const edicoes = obra === obraExata && edicoesDaObra.length ? edicoesDaObra : lista(objeto(obra.editions).docs).slice(0, 2);

      return (edicoes.length ? edicoes : [null]).map(itemEdicao => {
        const edicao = objeto(itemEdicao);
        const isbn = this.isbnUnico([...lista(edicao.isbn), ...lista(edicao.isbn_13), ...lista(edicao.isbn_10)]) ?? '';
        const idCapa = typeof edicao.cover_i === 'number' ? edicao.cover_i : lista(edicao.covers)[0];
        return {
          titulo: texto(edicao.title, 240) || texto(obra.title, 240), autores: autores(obra.author_name),
          editora: textoEditoraExterna([...lista(edicao.publisher), ...lista(edicao.publishers)][0]),
          genero: classificarGenero([...lista(edicao.subjects), ...lista(obra.subject)]) ?? undefined,
          ano: ano(lista(edicao.publish_date)[0] ?? edicao.publish_date), isbn,
          capa: this.capaOpenLibrary(idCapa),
          origem: itemEdicao ? 'Open Library' : 'Open Library (obra sem edição identificada)'
        };
      });
    }).filter(livro => livro.titulo);
  }

  private async registrosGooglePorIsbn(isbn: string, signal?: AbortSignal, prazo = PRAZO_METADADOS_CAPA):
    Promise<Record<string, unknown>[]> {
    const { data, status } = await this.cliente.get<unknown>(URL_GOOGLE, {
      params: { q: `isbn:${isbn}`, maxResults: 5, printType: 'books', ...(this.chaveGoogle ? { key: this.chaveGoogle } : {}) },
      ...(signal ? { signal, timeout: prazo, maxRedirects: 0 } : {})
    });
    if (status !== 200) return [];
    return lista(objeto(data).items).slice(0, 5).map(item => objeto(objeto(item).volumeInfo))
      .filter(info => texto(info.title, 240) && this.isbnGoogle(info) === isbn);
  }

  private editorasGoogle(registros: Record<string, unknown>[]): EvidenciaEditora {
    return { nomes: nomesEditoras(registros.map(info => info.publisher)), titulos: registros.map(info => info.title) };
  }

  private editorasOpen(edicao: Record<string, unknown> | null): EvidenciaEditora {
    return { nomes: nomesEditoras(lista(edicao?.publishers)), titulos: edicao ? [edicao.title] : [] };
  }

  private async googlePorIsbn(isbn: string, signal?: AbortSignal): Promise<ResultadoLivro[]> {
    const registros = signal ? await this.registrosGooglePorIsbn(isbn, signal)
      : await this.fonteNoPrazo(4000, controle => this.registrosGooglePorIsbn(isbn, controle, 4000));
    if (!signal) this.guardarEvidencia(isbn, 'google', this.editorasGoogle(registros));
    return registros.flatMap(info => {
      const livro = this.extrairGoogle(info, isbn);
      const miniatura = this.urlCapa(objeto(info.imageLinks).smallThumbnail);
      return miniatura && miniatura !== livro.capa ? [livro, { ...livro, capa: miniatura }] : [livro];
    });
  }

  private async edicaoOpenLibrary(isbn: string, esperado: string, signal?: AbortSignal,
    prazo = PRAZO_METADADOS_CAPA): Promise<Record<string, unknown> | null> {

    const uri = `https://openlibrary.org/isbn/${isbn}.json`;
    const config = { signal, timeout: signal ? prazo : 9000, maxRedirects: 0,
      validateStatus: (status: number): boolean => status === 200 || status === 404 || [301, 302, 303, 307, 308].includes(status) };
    let resposta = await this.cliente.get<unknown>(uri, config);
    let chaveRedirecionada: string | undefined;
    if (resposta.status >= 300 && resposta.status < 400) {
      const destino: unknown = resposta.headers.location;
      if (typeof destino !== 'string') return null;
      const url = new URL(destino, uri);
      if (url.origin !== 'https://openlibrary.org' || url.username || url.password
          || !/^\/books\/OL[0-9]+M(?:\.json)?$/.test(url.pathname) || url.search || url.hash) return null;
      const caminho = url.pathname.endsWith('.json') ? url.pathname : `${url.pathname}.json`;
      chaveRedirecionada = caminho.slice(0, -5);
      resposta = await this.cliente.get<unknown>(`https://openlibrary.org${caminho}`, config);
    }
    if (resposta.status !== 200) return null;
    const data = objeto(resposta.data);
    if (data.type !== undefined && objeto(data.type).key !== '/type/edition') return null;
    if (data.key !== undefined && (typeof data.key !== 'string' || !/^\/books\/OL[0-9]+M$/.test(data.key))) return null;
    if (chaveRedirecionada && data.key !== undefined && data.key !== chaveRedirecionada) return null;
    return texto(data.title, 240) && this.isbnUnico([...lista(data.isbn_10), ...lista(data.isbn_13)]) === esperado ? data : null;
  }

  private async openLibraryPorIsbn(isbn: string, esperado: string): Promise<{ livro: ResultadoLivro; capas: string[] } | null> {
    const alternativo = isbn === esperado ? isbn10Equivalente(esperado) : isbn;
    const data = await this.fonteNoPrazo(5000, async signal => {
      const canonica = await this.edicaoOpenLibrary(esperado, esperado, signal, PRAZO_METADADOS);
      return canonica ?? (alternativo && !signal.aborted ? this.edicaoOpenLibrary(alternativo, esperado, signal, PRAZO_METADADOS) : null);
    });
    this.guardarEvidencia(esperado, 'open', this.editorasOpen(data));
    if (!data) return null;
    const titulo = texto(data.title, 240);
    let autoresReferencias = lista(data.authors);
    let assuntos = lista(data.subjects);
    const obras = lista(data.works);
    const chaveObra = obras.length === 1 ? texto(objeto(obras[0]).key, 80) : '';
    if ((!autoresReferencias.length || !assuntos.length) && CHAVE_OBRA_OPEN.test(chaveObra)) {
      try {
        const obra = await this.fonteNoPrazo(1800, signal => this.obraOpenLibrary(chaveObra, signal));
        if (obra && titulosCoerentes([data.title, obra.title])) {
          if (!autoresReferencias.length) autoresReferencias = lista(obra.authors);
          if (!assuntos.length) assuntos = lista(obra.subjects);
        }
      } catch {   }
    }
    const chaves = [...new Set(autoresReferencias.map(objeto)
      .map(a => texto(objeto(a.author).key ?? a.key, 80))
      .filter(chave => /^\/authors\/OL[0-9]+A$/.test(chave)))].slice(0, 6);
    const respostas = await Promise.allSettled(chaves.map(chave => this.fonteNoPrazo(1800, signal =>
      this.cliente.get<unknown>(`https://openlibrary.org${chave}.json`, { signal, timeout: 1800, maxRedirects: 0 }))));
    const nomes = autores(respostas.flatMap(r => r.status === 'fulfilled' ? [objeto(r.value.data).name] : []));

    const capas = this.capasDaEdicao(data);
    return { capas, livro: {
      titulo, autores: nomes, editora: textoEditoraExterna(lista(data.publishers)[0]), ano: ano(data.publish_date),
      isbn: esperado, capa: capas[0] ?? null, origem: 'Open Library', genero: classificarGenero(assuntos) ?? undefined
    } };
  }

  private async edicaoBrasilApi(isbn: string, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
    const resposta = await this.cliente.get<unknown>(`https://brasilapi.com.br/api/isbn/v1/${isbn}`, {
      params: { providers: 'cbl,mercado-editorial' }, validateStatus: (status: number) => status === 200 || status === 404,
      ...(signal ? { signal, timeout: PRAZO_EDITORA, maxRedirects: 0 } : {})
    });
    if (resposta.status !== 200) return null;
    const data = objeto(resposta.data);
    return texto(data.title, 240) && isbn13(data.isbn) === isbn ? data : null;
  }

  private editorasBrasil(data: Record<string, unknown> | null): EvidenciaEditora {
    return provedorBrasilConhecido(data)
      ? { nomes: nomesEditoras([data.publisher]), titulos: [data.title] } : { nomes: [], titulos: [] };
  }

  private async brasilApiPorIsbn(isbn: string): Promise<{ livro: ResultadoLivro; provedorConhecido: boolean } | null> {
    const data = await this.fonteNoPrazo(3500, signal => this.edicaoBrasilApi(isbn, signal));
    this.guardarEvidencia(isbn, 'brasil', this.editorasBrasil(data));
    if (!data) return null;
    const titulo = texto(data.title, 240);
    const origem = data.provider === 'cbl' ? 'BrasilAPI (CBL)' : data.provider === 'mercado-editorial' ? 'BrasilAPI (Mercado Editorial)' : 'BrasilAPI';
    const nomes = autores(data.authors).map(nome => {
      const partes = nome.split(',').map(parte => parte.trim());
      return data.provider === 'cbl' && partes.length === 2 && partes.every(Boolean) ? `${partes[1]} ${partes[0]}` : nome;
    });
    const provedorConhecido = provedorBrasilConhecido(data);
    return { provedorConhecido, livro: {
      titulo, autores: nomes, editora: textoEditoraExterna(data.publisher), ano: ano(data.year),
      isbn, genero: provedorConhecido ? classificarGenero(lista(data.subjects)) ?? undefined : undefined,
      capa: this.urlCapa(data.cover_url), origem
    } };
  }

  async openLibrary(isbnDado: unknown): Promise<ResultadoLivro> {
    const { codigo, isbn } = this.isbnConsulta(isbnDado);
    const [open, google, brasil] = await Promise.allSettled([
      this.openLibraryPorIsbn(codigo, isbn),
      this.googlePorIsbn(isbn),
      this.brasilApiPorIsbn(isbn)
    ] as const);
    const edicao = open.status === 'fulfilled' ? open.value : null;
    const original = edicao?.livro ?? null;
    const encontrados = google.status === 'fulfilled' ? google.value : [];
    const nacional = brasil.status === 'fulfilled' ? brasil.value : null;
    const autoridade = nacional?.provedorConhecido ? nacional.livro : null;
    const principal = autoridade ?? original ?? encontrados[0] ?? nacional?.livro;
    if (!principal) {
      if ([open, google, brasil].some(fonte => fonte.status === 'rejected')) {
        throw new ErroDominio('Uma fonte de ISBN não respondeu e a edição não pôde ser confirmada. Tente novamente ou preencha manualmente.');
      }
      throw new ErroDominio('Não foi possível localizar uma edição com esse ISBN. Confira o código ou tente buscar pelo título.');
    }
    const compativeis = [original, ...encontrados, nacional?.livro].filter((livro): livro is ResultadoLivro =>
      !!livro && titulosCoerentes([principal.titulo, livro.titulo]));
    const livro = compativeis.reduce(completarEdicao, principal);
    const editoras = (registros: ResultadoLivro[]): EvidenciaEditora => ({
      nomes: nomesEditoras(registros.map(valor => valor.editora)), titulos: registros.map(valor => valor.titulo)
    });
    const editora = editoraConfirmada({
      open: editoras(compativeis.filter(l => l.origem === 'Open Library')),
      google: editoras(compativeis.filter(l => l.origem === 'Google Books')),
      brasil: editoras(autoridade ? [autoridade] : [])
    });
    const anos = new Map<number, Set<string>>();
    for (const registro of compativeis) {
      if (!registro.ano || (registro.origem === 'BrasilAPI' && !autoridade)) continue;
      const fontes = anos.get(registro.ano) ?? new Set<string>();
      fontes.add(registro.origem);
      anos.set(registro.ano, fontes);
    }
    const corroborados = [...anos].filter(([, fontes]) => fontes.size >= 2);
    const anoConfirmado = autoridade?.ano ?? (anos.size === 1 ? [...anos.keys()][0] : corroborados.length === 1 ? corroborados[0][0] : null);
    const fonteAno = anoConfirmado === null ? undefined : autoridade?.ano === anoConfirmado ? autoridade.origem
      : [...(anos.get(anoConfirmado) ?? [])].join(' + ');
    const genero = this.preferirGenero(autoridade?.genero, compativeis.flatMap(l => l.genero ? [l.genero] : []));
    const capas = [...(edicao?.capas.map(capa => ({ ...edicao.livro, capa })) ?? []), ...encontrados, nacional?.livro]
      .filter((valor): valor is ResultadoLivro => !!valor?.capa && titulosCoerentes([principal.titulo, valor.titulo]));
    const primeira = capas[0]?.capa ?? null;
    const capa = primeira && await this.obterCapa(primeira) ? primeira
      : (await this.comPrazo(PRAZO_CAPA_ALTERNATIVA,
        signal => this.escolherCapa(isbn, capas, primeira, signal, new Set())))?.livro.capa ?? null;
    return { ...livro, editora: editora ?? '', genero, ano: anoConfirmado, fonteAno, capa };
  }

  private preferirGenero(nacional: string | undefined, outros: string[]): string | undefined {
    if (nacional && generoEspecifico(nacional)) return nacional;
    return classificarGenerosConhecidos(outros) ?? nacional;
  }

  async buscarEditoraPorIsbn(dado: unknown): Promise<string | null> {
    const { isbn } = this.isbnConsulta(dado);
    const anterior = this.evidenciasEditoras.get(isbn);
    const evidencias: EvidenciasEditora = anterior && anterior.expira > Date.now() ? { ...anterior.fontes } : {};
    const compartilhada = this.baseDisponivel(isbn);
    if (compartilhada) {
      const { edicao, volumes, nacional } = await compartilhada;
      if (edicao) evidencias.open = this.editorasOpen(edicao);
      if (volumes.length) evidencias.google = this.editorasGoogle(volumes);
      if (nacional) evidencias.brasil = this.editorasBrasil(nacional);
      return editoraConfirmada(evidencias);
    }
    const controle = new AbortController();
    const { signal } = controle;
    const consultar: Record<FonteEditora, () => Promise<EvidenciaEditora>> = {
      open: async () => this.editorasOpen(await this.edicaoOpenLibrary(isbn, isbn, signal, PRAZO_EDITORA)),
      google: async () => this.editorasGoogle(await this.registrosGooglePorIsbn(isbn, signal, PRAZO_EDITORA)),
      brasil: async () => this.editorasBrasil(await this.edicaoBrasilApi(isbn, signal))
    };
    let timer: NodeJS.Timeout | undefined;
    try {
      const expiracao = new Promise<void>(resolver => { timer = setTimeout(resolver, PRAZO_EDITORA); });
      const pendentes = FONTES_EDITORA.filter(fonte => evidencias[fonte] === undefined).map(async fonte => {
        const evidencia = await consultar[fonte]();
        if (!signal.aborted) evidencias[fonte] = evidencia;
      });

      await Promise.race([Promise.allSettled(pendentes), expiracao]);
      return editoraConfirmada(evidencias);
    } finally {
      clearTimeout(timer);
      controle.abort();
    }
  }

  async buscarGeneroPorIsbn(dado: unknown): Promise<string | null> {
    const { isbn } = this.isbnConsulta(dado);
    const { volumes, edicao, nacional, titulos } = await this.baseMetadados(isbn);
    if (!titulosCoerentes(titulos)) return null;
    const assuntos = [...volumes.flatMap(info => lista(info.categories)), ...lista(edicao?.subjects)];
    const nacionalClassificado = classificarGenero(lista(nacional?.subjects)) ?? undefined;
    const inicial = this.preferirGenero(nacionalClassificado, [classificarGenero(assuntos), nacionalClassificado]
      .filter((valor): valor is string => !!valor));
    const obras = lista(edicao?.works);
    const chave = obras.length === 1 ? texto(objeto(obras[0]).key, 80) : '';
    if ((!inicial || !generoEspecifico(inicial)) && CHAVE_OBRA_OPEN.test(chave)) {
      const obra = await this.comPrazo(1600, signal => this.obraOpenLibrary(chave, signal));
      if (obra && titulosCoerentes([...titulos, obra.title])) {
        return this.preferirGenero(nacionalClassificado, [classificarGenero([...assuntos, ...lista(obra.subjects)]), nacionalClassificado]
          .filter((valor): valor is string => !!valor)) ?? inicial ?? null;
      }
    }
    return inicial ?? null;
  }

  private async obraOpenLibrary(chave: string, signal: AbortSignal): Promise<Record<string, unknown> | null> {
    if (signal.aborted || !CHAVE_OBRA_OPEN.test(chave)) return null;
    const resposta = await this.cliente.get<unknown>(`https://openlibrary.org${chave}.json`, {
      signal, timeout: PRAZO_METADADOS, maxRedirects: 0
    });
    const obra = objeto(resposta.data);
    if (resposta.status !== 200 || obra.key !== chave
        || (obra.type !== undefined && objeto(obra.type).key !== '/type/work')) return null;
    return obra;
  }

  private baseDisponivel(isbn: string): Promise<BaseMetadados> | undefined {
    const cache = this.basesRecentes.get(isbn);
    return cache && cache.expira > Date.now() ? Promise.resolve(cache.valor) : this.basesEmCurso.get(isbn);
  }

  private baseMetadados(isbn: string): Promise<BaseMetadados> {
    const disponivel = this.baseDisponivel(isbn);
    if (disponivel) return disponivel;
    const consulta = this.consultarBaseMetadados(isbn).finally(() => this.basesEmCurso.delete(isbn));
    this.basesEmCurso.set(isbn, consulta);
    return consulta;
  }

  private async consultarBaseMetadados(isbn: string): Promise<BaseMetadados> {
    const [open, google, brasil] = await Promise.allSettled([
      this.fonteNoPrazo(PRAZO_METADADOS, signal => this.edicaoOpenLibrary(isbn, isbn, signal, PRAZO_METADADOS)),
      this.fonteNoPrazo(PRAZO_METADADOS, signal => this.registrosGooglePorIsbn(isbn, signal, PRAZO_METADADOS)),
      this.fonteNoPrazo(PRAZO_METADADOS, signal => this.edicaoBrasilApi(isbn, signal))
    ] as const);
    const edicao = open.status === 'fulfilled' ? open.value : null;
    const volumes = google.status === 'fulfilled' ? google.value : [];
    const nacional = brasil.status === 'fulfilled' && provedorBrasilConhecido(brasil.value) ? brasil.value : null;
    const fontes = [open, google, brasil];
    const base = { edicao, volumes, nacional, titulos: [edicao?.title, ...volumes.map(info => info.title), nacional?.title] };

    if (fontes.every(fonte => fonte.status === 'fulfilled') && (edicao || volumes.length || nacional)) {
      if (this.basesRecentes.size >= 40) this.basesRecentes.delete(this.basesRecentes.keys().next().value!);
      this.basesRecentes.set(isbn, { valor: base, expira: Date.now() + 30_000 });
    }
    return base;
  }

  private async comPrazo<T>(prazoMs: number, executar: (signal: AbortSignal) => Promise<T | null>): Promise<T | null> {
    const controle = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const expiracao = new Promise<null>(resolver => {
      timer = setTimeout(() => { controle.abort(); resolver(null); }, prazoMs);
    });
    try {
      return await Promise.race([executar(controle.signal), expiracao]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      controle.abort();
    }
  }

  private async escolherCapa(isbn: string, candidatos: ResultadoLivro[], excluir: string | null,
    signal: AbortSignal, tentadas: Set<string>): Promise<{ livro: ResultadoLivro; imagem: string } | null> {
    for (const candidato of candidatos) {
      if (signal.aborted) break;
      if (isbn13(candidato.isbn) !== isbn) continue;
      const url = this.urlCapa(candidato.capa);
      if (!url || url === excluir || tentadas.has(url)) continue;
      const endereco = new URL(url);
      if (endereco.hostname === 'covers.openlibrary.org' && /^\/b\/isbn\//i.test(endereco.pathname)) continue;
      tentadas.add(url);
      const imagem = await this.comPrazo(PRAZO_CAPA_CANDIDATA, sinal =>
        this.baixarCapa(url, AbortSignal.any([signal, sinal]), excluir));
      if (imagem) return { livro: { ...candidato, capa: url }, imagem };
    }
    return null;
  }

  async obterCapaAlternativa(valor: unknown): Promise<string | null> {
    const dados = objeto(valor);
    const isbn = typeof dados.isbn === 'string' && dados.isbn.length <= 20 ? isbn13(dados.isbn) : null;
    const excluir = this.urlCapa(dados.excluir, true);
    if (!isbn || (dados.excluir !== undefined && !excluir)) return null;
    return this.comPrazo(PRAZO_CAPA_ALTERNATIVA, async signal => {
      const tentadas = new Set<string>();
      const procurar = async (candidatos: Promise<ResultadoLivro[]>): Promise<string> => {
        const achado = await this.escolherCapa(isbn, await candidatos, excluir, signal, tentadas);
        if (!achado) throw new Error('Sem capa para a edição.');
        return achado.imagem;
      };
      const open = this.edicaoOpenLibrary(isbn, isbn, signal).then((edicao): ResultadoLivro[] => {
        if (!edicao) return [];
        const base: ResultadoLivro = { isbn, titulo: texto(edicao.title, 240), origem: 'Open Library',
          autores: [], editora: '', ano: null, capa: null };
        return this.capasDaEdicao(edicao).map(capa => ({ ...base, capa }));
      });

      return Promise.any([procurar(open), procurar(this.googlePorIsbn(isbn, signal))]);
    });
  }

  async obterCapa(valor: unknown): Promise<string | null> {
    const url = this.urlCapa(valor);
    if (!url) return null;
    return this.comPrazo(PRAZO_CAPA_PRINCIPAL, signal => this.baixarCapa(url, signal));
  }

  private async baixarCapa(url: string, signal: AbortSignal, excluir: string | null = null): Promise<string | null> {
    if (url === excluir || signal.aborted) return null;
    const cache = this.capas.get(url);
    if (cache) return excluir && cache.urls.has(excluir) ? null : cache.src;
    const urls = new Set<string>();
    let atual = url;
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      try {
        if (signal.aborted || atual === excluir || urls.has(atual)) return null;
        if (/\/(?:no[_-]?cover(?:[_-]thumb)?|placeholder)\.(?:gif|png|jpe?g|webp)$/i.test(new URL(atual).pathname)) return null;
        urls.add(atual);
        const resposta = await this.cliente.get<unknown>(atual, {
          responseType: 'arraybuffer', signal, maxContentLength: LIMITE_BYTES_CAPA,
          maxRedirects: 0, headers: { Accept: 'image/jpeg,image/png,image/webp,image/gif' },
          validateStatus: (status: number) => status === 200 || [301, 302, 303, 307, 308, 404].includes(status)
        });
        if (signal.aborted) return null;
        if ([301, 302, 303, 307, 308].includes(resposta.status)) {
          const destino: unknown = resposta.headers.location;
          if (typeof destino !== 'string' || !destino) return null;
          const endereco = this.urlCapa(new URL(destino, atual).toString(), true);
          if (!endereco || endereco === atual) return null;
          atual = endereco;
          continue;
        }
        if (resposta.status !== 200) return null;
        const tipo: unknown = resposta.headers['content-type'];
        const src = typeof tipo === 'string' ? imagemCapa(resposta.data, tipo.split(';')[0].trim().toLowerCase()) : null;
        if (!src) return null;

        if (this.capas.size >= 60) this.capas.delete(this.capas.keys().next().value!);
        this.capas.set(url, { src, urls });
        return src;
      } catch { return null; }
    }
    return null;
  }

  async viaCep(cepDado: unknown): Promise<{ cidade: string; uf: string }> {
    const cep = V.texto(cepDado, 'CEP', 10).replace(/\D/g, '');
    if (!/^\d{8}$/.test(cep)) throw new ErroDominio('CEP deve ter 8 números.');
    const { data } = await this.cliente.get<unknown>(`https://viacep.com.br/ws/${cep}/json/`, { timeout: 4000, maxRedirects: 0 });
    const endereco = objeto(data);
    if (endereco.erro === true || endereco.erro === 'true') throw new ErroDominio('CEP não encontrado.');
    const cidade = texto(endereco.localidade, 100), uf = texto(endereco.uf, 2);
    if (!cidade || typeof endereco.uf !== 'string' || !/^[A-Z]{2}$/.test(endereco.uf)) {
      throw new ErroDominio('ViaCEP não retornou cidade e UF válidas. Preencha manualmente ou tente novamente.');
    }
    return { cidade, uf };
  }

  async calcularPrazo(dados: unknown): Promise<{ vencimento: string; feriadosConsiderados: string[]; diasUteis: number; aviso?: string }> {
    const d = V.objeto(dados), inicio = V.data(d.inicio, 'retirada'), dias = V.inteiro(d.dias, 'dias úteis', 1, 90);
    const inicial = new Date(`${inicio}T12:00:00Z`);
    const ultimo = new Date(inicial.getTime() + (dias * 3 + 20) * 86400000);
    const anos = [...new Set([inicial.getUTCFullYear(), ultimo.getUTCFullYear()])];
    const feriados = new Map<string, string>();
    const respostas = await Promise.allSettled(anos.map(ano => this.fonteNoPrazo(4000, async signal => {
      const { data } = await this.cliente.get<unknown>(`https://brasilapi.com.br/api/feriados/v1/${ano}`, { signal, timeout: 4000, maxRedirects: 0 });
      if (!Array.isArray(data) || !data.length) throw new Error('Calendário nacional indisponível.');
      return lista(data).map(objeto).map(f => [V.data(f.date, 'data do feriado'), V.texto(f.name, 'feriado', 160)] as const)
        .filter(([data]) => data.startsWith(`${ano}-`));
    })));
    const anosSemCalendario: number[] = [];
    for (const [i, resposta] of respostas.entries()) {
      if (resposta.status === 'rejected') anosSemCalendario.push(anos[i]);
      else for (const [data, nome] of resposta.value) feriados.set(data, nome);
    }
    const considerados: string[] = [];
    const anosUsados = new Set<number>();
    const cursor = new Date(inicial);
    let faltam = dias;
    while (faltam > 0) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      anosUsados.add(cursor.getUTCFullYear());
      const data = cursor.toISOString().slice(0, 10);
      if (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) continue;
      if (feriados.has(data)) { considerados.push(`${data} — ${feriados.get(data)}`); continue; }
      faltam--;
    }
    const faltaram = anosSemCalendario.filter(ano => anosUsados.has(ano));
    const aviso = faltaram.length ? `Feriados indisponíveis para ${faltaram.join(', ')}. Nesses anos, só fins de semana foram excluídos.` : undefined;
    return { vencimento: cursor.toISOString().slice(0, 10), feriadosConsiderados: considerados, diasUteis: dias, ...(aviso ? { aviso } : {}) };
  }
}
