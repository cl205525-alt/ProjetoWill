import assert from 'node:assert/strict';
import test from 'node:test';
import axios, { type InternalAxiosRequestConfig } from 'axios';
import { BibliotecaController } from '../src/main/controllers/BibliotecaController';
import { IntegracoesService } from '../src/main/services/IntegracoesService';
import { ano, isbn13 } from '../src/main/services/PesquisaBibliografica';
import { classificarGenero } from '../src/main/services/ClassificacaoGenero';
import { ErroDominio, Validacao } from '../src/main/validacao';

const isbn = '9788533613379', outraEdicao = '9780140449136';
function google(codigo: string, detalhes: Record<string, unknown> = {}) {
  return { volumeInfo: { title: 'Livro de teste', industryIdentifiers: [{ type: 'ISBN_13', identifier: codigo }], ...detalhes } };
}
function fonte(responder: (url: string, config: InternalAxiosRequestConfig) => unknown) {
  return new IntegracoesService(axios.create({
    adapter: async config => {
      const data = responder(config.url ?? '', config);
      return { data, status: data === null ? 404 : 200, statusText: '', headers: {}, config };
    }
  }));
}

test('ISBN-10 e ISBN-13 equivalentes têm a mesma chave, mas códigos inválidos são recusados', () => {
  assert.equal(isbn13('85-336-1337-7'), isbn);
  assert.equal(isbn13('978-85-336-1337-9'), isbn);
  assert.equal(isbn13('9788533613378'), null);
  assert.equal(isbn13('853361337X'), null);
  assert.notEqual(isbn13(outraEdicao), isbn);
});

test('a busca por ISBN usa editora, gênero e ano da ficha nacional confirmada', async () => {
  const api = fonte((url, config) => {
    if (url.includes('www.googleapis.com')) return { items: [
      google(outraEdicao, { publisher: 'Editora errada', description: 'Não misturar', publishedDate: '2021' }),
      google(isbn, { title: 'Livro por ISBN', publisher: 'Editora confirmada' })
    ] };
    if (url.includes('openlibrary.org/isbn/')) return { title: 'Livro por ISBN', isbn_10: ['8533613377'], publish_date: '2001' };
    if (url.includes('covers.openlibrary.org')) return null;
    assert.match(url, /brasilapi\.com\.br\/api\/isbn/);
    assert.equal(config.params.providers, 'cbl,mercado-editorial');
    return { isbn: '8533613377', title: 'Livro por ISBN', publisher: 'Editora nacional', year: 2020, authors: ['SOBRENOME, Nome'], subjects: ['Literatura'], provider: 'cbl' };
  });
  const livro = await api.openLibrary('8533613377');
  assert.equal(livro.isbn, isbn);
  assert.equal(livro.titulo, 'Livro por ISBN');
  assert.equal(livro.editora, 'Editora nacional');
  assert.equal(livro.ano, 2020);
  assert.equal(livro.fonteAno, 'BrasilAPI (CBL)');
  assert.equal(livro.genero, 'Literatura');
  assert.deepEqual(livro.autores, ['Nome SOBRENOME']);
  assert.match(livro.origem, /BrasilAPI \(CBL\)/);
  assert.equal(await api.buscarEditoraPorIsbn(isbn), 'Editora nacional');
});

test('a BrasilAPI pode localizar uma edição sem retorno confirmado nas fontes principais', async () => {
  const api = fonte(url => {
    if (url.includes('www.googleapis.com')) return { items: [google(outraEdicao)] };
    if (url.includes('openlibrary.org/isbn/')) return null;
    return { isbn, title: 'Edição localizada', provider: 'mercado-editorial', cover_url: 'https://example.org/capa.jpg' };
  });
  const livro = await api.openLibrary(isbn);
  assert.equal(livro.titulo, 'Edição localizada');
  assert.equal(livro.capa, null);
  assert.equal(livro.origem, 'BrasilAPI (Mercado Editorial)');
});

test('sem ISBN correspondente, não devolve metadados de um homônimo', async () => {
  const api = fonte(url => url.includes('www.googleapis.com') ? { items: [google(outraEdicao)] } : null);
  await assert.rejects(api.openLibrary(isbn), /localizar uma edição/);
  await assert.rejects(api.openLibrary('9788533613378'), /dígito verificador/);
});

test('o título recorre à Open Library e mantém distintas edições com o mesmo título', async () => {
  const api = fonte(url => {
    if (url.includes('www.googleapis.com')) throw new Error('Indisponível');
    if (url.includes('search.json')) return { docs: [{ title: 'Livro de teste', key: '/works/OL10W', author_name: ['Pessoa Autora'] }] };
    assert.match(url, /\/works\/OL10W\/editions\.json$/);
    return { entries: [
      { title: 'Livro de teste', isbn_13: [isbn], publishers: ['Editora A'], publish_date: '2011' },
      { title: 'Livro de teste', isbn_13: [outraEdicao], publishers: ['Editora B'], publish_date: '2019' }
    ] };
  });
  const livros = await api.buscarTitulo('Livro de teste');
  assert.deepEqual(livros.map(l => [l.isbn, l.editora, l.ano]), [[isbn, 'Editora A', 2011], [outraEdicao, 'Editora B', 2019]]);
  assert.ok(livros.every(l => l.origem === 'Open Library'));
});

