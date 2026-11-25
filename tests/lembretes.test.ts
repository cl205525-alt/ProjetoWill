import assert from 'node:assert/strict';
import test from 'node:test';
import axios, { type InternalAxiosRequestConfig } from 'axios';
import type { RegistroLembretesDevolucao, ResultadoEnvioLembrete, TentativaLembrete } from '../src/main/repositorios/LembretesDevolucaoRepositorio';
import { EmailResendService, type EmailLembrete } from '../src/main/services/EmailResendService';
import { LembretesDevolucaoService, prazoAmanha } from '../src/main/services/LembretesDevolucaoService';

const dataDaBiblioteca = () => new Date(2026, 10, 19, 23, 50);
const prazo = '2026-11-20';
const tentativa: TentativaLembrete = {
  id: 41, chaveEnvio: 'chave-teste', prazo, livro: 'Livro de teste', email: 'leitor@example.com'
};

test('calcula amanhã pelo calendário local, inclusive nas viradas de mês e ano', () => {
  assert.equal(prazoAmanha(dataDaBiblioteca()), prazo);
  assert.equal(prazoAmanha(new Date(2026, 11, 31, 23, 59)), '2027-01-01');
  assert.equal(prazoAmanha(new Date(2028, 1, 28, 22)), '2028-02-29');
});

test('só registra Enviado depois do aceite e separa destinatário inválido de resposta recusada', async () => {
  const resultados: [number, ResultadoEnvioLembrete][] = [];
  const emails: EmailLembrete[] = [];
  const tentativas = new Map<number, TentativaLembrete>([
    [1, tentativa],

    [3, { ...tentativa, id: 43, email: null }],
    [4, { ...tentativa, id: 44, email: 'a@example.com,b@example.com' }],
    [5, { ...tentativa, id: 45, email: 'recusado@example.com' }]
  ]);
  const registro: RegistroLembretesDevolucao = {
    async candidatos(data) { assert.equal(data, prazo); return [1, 2, 3, 4, 5]; },
    async reservarTentativa(id, data) { assert.equal(data, prazo); return tentativas.get(id) ?? null; },
    async registrarResultado(id, resultado) { resultados.push([id, resultado]); return true; }
  };
  let atualizacoes = 0;
  const servico = new LembretesDevolucaoService(registro, {
    async enviar(email) {
      emails.push(email);
      if (email.destinatario === 'recusado@example.com') throw new Error('Erro simulado do provedor');
      assert.equal(resultados.length, 0);
      return 'id-confirmado';
    }
  }, () => atualizacoes++, dataDaBiblioteca);

  await servico.verificar();
  assert.equal(emails.length, 2);
  assert.match(emails[0].texto, /Livro de teste.*20\/11\/2026/);
  assert.deepEqual(resultados, [
    [41, { status: 'enviado', referencia: 'id-confirmado' }],
    [43, { status: 'sem_email' }],
    [44, { status: 'sem_email' }],
    [45, { status: 'falha' }]
  ]);
  assert.equal(atualizacoes, 1);
});

test('não envia sem provedor configurado nem executa dois ciclos em paralelo', async () => {
  let consultas = 0;
  const resultados: ResultadoEnvioLembrete[] = [];
  const registro: RegistroLembretesDevolucao = {
    async candidatos() { consultas++; return [1]; },
    async reservarTentativa() { return tentativa; },
    async registrarResultado(_id, resultado) { resultados.push(resultado); return false; }
  };
  const servico = new LembretesDevolucaoService(registro, null, () => assert.fail('O estado não mudou.'), dataDaBiblioteca);
  await Promise.all([servico.verificar(), servico.verificar()]);
  assert.equal(consultas, 1);
  assert.deepEqual(resultados, [{ status: 'falha' }]);
  assert.equal(EmailResendService.configurar({ RESEND_API_KEY: 'chave-de-teste' }), null);
});

test('não envia se a véspera terminar enquanto a tentativa é registrada', async () => {
  let agora = dataDaBiblioteca();
  const registro: RegistroLembretesDevolucao = {
    async candidatos() { return [1]; },
    async reservarTentativa() { agora = new Date(2026, 10, 20, 0, 0); return tentativa; },
    async registrarResultado() { return assert.fail('Não houve envio.'); }
  };
  const servico = new LembretesDevolucaoService(registro, {
    async enviar() { return assert.fail('A véspera já acabou.'); }
  }, () => assert.fail('Nenhum resultado foi registrado.'), () => agora);
  await servico.verificar();
});

test('o cliente usa a mesma chave em retentativas e exige uma confirmação válida', async () => {
  const chamadas: InternalAxiosRequestConfig[] = [];
  let resposta: unknown = { id: 'confirmacao-123' };
  const cliente = axios.create({
    adapter: async config => {
      chamadas.push(config);
      return { data: resposta, status: 200, statusText: 'OK', headers: {}, config };
    }
  });
  const provedor = new EmailResendService('chave-de-teste', 'biblioteca@example.com', cliente);
  const email: EmailLembrete = { destinatario: 'leitor@example.com', texto: 'Devolução: 20/11/2026', chaveEnvio: 'chave-estavel' };
  assert.equal(await provedor.enviar(email), 'confirmacao-123');
  assert.equal(await provedor.enviar(email), 'confirmacao-123');
  assert.deepEqual(chamadas.map(c => c.headers.get('Idempotency-Key')), ['lumi-devolucao/chave-estavel', 'lumi-devolucao/chave-estavel']);
  assert.equal(chamadas[0].url, 'https://api.resend.com/emails');
  assert.deepEqual(JSON.parse(String(chamadas[0].data)).to, ['leitor@example.com']);
  resposta = {};
  await assert.rejects(provedor.enviar(email), /não confirmou/);
});
