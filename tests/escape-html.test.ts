import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';

const texto = `<b>Teste</b> — Edição d'Ávila & "Cia"`;
const escapado = '&lt;b&gt;Teste&lt;/b&gt; — Edição d&#39;Ávila &amp; &quot;Cia&quot;';
const contexto = createContext({ texto });
for (const arquivo of ['Util', 'Html', 'Graficos']) {
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
  const area = renderizar(`Html.area('sinopse', texto, texto)`);
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