test('dados agregados de uma obra sem edição não são usados como dados da edição', async () => {
  const api = fonte(url => url.includes('www.googleapis.com') ? { items: [google(isbn)] }
    : { docs: [{ title: 'Livro de teste', isbn: [isbn], first_publish_year: 1900, publisher: ['Outra edição'], cover_i: 55, author_name: ['Pessoa Autora'] }] });
  const [googleLivro, obra] = await api.buscarTitulo('Livro de teste');
  assert.equal(googleLivro.editora, '');
  assert.equal(obra.isbn, '');
  assert.equal(obra.ano, null);
  assert.equal(obra.capa, null);
});

const principal = 'https://books.google.com/capa-principal.png';
const secundaria = 'https://covers.openlibrary.org/b/id/123-M.jpg?default=false';
const imagemRemota = 'https://books.googleusercontent.com/alternativa.png';
const prefixoOpen = 'https://openlibrary.org/isbn/';
const consultaGoogle = 'https://www.googleapis.com/books/v1/volumes';

function png(pixel = false): Buffer {
  const [cabecalho, final] = pixel
    ? ['iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1Pe', 'AAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC']
    : ['iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAIAAADZSiLo', 'AAAAC0lEQVR4nGNgwAcAAB4AAfb96ZYAAAAASUVORK5CYII='];
  return Buffer.concat([Buffer.from(cabecalho, 'base64'), Buffer.from('000000d074455874', 'hex'),
    Buffer.from(`Comment\0${'x'.repeat(200)}`), Buffer.from('687a7896', 'hex'), Buffer.from(final, 'base64')]);
}

interface RespostaSimulada { data?: unknown; status?: number; headers?: Record<string, string>; }
function fonteCapa(responder: (url: string, config: InternalAxiosRequestConfig) => RespostaSimulada | Promise<RespostaSimulada>) {
  const chamadas: string[] = [];
  const api = new IntegracoesService(axios.create({
    adapter: async config => {
      const url = config.url ?? '';
      chamadas.push(url);
      const { data = null, status = 200, headers = {} } = await responder(url, config);
      return { data, status, statusText: '', headers, config };
    }
  }));
  return { api, chamadas };
}
const respostaPng = (pixel = false): RespostaSimulada => ({ data: png(pixel), headers: { 'content-type': 'image/png' } });
const srcEsperado = `data:image/png;base64,${png().toString('base64')}`;

test('fallback confirma o ISBN equivalente e ignora a principal mesmo em formato HTTP ou com fragmento', async () => {
  const { api, chamadas } = fonteCapa((url, config) => {
    if (url === consultaGoogle) {
      assert.equal(config.params.q, `isbn:${isbn}`);
      return { data: { items: [google(isbn, { imageLinks: { thumbnail: principal } })] } };
    }
    if (url === `${prefixoOpen}${isbn}.json`) return { status: 302, headers: { location: '/books/OL10M.json' } };
    if (url === 'https://openlibrary.org/books/OL10M.json') {
      return { data: { title: 'Edição', isbn_10: ['8533613377'], covers: [123] } };
    }
    if (url === secundaria) return respostaPng();
    return { status: 404 };
  });
  assert.equal(await api.obterCapaAlternativa({ isbn: '85-336-1337-7', excluir: `${principal.replace('https:', 'http:')}#foto` }), srcEsperado);
  assert.deepEqual(chamadas.sort(), [consultaGoogle, `${prefixoOpen}${isbn}.json`, 'https://openlibrary.org/books/OL10M.json', secundaria].sort());
});

test('fallback não consulta com entrada inválida e não aceita ISBN conflitante, capa teórica ou capa de obra', async () => {
  const { api, chamadas } = fonteCapa(url => {
    if (url === consultaGoogle) return { data: { items: [
      google(outraEdicao, { imageLinks: { thumbnail: imagemRemota } }),
      google(isbn, { industryIdentifiers: [{ type: 'ISBN_13', identifier: isbn }, { type: 'ISBN_13', identifier: outraEdicao }],
        imageLinks: { thumbnail: imagemRemota } }),
      google(isbn, { imageLinks: { thumbnail: `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg` } })
    ] } };
    if (url.startsWith(prefixoOpen)) {
      return { data: { title: 'Edição sem capa', isbn_13: [isbn], cover_i: 123, works: [{ key: '/works/OL4W' }] } };
    }
    return respostaPng();
  });
  assert.equal(await api.obterCapaAlternativa({ isbn: '9788533613378' }), null);
  assert.equal(await api.obterCapaAlternativa({ isbn, excluir: 42 }), null);
  assert.deepEqual(chamadas, []);
  assert.equal(await api.obterCapaAlternativa({ isbn }), null);
  assert.deepEqual(chamadas.sort(), [consultaGoogle, `${prefixoOpen}${isbn}.json`].sort());
});

test('fallback rejeita pixel e redirecionamentos para host não permitido ou para a capa excluída', async () => {
  const insegura = 'https://books.google.com/redireciona.png';
  const repetida = 'https://books.google.com/repetida.png';
  const { api, chamadas } = fonteCapa(url => {
    if (url === consultaGoogle) return { data: { items: [insegura, repetida, imagemRemota]
      .map(thumbnail => google(isbn, { imageLinks: { thumbnail } })) } };
    if (url === insegura) return { status: 302, headers: { location: 'https://example.org/capa.png' } };
    if (url === repetida) return { status: 302, headers: { location: principal } };
    if (url === imagemRemota) return respostaPng(true);
    return { status: 404 };
  });
  assert.equal(await api.obterCapaAlternativa({ isbn, excluir: principal }), null);
  assert.deepEqual(chamadas.sort(), [consultaGoogle, `${prefixoOpen}${isbn}.json`, insegura, repetida, imagemRemota].sort());
});

