import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Conexao, type ParametroSql } from '../src/main/conexao';
import { CadastroService } from '../src/main/services/CadastroService';
import { CirculacaoService } from '../src/main/services/CirculacaoService';
import { ErroDominio } from '../src/main/validacao';

const isbn10 = '0-8044-2957-x';
const isbn978 = '9780804429573';
const isbn979 = '9791090636071';
const duplicado = { name: 'ErroDominio', message: 'Já existe um livro cadastrado com esse ISBN.' };
const dados = { titulo: 'Livro de teste', quantidade: 1 };
const sugestoes = { editora_nome: 'Sugestão de editora', autores_nomes: ['Sugestão de autor'] };
type Escrita = 'editora' | 'autor' | 'inserir' | 'atualizar' | 'desvincular' | 'vincular';

interface Opcoes {
  livros?: { id: number; isbn: string | null; ativo?: boolean }[];
  circulacao?: { emprestados: number; reservados: number };
  falha?: { escrita: Escrita; erro: Error };
}

function simular(t: TestContext, { livros = [], circulacao, falha }: Opcoes = {}) {
  const eventos: string[] = [];
  const consultasIsbn: ParametroSql[][] = [];
  const escritas: { operacao: Escrita; params: ParametroSql[] }[] = [];
  const pendentes: Escrita[] = [], confirmadas: Escrita[] = [];
  const expressao = [
    ['editora', /^INSERT INTO editoras /, 81],
    ['autor', /^INSERT INTO autores /, 82],
    ['inserir', /^INSERT INTO livros /, 99],
    ['atualizar', /^UPDATE livros /, 0],
    ['desvincular', /^DELETE FROM livro_autores /, 0],
    ['vincular', /^INSERT INTO livro_autores /, 0]
  ] as const;

  const conn = {
    async beginTransaction() { eventos.push('begin'); },
    async commit() { eventos.push('commit'); confirmadas.push(...pendentes.splice(0)); },
    async rollback() { eventos.push('rollback'); pendentes.length = 0; },
    release() { eventos.push('release'); },
    async query(sql: string, params: ParametroSql[]) {
      if (sql === 'SELECT id FROM livros WHERE id=? FOR UPDATE') {
        eventos.push('travar');
        assert.equal(params.length, 1);
        return [livros.filter(livro => livro.id === params[0]).map(({ id }) => ({ id }))];
      }
      assert.match(sql, /\(SELECT COUNT\(\*\) FROM emprestimos WHERE livro_id=\? AND data_devolucao IS NULL\) AS emprestados/);
      assert.match(sql, /\(SELECT COUNT\(\*\) FROM reservas WHERE livro_id=\? AND status='disponivel'\) AS reservados/);
      assert.deepEqual(params, [params[0], params[0]]);
      eventos.push('circulação');
      return [[circulacao ?? { emprestados: 0, reservados: 0 }]];
    },
    async execute(sql: string, params: ParametroSql[]) {
      if (sql === 'SELECT isbn FROM livros WHERE isbn IS NOT NULL AND NOT (id <=> ?)') {
        eventos.push('conferir ISBN');
        consultasIsbn.push(params);
        return [livros.filter(livro => livro.isbn !== null && livro.id !== params[0]).map(({ isbn }) => ({ isbn }))];
      }
      const operacao = expressao.find(([, padrao]) => padrao.test(sql));
      assert.ok(operacao, `SQL não previsto: ${sql}`);
      const [escrita, , insertId] = operacao;
      eventos.push(escrita);
      escritas.push({ operacao: escrita, params });
      if (falha?.escrita === escrita) throw falha.erro;
      pendentes.push(escrita);
      return [{ insertId }];
    }
  };

  const pool = { async getConnection() { eventos.push('conectar'); return conn; } };
  const acesso = t.mock.method(Conexao, 'getPool', () => pool as unknown as ReturnType<typeof Conexao.getPool>);
  const fila = new CirculacaoService();
  t.mock.method(fila, 'disponibilizarFila', async (conexao: unknown) => {
    assert.equal(conexao, conn);
    eventos.push('fila');
    return [];
  });
  t.mock.method(fila, 'emitirAvisos', () => { eventos.push('avisos'); });
  return { cadastro: new CadastroService(fila), eventos, consultasIsbn, escritas, pendentes, confirmadas, acesso };
}

test('ISBN inválido falha antes de qualquer acesso ao MySQL, inclusive ao editar legado inválido', async t => {
  const { cadastro, acesso, eventos } = simular(t, { livros: [{ id: 7, isbn: '9780804429574' }] });
  for (const isbn of ['9780804429574', '0804429570', '1234567890128', '---']) {
    await assert.rejects(cadastro.salvarLivro({ ...dados, ...sugestoes, id: 7, isbn }), {
      name: 'ErroDominio', message: /dígito verificador/
    });
  }
  await assert.rejects(cadastro.salvarLivro({ ...dados, isbn: 42 }), ErroDominio);
  assert.equal(acesso.mock.callCount(), 0);
  assert.deepEqual(eventos, []);
});

test('ISBN-10 terminado em X é gravado como ISBN-13 e a pré-checagem antecede as escritas', async t => {
  const { cadastro, escritas, eventos, consultasIsbn } = simular(t);
  assert.equal(await cadastro.salvarLivro({ ...dados, ...sugestoes, isbn: isbn10 }), 99);
  assert.deepEqual(escritas.find(e => e.operacao === 'inserir')?.params,
    [dados.titulo, isbn978, null, null, 1, 81, null]);
  assert.deepEqual(consultasIsbn, [[null]]);
  assert.deepEqual(eventos, ['conectar', 'begin', 'conferir ISBN', 'editora', 'autor', 'inserir', 'vincular', 'fila', 'commit', 'release', 'avisos']);
});

