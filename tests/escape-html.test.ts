import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';

const texto = `<b>Teste</b> — Edição d'Ávila & "Cia"`;
const escapado = '&lt;b&gt;Teste&lt;/b&gt; — Edição d&#39;Ávila &amp; &quot;Cia&quot;';
const contexto = createContext({ texto });
for (const arquivo of ['Util', 'Html', 'Graficos', 'PaginaBase', 'PaginaCadastroSimples', 'PaginaLivros']) {
  const fonte = readFileSync(`src/renderer/ts/${arquivo}.ts`, 'utf8');
  const compilado = ts.transpileModule(fonte, { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  runInContext(compilado.outputText, contexto, { filename: `${arquivo}.ts` });
}
function renderizar(expressao: string): string {
  return runInContext(expressao, contexto) as string;
}

test('o escape preserva acentos e protege os cinco caracteres especiais do HTML', () => {
  assert.equal(renderizar('Util.esc(texto)'), escapado);
  assert.equal(renderizar(`Util.esc('&lt;b&gt;')`), '&amp;lt;b&amp;gt;');
  assert.equal(renderizar('Util.esc(null)'), '');
});

test('formulários e busca escapam valores e rótulos sem duplo escape', () => {
  const campo = renderizar(`Html.campo('titulo', texto, texto, 'text', 'required', texto)`);
  const area = renderizar(`Html.area('observacoes', texto, texto)`);
  const selecao = renderizar(`Html.selecao('editora', texto, [{ id: 1, nome: texto }], 1, '', texto)`);
  assert.ok(campo.includes(`value="${escapado}"`));
  assert.ok(area.includes(`>${escapado}</textarea>`));
  assert.ok(selecao.includes(`<option value="1" selected>${escapado}</option>`));
  for (const html of [campo, area, selecao, renderizar(`Html.barra({ busca: texto, filtros: [[texto, texto, 3]] })`)]) {
    assert.ok(html.includes(escapado));
    assert.ok(!html.includes('<b>Teste</b>'));
    assert.ok(!html.includes('&amp;lt;b'));
  }
});

test('detalhes e cabeçalhos distinguem texto de elementos gerados pela interface', () => {
  const html = renderizar(`Html.cabecalho(texto, texto, Html.botao('editar', texto, 'pencil')) + Html.detalhe('Editora', texto)`);
  assert.ok(html.includes(`<h1>${escapado}</h1>`));
  assert.ok(html.includes(`<b>${escapado}</b>`));
  assert.ok(html.includes('<button '));
  assert.ok(!html.includes('<b>Teste</b>'));
  assert.equal(renderizar('Util.data(texto)'), '—');
  assert.equal(renderizar(`Util.dataHora('2026-11-19 14:20:00')`), '19/11/2026 às 14:20');
});

test('os gráficos renderizam rótulos como texto e totais como números', () => {
  const html = renderizar(`Graficos.barrasHorizontais([{ rotulo: texto, total: '3' }], '')`);
  assert.ok(html.includes(`title="${escapado}"`));
  assert.ok(html.includes('<b>3</b>'));
  assert.ok(!renderizar(`Graficos.rosca({ em_dia: texto, atrasados: 2, devolvidos: 1 })`).includes('<b>Teste</b>'));
});

test('Datas inexistentes e números inválidos não são exibidos como valores reais', () => {
  assert.equal(renderizar("Util.data('2026-02-29')"), '—');
  assert.equal(renderizar("Util.dataHora('2026-99-01 09:21:00')"), '—');
  assert.equal(renderizar("Util.numero('Infinity')"), 0);
  assert.equal(renderizar("Util.data('2024-02-29')"), '29/02/2024');
});

test('a tela de autor lista somente vínculos pelo ID inteiro, inclusive livros arquivados e coautorias', () => {
  const html = renderizar(`(() => {
    const estado = { autores: [{ id: 1, nome: texto, total_livros: 2 }], livros: [
      { id: 2, titulo: 'Título arquivado', autor_ids: '2, 1', ativo: false },
      { id: 3, titulo: 'Título ativo', autor_ids: '1', ativo: true },
      { id: 4, titulo: 'Autor diferente', autor_ids: '11' }
    ] };
    const pagina = new PaginaAutores({ estado });
    const lista = pagina.render();
    pagina.autorSelecionado = '1';
    return lista + '\\n' + pagina.render();
  })()`);
  assert.match(html, /data-action="livros-do-autor"/);
  assert.match(html, /Ver 2 livros de/);
  assert.match(html, /Título arquivado|Arquivado/);
  assert.ok(html.includes('Título ativo'));
  assert.ok(!html.includes('Autor diferente'));
  assert.ok(html.includes(escapado));
});

test('um gênero bibliográfico válido aparece mesmo quando o acervo ainda está vazio', () => {
  assert.equal(renderizar(`new GeneroAssistido({ isbn: '9788535914849', genero: 'Literatura' }, undefined, false).nome([])`), 'Literatura');
  assert.equal(renderizar(`new GeneroAssistido({ isbn: '9788535914849', genero: 'Literatura' }, undefined, false).nome(['literatura'])`), 'literatura');
});

test('a confirmação pelo ISBN substitui o ano provisório, mas não uma correção manual', () => {
  const resultado = renderizar(`(() => {
    const campo = { value: '' }, status = { textContent: '' };
    globalThis.document = { querySelector: seletor => seletor.includes('metadata-ano-status') ? status : campo };
    try {
      const p = new PaginaLivros({});
      p.aplicarAno({ isbn: '9788535914849', ano: 1949 }, false);
      if (campo.value !== '1949' || !p.anoEmConferencia) throw new Error('Ano provisório ausente');
      p.aplicarAno({ isbn: '9788535914849', ano: 2009, fonteAno: 'BrasilAPI (CBL)' }, true);
      if (campo.value !== '2009' || p.anoEmConferencia || !status.textContent.includes('CBL')) throw new Error('Ano confirmado não aplicado');
      p.editados.add('ano_publicacao');
      campo.value = '2008';
      p.aplicarAno({ isbn: '9788535914849', ano: 2009 }, true);
      return campo.value;
    } finally { delete globalThis.document; }
  })()`);
  assert.equal(resultado, '2008');
});