test('fallback não usa capa de um registro identificado como obra, mesmo quando a resposta contém ISBN', async () => {
  const { api, chamadas } = fonteCapa(url => url.startsWith(prefixoOpen)
    ? { data: { title: 'Obra', key: '/works/OL4W', type: { key: '/type/work' }, isbn_13: [isbn], covers: [123] } }
    : { status: 404 });
  assert.equal(await api.obterCapaAlternativa({ isbn }), null);
  assert.deepEqual(chamadas.sort(), [consultaGoogle, `${prefixoOpen}${isbn}.json`].sort());
});

test('fallback aborta no prazo total e uma chamada posterior pode recuperar a mesma capa', async () => {
  let tentativas = 0, abortado = false;
  const { api } = fonteCapa((url, config) => {
    if (url === consultaGoogle) return { data: { items: [google(isbn, { imageLinks: { thumbnail: imagemRemota } })] } };
    if (url === imagemRemota && ++tentativas === 1) return new Promise((_resolver, rejeitar) => {
      config.signal?.addEventListener?.('abort', () => {
        abortado = true;
        rejeitar(new Error('Download cancelado.'));
      });
    });
    return url === imagemRemota ? respostaPng() : { status: 404 };
  });
  assert.equal(await api.obterCapaAlternativa({ isbn }), null);
  assert.equal(abortado, true);
  assert.equal(await api.obterCapaAlternativa({ isbn }), srcEsperado);
  assert.equal(tentativas, 2);
});

test('proxy da principal cancela aos 1500 ms, incluindo redirecionamento, e permite fallback e nova tentativa', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const destino = 'https://books.googleusercontent.com/principal-redirecionada.png';
  const redirect = { status: 302, headers: { location: destino } };
  let liberarRedirect!: (resposta: RespostaSimulada) => void;
  let sinalizarPrimeira!: () => void;
  let sinalizarSegunda!: () => void;
  const primeiraIniciada = new Promise<void>(resolver => { sinalizarPrimeira = resolver; });
  const segundaIniciada = new Promise<void>(resolver => { sinalizarSegunda = resolver; });
  const respostaPrimeira = new Promise<RespostaSimulada>(resolver => { liberarRedirect = resolver; });
  let primeiroSinal: InternalAxiosRequestConfig['signal'];
  let segundoSinal: InternalAxiosRequestConfig['signal'];
  let tentativas = 0, abortado = false;
  const { api, chamadas } = fonteCapa((url, config) => {
    if (url === principal) {
      if (++tentativas !== 1) return redirect;
      primeiroSinal = config.signal;
      sinalizarPrimeira();
      return respostaPrimeira;
    }
    if (url === destino && tentativas === 1) return new Promise((_resolver, rejeitar) => {
      segundoSinal = config.signal;
      config.signal?.addEventListener?.('abort', () => {
        abortado = true;
        rejeitar(new Error('Download cancelado.'));
      });
      sinalizarSegunda();
    });
    if (url === consultaGoogle) return { data: { items: [google(isbn, { imageLinks: { thumbnail: imagemRemota } })] } };
    return url === imagemRemota || url === destino ? respostaPng() : { status: 404 };
  });

  const carregando = api.obterCapa(principal);
  await primeiraIniciada;
  t.mock.timers.tick(1000);
  liberarRedirect(redirect);
  await segundaIniciada;
  assert.equal(segundoSinal, primeiroSinal);
  t.mock.timers.tick(499);
  assert.equal(abortado, false);
  t.mock.timers.tick(1);
  assert.equal(await carregando, null);
  assert.equal(abortado, true);

  assert.equal(await api.obterCapaAlternativa({ isbn, excluir: principal }), srcEsperado);
  assert.ok(chamadas.includes(imagemRemota));
  assert.equal(await api.obterCapa(principal), srcEsperado);
  const chamadasAntesDoCache = chamadas.length;
  assert.equal(await api.obterCapa(principal), srcEsperado);
  assert.equal(chamadas.length, chamadasAntesDoCache);
  assert.equal(tentativas, 2);
});

test('consulta ISBN mantém a principal válida e troca apenas a que falha, sem repetir buscas bibliográficas', async () => {
  for (const falhaPrincipal of [false, true]) {
    const { api, chamadas } = fonteCapa(url => {
      if (url === consultaGoogle) return { data: { items: [google(isbn, {
        title: 'Edição', authors: ['Pessoa Autora'], publisher: 'Editora principal', publishedDate: '2020',
        imageLinks: { thumbnail: principal }
      })] } };
      if (url.startsWith(prefixoOpen)) return { data: { title: 'Edição', isbn_13: [isbn], covers: [123],
        publishers: falhaPrincipal ? [] : ['Editora principal'] } };
      if (url === secundaria) return falhaPrincipal ? { status: 404 } : respostaPng();
      if (url === principal) return respostaPng();
      return { status: 404 };
    });
    const livro = await api.openLibrary(isbn);
    assert.equal(livro.capa, falhaPrincipal ? principal : secundaria);
    assert.equal(livro.editora, 'Editora principal');
    assert.deepEqual(chamadas.sort(), [consultaGoogle, edicaoOpen, edicaoBrasil, secundaria, ...(falhaPrincipal ? [principal] : [])].sort());
  }
});