test('ISBN-13 equivalente a ISBN-10 legado formatado em livro arquivado é recusado antes das escritas', async t => {
  const { cadastro, escritas, eventos } = simular(t, { livros: [{ id: 4, isbn: '0 8044-2957-x', ativo: false }] });
  await assert.rejects(cadastro.salvarLivro({ ...dados, ...sugestoes, isbn: isbn978 }), duplicado);
  assert.deepEqual(escritas, []);
  assert.deepEqual(eventos, ['conectar', 'begin', 'conferir ISBN', 'rollback', 'release']);
});

test('na edição, trava a PK antes da pré-checagem e recusa ISBN-10 equivalente a ISBN-13 legado de outro livro', async t => {
  const { cadastro, escritas, eventos, consultasIsbn } = simular(t, { livros: [
    { id: 7, isbn: null }, { id: 8, isbn: ' 978-0-8044-2957-3 ' }
  ] });
  await assert.rejects(cadastro.salvarLivro({ ...dados, ...sugestoes, id: '7', isbn: isbn10 }), duplicado);
  assert.deepEqual(consultasIsbn, [[7]]);
  assert.deepEqual(escritas, []);
  assert.deepEqual(eventos, ['conectar', 'begin', 'travar', 'circulação', 'conferir ISBN', 'rollback', 'release']);
});

test('na edição, ignora o ISBN equivalente do próprio livro e grava a forma canônica', async t => {
  const { cadastro, eventos, consultasIsbn, escritas } = simular(t, { livros: [{ id: 7, isbn: isbn10 }] });
  assert.equal(await cadastro.salvarLivro({ ...dados, id: 7, isbn: '978-0-8044-2957-3' }), 7);
  assert.deepEqual(consultasIsbn, [[7]]);
  assert.deepEqual(escritas[0], { operacao: 'atualizar', params: [dados.titulo, isbn978, null, null, 1, null, null, 7] });
  assert.deepEqual(eventos, ['conectar', 'begin', 'travar', 'circulação', 'conferir ISBN', 'atualizar', 'desvincular', 'fila', 'commit', 'release', 'avisos']);
});

test('ISBN 979 válido não é confundido com ISBN-10 da mesma base nem com legado de dígito inválido', async t => {
  const { cadastro, escritas, consultasIsbn } = simular(t, { livros: [
    { id: 7, isbn: '1090636075' }, { id: 8, isbn: '9791090636072' }
  ] });
  assert.equal(await cadastro.salvarLivro({ ...dados, isbn: '979-10-90636-07-1' }), 99);
  assert.deepEqual(consultasIsbn, [[null]]);
  assert.equal(escritas[0].params[1], isbn979);
  assert.equal(escritas.length, 1);
});

test('ausência de ISBN grava NULL sem pré-checagem e permite remover ISBN legado inválido', async t => {
  const { cadastro, consultasIsbn, escritas } = simular(t, { livros: [{ id: 7, isbn: 'invalido' }] });
  assert.equal(await cadastro.salvarLivro(dados), 99);
  assert.equal(await cadastro.salvarLivro({ ...dados, isbn: '  ' }), 99);
  assert.equal(await cadastro.salvarLivro({ ...dados, id: 7, isbn: null }), 7);
  assert.deepEqual(consultasIsbn, []);
  assert.deepEqual(escritas.filter(e => e.operacao !== 'desvincular').map(e => e.params[1]), [null, null, null]);
});

test('a edição ainda valida exemplares emprestados e reservados antes das escritas', async t => {
  const { cadastro, escritas, eventos } = simular(t, {
    livros: [{ id: 7, isbn: isbn978 }], circulacao: { emprestados: 1, reservados: 1 }
  });
  await assert.rejects(cadastro.salvarLivro({ ...dados, ...sugestoes, id: 7, isbn: isbn978 }), /exemplares emprestados e separados/);
  assert.deepEqual(escritas, []);
  assert.deepEqual(eventos, ['conectar', 'begin', 'travar', 'circulação', 'rollback', 'release']);
});

for (const escrita of ['inserir', 'atualizar'] as const) {
  test(`ER_DUP_ENTRY ao ${escrita} livro tem a mensagem da pré-checagem e desfaz escritas simuladas`, async t => {
    const { cadastro, eventos, escritas, pendentes, confirmadas } = simular(t, {
      livros: [{ id: 7, isbn: 'invalido' }],
      falha: { escrita, erro: Object.assign(new Error('colisão do índice'), { code: 'ER_DUP_ENTRY' }) }
    });
    await assert.rejects(cadastro.salvarLivro({ ...dados, ...sugestoes, id: escrita === 'atualizar' ? 7 : undefined, isbn: isbn978 }), duplicado);
    assert.deepEqual(escritas.map(e => e.operacao), ['editora', 'autor', escrita]);
    assert.deepEqual(eventos.slice(-3), [escrita, 'rollback', 'release']);
    assert.deepEqual(pendentes, []);
    assert.deepEqual(confirmadas, []);
  });
}

for (const [escrita, code] of [['autor', 'ER_DUP_ENTRY'], ['vincular', 'ER_DUP_ENTRY'], ['inserir', 'ER_LOCK_DEADLOCK']] as const) {
  test(`propaga ${code} sem tradução em ${escrita}`, async t => {
    const erro = Object.assign(new Error('erro original'), { code });
    const { cadastro, eventos } = simular(t, { falha: { escrita, erro } });
    await assert.rejects(cadastro.salvarLivro({ ...dados, ...sugestoes, isbn: isbn978 }), recebido => recebido === erro);
    assert.deepEqual(eventos.slice(-3), [escrita, 'rollback', 'release']);
  });
}
