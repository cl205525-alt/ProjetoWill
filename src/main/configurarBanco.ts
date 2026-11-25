import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { configuracaoBanco } from './conexao';

async function configurar(): Promise<void> {

  const conn = await mysql.createConnection({
    ...configuracaoBanco,
    multipleStatements: true
  });

  try {
    const sql = readFileSync(resolve(process.cwd(), 'database/schema.sql'), 'utf8');
    await conn.query(sql);
    console.log(`Tabelas da biblioteca preparadas no banco ${configuracaoBanco.database}.`);
    console.log('Abra o aplicativo e crie o primeiro administrador na tela inicial.');
  } finally {
    await conn.end();
  }
}

configurar().catch(erro => {
  console.error('Falha ao preparar banco:', erro.message);
  process.exitCode = 1;
});