const edicaoOpen = `${prefixoOpen}${isbn}.json`;
const edicaoBrasil = `https://brasilapi.com.br/api/isbn/v1/${isbn}`;

test('pesquisa por título descarta avisos antes de combinar editoras para o mesmo ISBN', async () => {
  const nome = 'Edições São João & Filhos';
  for (const [avisoGoogle, avisoOpen] of [
    ['Editora não confirmada', ' [ EDITORA NA\u0303O—CONFIRMADA! ] '],
    ['Publisher not provided', ' [ PUBLISHER\u00A0NOT—PROVIDED! ] ']
  ]) {
    const api = fonte(url => {
      if (url === consultaGoogle) return { items: [google(isbn, { publisher: avisoGoogle })] };
      assert.equal(url, 'https://openlibrary.org/search.json');
      return { docs: [{ title: 'Livro de teste', editions: { docs: [
        { isbn: [isbn], publisher: [nome] },
        { isbn: [outraEdicao], publisher: [avisoOpen] }
      ] } }] };
    });
    const livros = await api.buscarTitulo('Livro de teste');
    assert.deepEqual(livros.map(livro => [livro.isbn, livro.editora]), [[isbn, nome], [outraEdicao, '']]);
  }
});

test('busca principal por ISBN filtra avisos sem reescrever nomes legítimos das três fontes', async () => {
  const nome = 'Éditions  Sans Frontières — Selo';
  for (const origem of [edicaoOpen, consultaGoogle, edicaoBrasil]) {
    for (const [publisher, esperado] of [
      [' ( EDITORA\u00A0NA\u0303O—CONFIRMADA… ) ', ''], ['Consultando editora…', ''],
      ['Publisher not provided.', ''], [nome, nome], ['Oxford University Press', 'Oxford University Press']
    ]) {
      const { api } = fonteCapa(url => {
        if (url !== origem) return { status: 404 };
        if (url === edicaoOpen) return { data: { title: 'Livro de teste', isbn_13: [isbn], publishers: [publisher] } };
        if (url === consultaGoogle) return { data: { items: [google(isbn, { publisher })] } };
        return { data: { title: 'Livro de teste', isbn, publisher, provider: 'cbl' } };
      });
      assert.equal((await api.openLibrary(isbn)).editora, esperado, `${origem}: ${publisher}`);
    }
  }
});

test('fallback de editora não confirma avisos repetidos pelas fontes, nem ao reaproveitar evidências', async () => {
  for (const publisher of [
    'Editora não confirmada', ' ( EDITORA\u00A0NA\u0303O—CONFIRMADA… ) ', 'Editora não informada', 'N/A', 'Unknown publisher',
    'Publisher not provided', ' [ PUBLISHER\u00A0NOT—PROVIDED! ] ', 'Publisher was not provided.',
    'No publisher provided.', 'No publisher was provided.'
  ]) {
    const { api, chamadas } = fonteCapa(url => {
      if (url === edicaoOpen) return { data: { title: 'Livro de teste', isbn_13: [isbn], publishers: [publisher] } };
      if (url === consultaGoogle) return { data: { items: [google(isbn, { publisher })] } };
      return { data: { title: 'Livro de teste', isbn, publisher, provider: 'cbl' } };
    });
    assert.equal(await api.buscarEditoraPorIsbn(isbn), null, publisher);
    assert.equal((await api.openLibrary(isbn)).editora, '');
    const chamadasAntes = chamadas.length;
    assert.equal(await api.buscarEditoraPorIsbn(isbn), null, publisher);
    assert.equal(chamadas.length, chamadasAntes);
  }
});

test('fallback de editora desconsidera avisos como divergência e só confirma o nome legítimo', async () => {
  for (const [nome, aviso] of [
    ['Editora Não Confirmada & Filhos', 'Editora não confirmada'],
    ['Oxford University Press', 'Publisher not provided'],
    ['Publisher Not Provided Books', ' [ PUBLISHER\u00A0NOT—PROVIDED! ] ']
  ]) {
    const { api } = fonteCapa(url => {
      if (url === edicaoOpen) return { data: { title: 'Livro de teste', isbn_13: [isbn], publishers: [aviso, nome] } };
      if (url === consultaGoogle) return { data: { items: [google(isbn, { publisher: nome }), google(isbn, { publisher: aviso })] } };
      return { data: { title: 'Livro de teste', isbn, publisher: aviso, provider: 'mercado-editorial' } };
    });
    assert.equal(await api.buscarEditoraPorIsbn(isbn), nome);
    await api.openLibrary(isbn);
    assert.equal(await api.buscarEditoraPorIsbn(isbn), nome);
  }
});

