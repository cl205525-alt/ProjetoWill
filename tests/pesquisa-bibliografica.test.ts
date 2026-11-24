import assert from 'node:assert/strict';
import test from 'node:test';
import axios, { type InternalAxiosRequestConfig } from 'axios';
import { IntegracoesService } from '../src/main/services/IntegracoesService';
import { isbn13 } from '../src/main/services/PesquisaBibliografica';

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

test('a busca por ISBN rejeita um primeiro resultado diferente e completa apenas campos vazios', async () => {
  const api = fonte((url, config) => {
    if (url.includes('www.googleapis.com')) return { items: [
      google(outraEdicao, { publisher: 'Editora errada', description: 'Não misturar', publishedDate: '2021' }),
      google(isbn, { publisher: 'Editora confirmada' })
    ] };
    if (url.includes('openlibrary.org/isbn/')) return { title: 'Livro por ISBN', isbn_10: ['8533613377'], publish_date: '2001' };
    if (url.includes('covers.openlibrary.org')) return null;
    assert.match(url, /brasilapi\.com\.br\/api\/isbn/);
    assert.equal(config.params.providers, 'cbl,mercado-editorial');
    return { isbn: '8533613377', title: 'Livro brasileiro', publisher: 'Não sobrescrever', year: 2020, authors: ['SOBRENOME, Nome'], synopsis: '<p>Resumo complementar.</p>', provider: 'cbl' };
  });
  const livro = await api.openLibrary('8533613377');
  assert.equal(livro.isbn, isbn);
  assert.equal(livro.titulo, 'Livro por ISBN');
  assert.equal(livro.editora, 'Editora confirmada');
  assert.equal(livro.ano, 2001);
  assert.equal(livro.sinopse, 'Resumo complementar.');
  assert.deepEqual(livro.autores, ['Nome SOBRENOME']);
  assert.match(livro.origem, /BrasilAPI \(CBL\)/);
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
