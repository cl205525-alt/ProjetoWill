import mysql, { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { resolve } from 'node:path';
import { config } from 'dotenv';

config({ path: resolve(process.cwd(), '.env') });

const dbName = process.env.DB_NAME || 'cl205299';
if (!/^[A-Za-z0-9_]+$/.test(dbName)) throw new Error('Nome de banco inválido no .env.');

export const configuracaoBanco = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: dbName,
  charset: 'utf8mb4' as const
};

/** Tipos aceitos como parâmetros `?` (consultas SEMPRE parametrizadas, nunca concatenadas). */
export type ParametroSql = string | number | boolean | Date | Buffer | null;

/** Acesso ao MySQL (pool de conexões). Toda a camada de serviços passa por aqui. */
export class Conexao {
  private static pool: Pool | null = null;

  static getPool(): Pool {
    if (!this.pool) {
      this.pool = mysql.createPool({
        ...configuracaoBanco,
        waitForConnections: true,
        connectionLimit: 8,
        dateStrings: true,
        timezone: 'Z'
      });
    }
    return this.pool;
  }

  static async consultar<T extends RowDataPacket>(sql: string, params: ParametroSql[] = []): Promise<T[]> {
    const [rows] = await this.getPool().execute<T[]>(sql, params);
    return rows;
  }

  static async executar(sql: string, params: ParametroSql[] = []): Promise<ResultSetHeader> {
    const [result] = await this.getPool().execute<ResultSetHeader>(sql, params);
    return result;
  }

  /** Executa `acao` numa transação: commit se tudo der certo, rollback em qualquer erro. */
  static async transacao<T>(acao: (conn: PoolConnection) => Promise<T>): Promise<T> {
    const conn = await this.getPool().getConnection();
    try {
      await conn.beginTransaction();
      const resultado = await acao(conn);
      await conn.commit();
      return resultado;
    } catch (erro) {
      await conn.rollback();
      throw erro;
    } finally {
      conn.release();
    }
  }

  static async fechar(): Promise<void> {
    if (this.pool) { await this.pool.end(); this.pool = null; }
  }
}