test('ação IPC exige sessão sem renová-la e confirma o mesmo ISBN em duas fontes', async () => {
  const { api, chamadas } = fonteCapa((url, config) => {
    if (url === consultaGoogle) {
      assert.equal(config.params.q, `isbn:${isbn}`);
      return { data: { items: [google(isbn, { title: 'Edição', publisher: '  EDIÇÃO   NOVA  ' }), google(outraEdicao, { publisher: 'Outra editora' })] } };
    }
    if (url === edicaoOpen) return { data: {
      title: 'Edição', isbn_10: ['8533613377'], publishers: ['Edic\u0327a\u0303o Nova'], works: [{ key: '/works/OL4W' }], covers: [123]
    } };
    assert.equal(url, edicaoBrasil);
    throw new Error('Serviço indisponível');
  });
  type Dependencias = ConstructorParameters<typeof BibliotecaController>;
  let logado = false;
  const auth = {
    exigir(perfil?: string, contarAtividade?: boolean) {
      assert.equal(perfil, undefined);
      assert.equal(contarAtividade, false);
      if (!logado) throw new ErroDominio('Sessão encerrada.', 'SESSAO');
      return { id: 1, nome: 'Teste', usuario: 'teste', perfil: 'atendente' };
    }
  };
  const controller = new BibliotecaController(auth as Dependencias[0], {} as Dependencias[1], {} as Dependencias[2],
    api, {} as Dependencias[4], () => null);
  const acao = 'apis:publisher-fallback';
  assert.deepEqual(await controller.tratar(null, acao, isbn), { ok: false, error: 'Sessão encerrada.', codigo: 'SESSAO' });
  logado = true;
  assert.match((await controller.tratar(null, acao, '9788533613378')).error ?? '', /dígito verificador/);
  assert.equal((await controller.tratar(null, acao, { isbn })).ok, false);
  assert.deepEqual(chamadas, []);
  assert.deepEqual(await controller.tratar(null, acao, '85-336-1337-7'), { ok: true, data: 'Edição Nova' });
  assert.deepEqual(chamadas.sort(), [consultaGoogle, edicaoOpen, edicaoBrasil].sort());
});

test('editoras conflitantes sem autoridade confirmada não preenchem o campo', async () => {
  const { api } = fonteCapa(url => {
    if (url === consultaGoogle) return { data: { items: [
      google(isbn, { publisher: 'Editora', imageLinks: { thumbnail: principal, smallThumbnail: imagemRemota } }),
      google(isbn, { publisher: 'Outra editora' })
    ] } };
    if (url === edicaoBrasil) return { data: { title: 'Edição', isbn, publisher: 'Editora', provider: 'desconhecido' } };
    return { data: { title: 'Outra edição', isbn_13: [outraEdicao], publishers: ['Editora'] } };
  });
  assert.equal(await api.buscarEditoraPorIsbn(isbn), null);
});

test('falha das três fontes deixa a editora sem confirmação', async () => {
  const { api, chamadas } = fonteCapa(() => { throw new Error('Serviço indisponível'); });
  assert.equal(await api.buscarEditoraPorIsbn(isbn), null);
  assert.deepEqual(chamadas.sort(), [consultaGoogle, edicaoOpen, edicaoBrasil].sort());
});

test('o nome da BrasilAPI com provedor identificado prevalece sobre variantes de outras fontes', async () => {
  for (const [open, googleNomes, esperado] of [
    [[], ['Edição Nova'], 'Edição Nova'],
    [['Edição Nova', 'Edição Nova — Selo'], ['Edição Nova'], 'Edição Nova'],
    [['Edição Nova'], ['Edição Nova', 'Edicao Nova'], 'Edição Nova'],
    [['Edição Nova'], [], 'Edição Nova']
  ] as const) {
    const { api } = fonteCapa(url => {
      if (url === consultaGoogle) return { data: { items: googleNomes.map(publisher => google(isbn, { title: 'Edição', publisher })) } };
      if (url === edicaoOpen) return { data: { title: 'Edição', isbn_13: [isbn], publishers: open } };
      return { data: { title: 'Edição', isbn: '8533613377', publisher: 'Edição Nova', provider: 'mercado-editorial' } };
    });
    assert.equal(await api.buscarEditoraPorIsbn(isbn), esperado);
  }
});

test('fallback de editora expira e cancela a fonte pendente sem descartar duas confirmações', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let cancelado = false;
  let sinalizar!: () => void;
  const evidenciasRecebidas = new Promise<void>(resolver => { sinalizar = resolver; });
  const { api } = fonteCapa((url, config) => {
    if (url === consultaGoogle) return { data: { items: [google(isbn, { title: 'Edição', publisher: 'Editora' })] } };
    if (url === edicaoOpen) return { data: { title: 'Edição', isbn_13: [isbn], publishers: ['Editora'] } };

    setImmediate(sinalizar);
    return new Promise((_resolver, rejeitar) => config.signal?.addEventListener?.('abort', () => {
      cancelado = true;
      rejeitar(new Error('Cancelado'));
    }));
  });
  const resultado = api.buscarEditoraPorIsbn(isbn);
  await evidenciasRecebidas;
  t.mock.timers.tick(2500);
  assert.equal(await resultado, 'Editora');
  assert.equal(cancelado, true);
});

test('busca exata também retorna editora; ação auxiliar reaproveita evidências sem alterar o livro', async () => {
  const { api, chamadas } = fonteCapa(url => {
    if (url === edicaoOpen) return { data: { title: 'Edição', isbn_13: [isbn] } };
    if (url === consultaGoogle) return { data: { items: [google(isbn, {
      title: 'Edição', publisher: 'Editora', authors: ['Pessoa Autora'], publishedDate: '2020',
      description: 'Uma viagem muda o rumo da família.', imageLinks: { thumbnail: principal }
    })] } };
    if (url === principal) return respostaPng();
    assert.equal(url, edicaoBrasil);
    return { data: { title: 'Edição', isbn, publisher: 'editora', provider: 'cbl' } };
  });
  const livro = await api.openLibrary(isbn);
  assert.equal(livro.editora, 'editora');
  assert.deepEqual(chamadas, [edicaoOpen, consultaGoogle, edicaoBrasil, principal]);
  const antes = structuredClone(livro);
  assert.equal(await api.buscarEditoraPorIsbn(isbn), 'editora');
  assert.deepEqual(livro, antes);
  assert.deepEqual(chamadas, [edicaoOpen, consultaGoogle, edicaoBrasil, principal]);
});

