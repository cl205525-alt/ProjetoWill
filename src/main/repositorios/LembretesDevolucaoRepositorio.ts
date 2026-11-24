import { randomUUID } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { Conexao } from '../conexao';

export interface TentativaLembrete {
  id: number;
  chaveEnvio: string;
  prazo: string;
  livro: string;
  email: string | null;
}

export type ResultadoEnvioLembrete =
  | { status: 'enviado'; referencia: string }
  | { status: 'falha' | 'sem_email' };

export interface RegistroLembretesDevolucao {
  candidatos(prazo: string): Promise<number[]>;
  reservarTentativa(emprestimoId: number, prazo: string): Promise<TentativaLembrete | null>;
  registrarResultado(id: number, resultado: ResultadoEnvioLembrete): Promise<boolean>;
}

interface DadosTentativa extends RowDataPacket {
  lembrete_id: number | null;
  chave_envio: string | null;
  livro: string;
  email: string | null;
}

const ADMITIR_TENTATIVA = `(
  d.id IS NULL OR (d.status_envio <> 'enviado' AND d.tentativa_em <= CURRENT_TIMESTAMP - INTERVAL 10 MINUTE)
)`;

export class LembretesDevolucaoRepositorio implements RegistroLembretesDevolucao {
  async candidatos(prazo: string): Promise<number[]> {
    const linhas = await Conexao.consultar<RowDataPacket & { id: number }>(`
      SELECT e.id FROM emprestimos e
      LEFT JOIN lembretes_devolucao d ON d.emprestimo_id = e.id AND d.data_prevista = e.data_prevista
      WHERE e.data_devolucao IS NULL AND e.data_prevista = ? AND e.data_retirada < e.data_prevista
        AND ${ADMITIR_TENTATIVA}
      ORDER BY d.tentativa_em, e.id LIMIT 10`, [prazo]);
    return linhas.map(linha => linha.id);
  }

  async reservarTentativa(emprestimoId: number, prazo: string): Promise<TentativaLembrete | null> {
    return Conexao.transacao(async conn => {
      // Revalida o empréstimo e serializa as tentativas entre instalações do Lumi.
      // O lock acaba antes da chamada ao provedor; não bloqueia devoluções durante o envio.
      const [ativos] = await conn.execute<RowDataPacket[]>(`
        SELECT id FROM emprestimos
        WHERE id = ? AND data_prevista = ? AND data_devolucao IS NULL AND data_retirada < data_prevista
        FOR UPDATE`, [emprestimoId, prazo]);
      if (!ativos.length) return null;
      const [[dados]] = await conn.execute<DadosTentativa[]>(`
        SELECT d.id AS lembrete_id, d.chave_envio, l.titulo AS livro, p.email
        FROM emprestimos e JOIN leitores p ON p.id = e.leitor_id JOIN livros l ON l.id = e.livro_id
        LEFT JOIN lembretes_devolucao d ON d.emprestimo_id = e.id AND d.data_prevista = e.data_prevista
        WHERE e.id = ? AND ${ADMITIR_TENTATIVA}`, [emprestimoId]);
      if (!dados) return null;

      let { lembrete_id: id, chave_envio: chaveEnvio } = dados;
      if (id === null) {
        chaveEnvio = randomUUID();
        const [inserido] = await conn.execute<ResultSetHeader>(`
          INSERT INTO lembretes_devolucao (emprestimo_id, data_prevista, chave_envio) VALUES (?, ?, ?)`,
        [emprestimoId, prazo, chaveEnvio]);
        id = inserido.insertId;
      } else {
        await conn.execute('UPDATE lembretes_devolucao SET tentativa_em = CURRENT_TIMESTAMP WHERE id = ?', [id]);
      }
      if (!chaveEnvio) throw new Error('Lembrete sem chave de envio.');
      return { id, chaveEnvio, prazo, livro: dados.livro, email: dados.email };
    });
  }

  async registrarResultado(id: number, resultado: ResultadoEnvioLembrete): Promise<boolean> {
    const { status } = resultado;
    const referencia = resultado.status === 'enviado' ? resultado.referencia : null;
    const atualizado = await Conexao.executar(`UPDATE lembretes_devolucao
      SET lida = 0, status_envio = ?, referencia_provedor = ?,
          enviado_em = CASE WHEN ? = 'enviado' THEN CURRENT_TIMESTAMP ELSE NULL END
      WHERE id = ? AND status_envio <> 'enviado' AND status_envio <> ?`,
    [status, referencia, status, id, status]);
    return atualizado.affectedRows > 0;
  }
}

/** Permite continuar usando as notificações de reserva antes de atualizar uma instalação antiga. */
export function tabelaLembretesAusente(erro: unknown): boolean {
  return typeof erro === 'object' && erro !== null && 'code' in erro && erro.code === 'ER_NO_SUCH_TABLE';
}