test('ação de gênero exige sessão sem renová-la e aceita a classificação específica do ISBN equivalente', async () => {
  const { api, chamadas } = fonteCapa(url => {
    if (url === consultaGoogle) return { data: { items: [
      google('8533613377', { title: 'Edição', industryIdentifiers: [{ type: 'ISBN_10', identifier: '8533613377' }],
        categories: ['Fiction / Science Fiction'] })
    ] } };
    if (url === edicaoOpen) return { data: {
      title: 'Edição', isbn_13: [isbn], subjects: ['  FICÇÃO   CIENTÍFICA ', 'Literatura'],
      works: [{ key: '/works/OL4W' }], covers: [123]
    } };
    return { data: { title: 'Edição', isbn, provider: 'cbl', subjects: ['Science Fiction'] } };
  });
  type Dependencias = ConstructorParameters<typeof BibliotecaController>;
  let logado = false;
  const auth = {
    exigir(perfil?: string, contarAtividade?: boolean) {
      assert.equal(perfil, undefined);
      assert.equal(contarAtividade, false);
      if (!logado) throw new ErroDominio('Sessão encerrada.', 'SESSAO');
      return { id: 1, nome: 'Teste', usuario: 'teste', perfil: 'atendente' };
    }
  };
  const controller = new BibliotecaController(auth as Dependencias[0], {} as Dependencias[1], {} as Dependencias[2],
    api, {} as Dependencias[4], () => null);
  const acao = 'apis:genre-fallback';
  assert.deepEqual(await controller.tratar(null, acao, isbn), { ok: false, error: 'Sessão encerrada.', codigo: 'SESSAO' });
  logado = true;
  assert.equal((await controller.tratar(null, acao, { isbn })).ok, false);
  assert.match((await controller.tratar(null, acao, '9788533613378')).error ?? '', /dígito verificador/);
  assert.deepEqual(chamadas, []);
  assert.deepEqual(await controller.tratar(null, acao, '85-336-1337-7'), { ok: true, data: 'Ficção Científica' });
  assert.deepEqual(chamadas.sort(), [consultaGoogle, edicaoOpen, edicaoBrasil].sort());
});

test('fallback de gênero ignora outra edição, registro de obra e BrasilAPI sem provedor conhecido', async () => {
  const { api, chamadas } = fonteCapa(url => {
    if (url === consultaGoogle) return { data: { items: [
      google(outraEdicao, { categories: ['Fantasy'] }),
      google(isbn, { industryIdentifiers: [{ type: 'ISBN_13', identifier: isbn },
        { type: 'ISBN_13', identifier: outraEdicao }], categories: ['Fantasy'] })
    ] } };
    if (url === edicaoOpen) return { data: {
      title: 'Obra', isbn_13: [isbn], key: '/works/OL4W', type: { key: '/type/work' }, subjects: ['Fantasy']
    } };
    return { data: { title: 'Edição', isbn, provider: 'desconhecido', subjects: ['Fantasia'] } };
  });
  assert.equal(await api.buscarGeneroPorIsbn(isbn), null);
  assert.deepEqual(chamadas.sort(), [consultaGoogle, edicaoOpen, edicaoBrasil].sort());
});

test('um rótulo específico na edição exata basta, sem usar subjects de outras edições', async () => {
  for (const fonteExata of [consultaGoogle, edicaoOpen, edicaoBrasil]) {
    const { api } = fonteCapa(url => {
      const certa = url === fonteExata;
      const codigo = certa ? isbn : outraEdicao;
      const subjects = [certa ? 'Epic Fantasy' : 'Terror'];
      if (url === consultaGoogle) return { data: { items: [google(codigo, { categories: subjects })] } };
      if (url === edicaoOpen) return { data: { title: 'Edição', isbn_13: [codigo], subjects } };
      return { data: { title: 'Edição', isbn: codigo, provider: 'mercado-editorial', subjects } };
    });
    assert.equal(await api.buscarGeneroPorIsbn(isbn), 'Fantasia');
  }
});

test('classificação nacional específica resolve divergência; fontes não autoritativas em conflito deixam o campo vazio', async () => {
  for (const [origem, esperado] of [['nenhuma', 'Terror'], ['brasil', 'Fantasia'], ['google', 'Terror'], ['sem autoridade', null]] as const) {
    const { api } = fonteCapa(url => {
      if (url === consultaGoogle) return { data: { items: [
        google(isbn, { title: 'Edição', categories: ['Fantasia > Terror'] }),
        ...(origem === 'google' || origem === 'sem autoridade' ? [google(isbn, { title: 'Edição', categories: ['Science Fiction'] })] : [])
      ] } };
      if (url === edicaoOpen || origem === 'sem autoridade') return { status: 404 };
      return { data: { title: 'Edição', isbn, provider: 'mercado-editorial',
        subjects: [origem === 'brasil' ? 'Fantasia' : 'Horror'] } };
    });
    assert.equal(await api.buscarGeneroPorIsbn(isbn), esperado);
  }
});

test('fallback de gênero cancela a fonte pendente em 2500 ms sem perder um gênero já encontrado', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let cancelado = false, terminou = false;
  const { api } = fonteCapa((url, config) => {
    if (url === consultaGoogle) return { data: { items: [google(isbn, { categories: ['Fantasy'] })] } };
    if (url === edicaoOpen) return { status: 404 };
    return new Promise((_resolver, rejeitar) => config.signal?.addEventListener?.('abort', () => {
      cancelado = true;
      rejeitar(new Error('Consulta cancelada'));
    }));
  });
  const resultado = api.buscarGeneroPorIsbn(isbn).then(genero => { terminou = true; return genero; });
  await new Promise<void>(resolver => setImmediate(resolver));
  t.mock.timers.tick(2499);
  assert.equal(cancelado, false);
  assert.equal(terminou, false);
  t.mock.timers.tick(1);
  assert.equal(await resultado, 'Fantasia');
  assert.equal(cancelado, true);
});

test('pesquisa por título não mistura nenhum campo de registros com títulos conflitantes para o mesmo ISBN', async () => {
  for (const [tituloOpen, igual] of [['Livro de teste', true], ['Outro título', false]] as const) {
    const { api, chamadas } = fonteCapa(url => {
      if (url === consultaGoogle) return { data: { items: [google(isbn)] } };
      assert.equal(url, 'https://openlibrary.org/search.json');
      return { data: { docs: [{ title: tituloOpen, author_name: ['Autora'], editions: { docs: [
        { title: tituloOpen, isbn: [isbn], publisher: ['Editora'] }
      ] } }] } };
    });
    const livros = await api.buscarTitulo('Livro de teste');
    const [livro] = livros;
    assert.equal(livro.editora, igual ? 'Editora' : '');
    assert.deepEqual(livro.autores, igual ? ['Autora'] : []);
    if (!igual) assert.equal(livros[1].titulo, tituloOpen);
    assert.deepEqual(chamadas, [consultaGoogle, 'https://openlibrary.org/search.json']);
  }
});

test('busca por título usa a outra fonte sem esperar a primeira responder para iniciar', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let sinal: InternalAxiosRequestConfig['signal'];
  let openConsultada = false;
  const { api } = fonteCapa((url, config) => {
    if (url === consultaGoogle) {
      assert.equal(config.params.q, 'intitle:"Livro de teste"');
      sinal = config.signal;
      return new Promise(() => {   });
    }
    openConsultada = true;
    assert.equal(config.params.title, 'Livro de teste');
    return { data: { docs: [{ title: 'Livro de teste' }] } };
  });
  const pesquisa = api.buscarTitulo('Livro de teste');
  await new Promise<void>(resolver => setImmediate(resolver));
  assert.equal(openConsultada, true);
  t.mock.timers.tick(6500);
  assert.equal((await pesquisa)[0]?.titulo, 'Livro de teste');
  assert.equal(sinal?.aborted, true);
});

test('busca diferencia zero resultados, falha das fontes e entrada inválida', async () => {
  const vazia = fonte(url => url === consultaGoogle ? { totalItems: 0 } : { docs: [] });
  assert.deepEqual(await vazia.buscarTitulo('Livro desconhecido'), []);
  await assert.rejects(vazia.buscarTitulo('!?'), /letras ou números/);
  const fora = fonte(url => { if (url === consultaGoogle) throw new Error('429'); return null; });
  await assert.rejects(fora.buscarTitulo('Livro de teste'), /fontes de busca não responderam/);
});

test('uma terceira fonte retorna candidatos pertinentes quando Google e Open Library caem', async () => {
  const { api, chamadas } = fonteCapa((url, config) => {
    if (url === consultaGoogle || url === 'https://openlibrary.org/search.json') throw new Error('Fonte indisponível');
    assert.equal(url, 'https://archive.org/advancedsearch.php');
    assert.equal(config.params.q, 'mediatype:texts AND title:"Dom Casmurro"');
    return { data: { response: { docs: [
      { identifier: 'dom-casmurro', title: 'Dom Casmurro', creator: 'Machado de Assis' },
      { identifier: 'dom-casmurro-copia', title: 'Dom Casmurro', creator: ['Machado de Assis'] },
      { identifier: 'outro-volume', title: 'Outro livro', isbn: isbn }
    ] } } };
  });
  assert.deepEqual((await api.buscarTitulo('Dom Casmurro')).map(({ titulo, isbn, origem }) => [titulo, isbn, origem]),
    [['Dom Casmurro', '', 'Internet Archive (catálogo)']]);
  assert.equal(chamadas.length, 3);
});

test('ISBN10 consulta a forma canônica e ainda tenta a forma antiga quando só ela é encontrada', async () => {
  for (const apenasLegado of [false, true]) {
    const { api, chamadas } = fonteCapa(url => {
      if (url === (apenasLegado ? `${prefixoOpen}8533613377.json` : edicaoOpen)) {
        return { data: { title: 'Livro de teste', isbn_10: ['8533613377'] } };
      }
      return { status: 404 };
    });
    assert.equal((await api.openLibrary('85-336-1337-7')).isbn, isbn);
    assert.equal(chamadas.filter(url => url.startsWith(prefixoOpen)).length, apenasLegado ? 2 : 1);
  }
});

test('o mesmo ISBN não confirma editora ou gênero quando títulos válidos divergem', async () => {
  for (const [titulo, aceito] of [['Outro livro', false], ['Livro de teste: Romance', true]] as const) {
    const { api } = fonteCapa(url => {
      if (url === edicaoOpen) return { data: { title: titulo, isbn_13: [isbn], publishers: ['Editora'] } };
      if (url === consultaGoogle) return { data: { items: [google(isbn, { publisher: 'Editora', categories: ['Fantasy'] })] } };
      return { status: 404 };
    });
    await api.openLibrary(isbn);
    assert.equal(await api.buscarEditoraPorIsbn(isbn), aceito ? 'Editora' : null);
    assert.equal(await api.buscarGeneroPorIsbn(isbn), aceito ? 'Fantasia' : null);
  }
});

test('capa truncada ou pendente não bloqueia a seguinte do mesmo provedor', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const truncada = 'https://books.google.com/truncada.png';
  const pendente = 'https://books.google.com/pendente.png';
  let abortada = false;
  const { api, chamadas } = fonteCapa((url, config) => {
    if (url === consultaGoogle) return { data: { items: [truncada, pendente, imagemRemota].map(thumbnail =>
      google(isbn, { imageLinks: { thumbnail } })) } };
    if (url === truncada) return { data: png().subarray(0, -12), headers: { 'content-type': 'image/png' } };
    if (url === pendente) return new Promise((_resolver, rejeitar) => config.signal?.addEventListener?.('abort', () => {
      abortada = true;
      rejeitar(new Error('Cancelado'));
    }));
    return url === imagemRemota ? respostaPng() : { status: 404 };
  });
  const resultado = api.obterCapaAlternativa({ isbn });
  await new Promise<void>(resolver => setImmediate(resolver));
  assert.ok(chamadas.includes(pendente));
  t.mock.timers.tick(1100);
  assert.equal(await resultado, srcEsperado);
  assert.equal(abortada, true);
});

test('data inválida gera um erro de validação, inclusive quando Date não consegue representá-la', () => {
  for (const valor of ['2026-99-15', '2026-02-29']) assert.throws(() => Validacao.data(valor, 'prazo'), /data inválida/);
  assert.equal(Validacao.data('2024-02-29', 'prazo'), '2024-02-29');
});

test('ano da edição aceita datas válidas e recusa datas impossíveis, intervalos e números fora do limite', () => {
  for (const valor of [2009, '2009', '[2009]', 'c2009', '2009-02', '2009-02-28', 'February 2009', '28/02/2009']) {
    assert.equal(ano(valor), 2009, String(valor));
  }
  for (const valor of ['2009-03-99', '2009-13', '31/02/2009', '1990/2007', 'edição de 1990, revista em 2009', '3100002009004', 2100]) {
    assert.equal(ano(valor), null, String(valor));
  }
});

test('anos conflitantes de fontes não oficiais não são transformados em um ano confirmado', async () => {
  const { api } = fonteCapa(url => {
    if (url === edicaoOpen) return { data: { title: '1984', isbn_13: [isbn], publish_date: '2009' } };
    if (url === consultaGoogle) return { data: { items: [google(isbn, { title: '1984', publishedDate: '1949' })] } };
    return { status: 404 };
  });
  const livro = await api.openLibrary(isbn);
  assert.equal(livro.ano, null);
  assert.equal(livro.fonteAno, undefined);
});

test('gênero usa classificação explícita geral quando não há específica e aceita rótulos estruturados', () => {
  assert.equal(classificarGenero(['Literatura', 'Literatura']), 'Literatura');
  assert.equal(classificarGenero(['Literatura inglesa (inclui literatura do Canadá)']), 'Literatura');
  assert.equal(classificarGenero(['Fiction / General', { name: 'Fiction / Science Fiction / General' }]), 'Ficção Científica');
  assert.equal(classificarGenero(['Tema: política', 'Capa dura']), null);
  assert.equal(classificarGenero(['Fantasy', 'Thriller']), null);
});

test('editora e gênero aparecem com uma única ficha exata, sem depender de um segundo provedor', async () => {
  const { api } = fonteCapa(url => {
    if (url === consultaGoogle) return { data: { items: [google(isbn, { publisher: 'Editora legítima', categories: ['Poesia'] })] } };
    throw new Error('Sem conexão com a outra fonte');
  });
  assert.equal(await api.buscarEditoraPorIsbn(isbn), 'Editora legítima');
  assert.equal(await api.buscarGeneroPorIsbn(isbn), 'Poesia');
});

test('ViaCEP preenche cidade e UF, mas um retorno incompleto não grava texto inválido', async () => {
  const urlCep = 'https://viacep.com.br/ws/01001000/json/';
  const api = fonte(url => { assert.equal(url, urlCep); return { localidade: 'São Paulo', uf: 'SP', logradouro: 'Praça da Sé' }; });
  assert.deepEqual(await api.viaCep('01001-000'), { cidade: 'São Paulo', uf: 'SP' });
  await assert.rejects(fonte(() => ({ localidade: 'São Paulo' })).viaCep('01001-000'), /cidade e UF válidas/);
  await assert.rejects(fonte(() => ({ erro: 'true' })).viaCep('01001-000'), /CEP não encontrado/);
});

test('o cálculo de prazo preserva feriados de um ano disponível mesmo se o outro falhar', async () => {
  const api = fonte(url => {
    if (url.endsWith('/2025')) return [{ date: '2025-12-31', name: 'Data usada na simulação' }];
    assert.match(url, /\/2026$/);
    throw new Error('API de feriados indisponível');
  });
  const resultado = await api.calcularPrazo({ inicio: '2025-12-30', dias: 2 });
  assert.equal(resultado.vencimento, '2026-01-02');
  assert.deepEqual(resultado.feriadosConsiderados, ['2025-12-31 — Data usada na simulação']);
  assert.match(resultado.aviso ?? '', /2026/);
});
