import { EventEmitter } from 'node:events';
import { RowDataPacket, PoolConnection } from 'mysql2/promise';
import { Conexao } from '../conexao';
import { ErroDominio, Validacao as V } from '../validacao';

/** Aviso gerado quando um exemplar reservado fica disponível (vira notificação interna e do sistema). */
export interface AvisoFila { reservaId: number; leitorId: number; leitor: string; livro: string; }

/**
 * Circulação: empréstimos, devoluções, reservas (fila) e notificações.
 * Toda movimentação de estoque ocorre em transação, travando primeiro a linha do livro
 * (mesma ordem de locks em todos os métodos para evitar deadlocks).
 * Emite o evento 'reserva-disponivel' DEPOIS do commit.
 */
export class CirculacaoService extends EventEmitter {
  // ---------- Leitura ----------
  async emprestimos(): Promise<RowDataPacket[]> {
    return Conexao.consultar<RowDataPacket>(`SELECT em.*, l.titulo AS livro, l.capa_url, l.isbn, p.nome AS leitor, c.nome AS atendente,
      CASE WHEN em.data_devolucao IS NOT NULL THEN 'devolvido'
        WHEN em.data_prevista < CURDATE() THEN 'atrasado' ELSE 'em_dia' END AS situacao,
      CASE WHEN em.data_devolucao IS NULL AND em.data_prevista < CURDATE() THEN DATEDIFF(CURDATE(), em.data_prevista) ELSE 0 END AS dias_atraso
      FROM emprestimos em JOIN livros l ON l.id=em.livro_id JOIN leitores p ON p.id=em.leitor_id
      JOIN colaboradores c ON c.id=em.colaborador_id
      ORDER BY em.data_devolucao IS NULL DESC, em.data_prevista ASC, em.id DESC`);
  }

  async reservas(): Promise<RowDataPacket[]> {
    return Conexao.consultar<RowDataPacket>(`SELECT r.*, l.titulo AS livro, l.capa_url, l.isbn, p.nome AS leitor, p.email, p.telefone,
      (SELECT COUNT(*) FROM reservas r2 WHERE r2.livro_id=r.livro_id AND r2.status='aguardando'
       AND (r2.criada_em < r.criada_em OR (r2.criada_em=r.criada_em AND r2.id<=r.id))) AS posicao
      FROM reservas r JOIN livros l ON l.id=r.livro_id JOIN leitores p ON p.id=r.leitor_id
      ORDER BY FIELD(r.status,'disponivel','aguardando','concluida','cancelada'), r.criada_em, r.id`);
  }

  async notificacoes(): Promise<RowDataPacket[]> {
    return Conexao.consultar<RowDataPacket>(`SELECT n.*, p.nome AS leitor, p.email, p.telefone, l.titulo AS livro
      FROM notificacoes n JOIN leitores p ON p.id=n.leitor_id
      LEFT JOIN reservas r ON r.id=n.reserva_id LEFT JOIN livros l ON l.id=r.livro_id
      ORDER BY n.lida ASC, n.criada_em DESC, n.id DESC LIMIT 200`);
  }

  async painel(): Promise<RowDataPacket> {
    const [stats] = await Conexao.consultar<RowDataPacket>(`SELECT
      (SELECT COUNT(*) FROM livros WHERE ativo=1) AS titulos,
      (SELECT COALESCE(SUM(quantidade),0) FROM livros WHERE ativo=1) AS exemplares,
      (SELECT COUNT(*) FROM leitores WHERE ativo=1) AS leitores,
      (SELECT COUNT(*) FROM emprestimos WHERE data_devolucao IS NULL) AS emprestimos,
      (SELECT COUNT(*) FROM emprestimos WHERE data_devolucao IS NULL AND data_prevista<CURDATE()) AS atrasados,
      (SELECT COUNT(*) FROM reservas WHERE status='aguardando') AS reservas,
      (SELECT COUNT(*) FROM reservas WHERE status='disponivel') AS retiradas,
      (SELECT COUNT(*) FROM notificacoes WHERE lida=0) AS avisos`);
    return stats;
  }

  /** Dados agregados (SQL) para os gráficos da visão geral. */
  async graficos(): Promise<Record<string, unknown>> {
    const porMes = await Conexao.consultar<RowDataPacket>(`SELECT DATE_FORMAT(data_retirada,'%Y-%m') AS mes, COUNT(*) AS total
      FROM emprestimos WHERE data_retirada >= DATE_SUB(DATE_FORMAT(CURDATE(),'%Y-%m-01'), INTERVAL 5 MONTH)
      GROUP BY DATE_FORMAT(data_retirada,'%Y-%m')`);
    const mapa = new Map(porMes.map(l => [String(l.mes), Number(l.total)]));
    const agora = new Date();
    const meses: { mes: string; total: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
      const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      meses.push({ mes: chave, total: mapa.get(chave) ?? 0 });
    }
    const [situacao] = await Conexao.consultar<RowDataPacket>(`SELECT
      COALESCE(SUM(data_devolucao IS NOT NULL),0) AS devolvidos,
      COALESCE(SUM(data_devolucao IS NULL AND data_prevista>=CURDATE()),0) AS em_dia,
      COALESCE(SUM(data_devolucao IS NULL AND data_prevista<CURDATE()),0) AS atrasados FROM emprestimos`);
    const topLivros = await Conexao.consultar<RowDataPacket>(`SELECT l.titulo, COUNT(*) AS total FROM emprestimos e
      JOIN livros l ON l.id=e.livro_id GROUP BY l.id, l.titulo ORDER BY total DESC, l.titulo LIMIT 5`);
    const generos = await Conexao.consultar<RowDataPacket>(`SELECT COALESCE(NULLIF(genero,''),'Sem gênero') AS genero, SUM(quantidade) AS total
      FROM livros WHERE ativo=1 GROUP BY COALESCE(NULLIF(genero,''),'Sem gênero') ORDER BY total DESC LIMIT 6`);
    return {
      meses,
      situacao: { devolvidos: Number(situacao.devolvidos), em_dia: Number(situacao.em_dia), atrasados: Number(situacao.atrasados) },
      topLivros: topLivros.map(l => ({ titulo: String(l.titulo), total: Number(l.total) })),
      generos: generos.map(g => ({ genero: String(g.genero), total: Number(g.total) }))
    };
  }

  // ---------- Estoque ----------
  private async disponibilidade(conn: PoolConnection, livroId: number): Promise<{ total: number; ativas: number; separadas: number }> {
    const [r] = await conn.query<RowDataPacket[]>(`SELECT
      (SELECT COUNT(*) FROM emprestimos WHERE livro_id=? AND data_devolucao IS NULL) AS ativas,
      (SELECT COUNT(*) FROM reservas WHERE livro_id=? AND status='disponivel') AS separadas`, [livroId, livroId]);
    const [l] = await conn.query<RowDataPacket[]>('SELECT quantidade FROM livros WHERE id=?', [livroId]);
    if (!l.length) throw new ErroDominio('Livro não encontrado.');
    return { total: Number(l[0].quantidade), ativas: Number(r[0].ativas), separadas: Number(r[0].separadas) };
  }

  /** Promove, em ordem, quem está na fila enquanto houver exemplares livres. Rode dentro de uma transação. */
  async disponibilizarFila(conn: PoolConnection, livroId: number): Promise<AvisoFila[]> {
    const avisos: AvisoFila[] = [];
    for (;;) {
      const estoque = await this.disponibilidade(conn, livroId);
      if (estoque.total - estoque.ativas - estoque.separadas <= 0) return avisos;
      const [fila] = await conn.query<RowDataPacket[]>(`SELECT r.id, r.leitor_id, l.titulo, p.nome AS leitor
        FROM reservas r JOIN livros l ON l.id=r.livro_id JOIN leitores p ON p.id=r.leitor_id
        WHERE r.livro_id=? AND r.status='aguardando' ORDER BY r.criada_em, r.id LIMIT 1 FOR UPDATE`, [livroId]);
      if (!fila.length) return avisos;
      const r = fila[0];
      await conn.execute("UPDATE reservas SET status='disponivel', avisada_em=NOW() WHERE id=?", [r.id]);
      await conn.execute('INSERT INTO notificacoes (reserva_id, leitor_id, mensagem) VALUES (?,?,?)',
        [r.id, r.leitor_id, `Boa notícia! O livro "${String(r.titulo).slice(0, 200)}" está disponível para retirada. Entre em contato com a biblioteca.`]);
      avisos.push({ reservaId: Number(r.id), leitorId: Number(r.leitor_id), leitor: String(r.leitor), livro: String(r.titulo) });
    }
  }

  emitirAvisos(avisos: AvisoFila[]): void {
    for (const aviso of avisos) this.emit('reserva-disponivel', aviso);
  }

  /** Trava o livro do empréstimo/reserva informado (padroniza a ordem dos locks). */
  private async travarLivroDe(conn: PoolConnection, tabela: 'emprestimos' | 'reservas', id: number, rotulo: string): Promise<number> {
    const [ref] = await conn.query<RowDataPacket[]>(`SELECT livro_id FROM ${tabela} WHERE id=?`, [id]);
    if (!ref.length) throw new ErroDominio(`${rotulo} não encontrado(a).`);
    const livroId = Number(ref[0].livro_id);
    await conn.query('SELECT id FROM livros WHERE id=? FOR UPDATE', [livroId]);
    return livroId;
  }

  // ---------- Empréstimos ----------
  async emprestar(dados: unknown, colaboradorId: number): Promise<void> {
    const d = V.objeto(dados);
    const livroId = V.inteiro(d.livro_id, 'livro');
    const leitorId = V.inteiro(d.leitor_id, 'leitor');
    const retirada = V.data(d.data_retirada, 'data de retirada');
    const prevista = V.data(d.data_prevista, 'prazo');
    if (prevista < retirada) throw new ErroDominio('Prazo não pode ser anterior à retirada.');
    await Conexao.transacao(async conn => {
      const [livros] = await conn.query<RowDataPacket[]>('SELECT id, ativo FROM livros WHERE id=? FOR UPDATE', [livroId]);
      if (!livros.length || !livros[0].ativo) throw new ErroDominio('Livro indisponível.');
      const [leitores] = await conn.query<RowDataPacket[]>('SELECT ativo FROM leitores WHERE id=? FOR UPDATE', [leitorId]);
      if (!leitores.length || !leitores[0].ativo) throw new ErroDominio('Leitor não está ativo.');
      const estoque = await this.disponibilidade(conn, livroId);
      if (estoque.ativas >= estoque.total) throw new ErroDominio('Todos os exemplares estão emprestados. Cadastre uma reserva.');
      const [minhaReserva] = await conn.query<RowDataPacket[]>(
        "SELECT id FROM reservas WHERE livro_id=? AND leitor_id=? AND status='disponivel' ORDER BY criada_em, id LIMIT 1 FOR UPDATE", [livroId, leitorId]);
      if (!minhaReserva.length && estoque.total - estoque.ativas - estoque.separadas <= 0) {
        throw new ErroDominio('Os exemplares disponíveis estão separados para a fila de reservas.');
      }
      const [jaPossui] = await conn.query<RowDataPacket[]>('SELECT id FROM emprestimos WHERE livro_id=? AND leitor_id=? AND data_devolucao IS NULL', [livroId, leitorId]);
      if (jaPossui.length) throw new ErroDominio('Este leitor já possui um empréstimo ativo desse título.');
      await conn.execute('INSERT INTO emprestimos (livro_id, leitor_id, colaborador_id, data_retirada, data_prevista) VALUES (?,?,?,?,?)',
        [livroId, leitorId, colaboradorId, retirada, prevista]);
      if (minhaReserva.length) {
        await conn.execute("UPDATE reservas SET status='concluida' WHERE id=?", [minhaReserva[0].id]);
        await conn.execute('UPDATE notificacoes SET lida=1 WHERE reserva_id=?', [minhaReserva[0].id]);
      }
      // Quem já estava na fila e pegou o livro direto não deve continuar "aguardando".
      await conn.execute("UPDATE reservas SET status='concluida' WHERE livro_id=? AND leitor_id=? AND status='aguardando'", [livroId, leitorId]);
    });
  }

  async devolver(idDado: unknown): Promise<void> {
    const id = V.inteiro(idDado, 'empréstimo');
    const avisos = await Conexao.transacao(async conn => {
      const livroId = await this.travarLivroDe(conn, 'emprestimos', id, 'Empréstimo');
      const [emprestimos] = await conn.query<RowDataPacket[]>('SELECT id, data_devolucao FROM emprestimos WHERE id=? FOR UPDATE', [id]);
      if (!emprestimos.length) throw new ErroDominio('Empréstimo não encontrado.');
      if (emprestimos[0].data_devolucao) throw new ErroDominio('Este empréstimo já foi devolvido.');
      await conn.execute('UPDATE emprestimos SET data_devolucao=CURDATE() WHERE id=?', [id]);
      return this.disponibilizarFila(conn, livroId);
    });
    this.emitirAvisos(avisos);
  }

  /** Update: renovar/ajustar o prazo de um empréstimo em aberto. */
  async renovar(dados: unknown): Promise<void> {
    const d = V.objeto(dados);
    const id = V.inteiro(d.id, 'empréstimo');
    const nova = V.data(d.data_prevista, 'novo prazo');
    await Conexao.transacao(async conn => {
      await this.travarLivroDe(conn, 'emprestimos', id, 'Empréstimo');
      const [linhas] = await conn.query<RowDataPacket[]>('SELECT livro_id, data_retirada, data_prevista, data_devolucao FROM emprestimos WHERE id=? FOR UPDATE', [id]);
      if (!linhas.length) throw new ErroDominio('Empréstimo não encontrado.');
      const em = linhas[0];
      if (em.data_devolucao) throw new ErroDominio('Este empréstimo já foi devolvido.');
      if (nova < String(em.data_retirada)) throw new ErroDominio('O prazo não pode ser anterior à retirada.');
      if (nova > String(em.data_prevista)) {
        const [fila] = await conn.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM reservas WHERE livro_id=? AND status='aguardando'", [em.livro_id]);
        if (Number(fila[0].total)) throw new ErroDominio('Não é possível estender o prazo: há leitores na fila de reserva deste livro.');
      }
      await conn.execute('UPDATE emprestimos SET data_prevista=? WHERE id=?', [nova, id]);
    });
  }

  async excluirEmprestimo(idDado: unknown): Promise<void> {
    const id = V.inteiro(idDado, 'empréstimo');
    const avisos = await Conexao.transacao(async conn => {
      const livroId = await this.travarLivroDe(conn, 'emprestimos', id, 'Empréstimo');
      await conn.execute('DELETE FROM emprestimos WHERE id=?', [id]);
      return this.disponibilizarFila(conn, livroId);
    });
    this.emitirAvisos(avisos);
  }

  // ---------- Reservas ----------
  async reservar(dados: unknown): Promise<void> {
    const d = V.objeto(dados);
    const livroId = V.inteiro(d.livro_id, 'livro');
    const leitorId = V.inteiro(d.leitor_id, 'leitor');
    await Conexao.transacao(async conn => {
      const [livros] = await conn.query<RowDataPacket[]>('SELECT ativo FROM livros WHERE id=? FOR UPDATE', [livroId]);
      if (!livros.length || !livros[0].ativo) throw new ErroDominio('Livro não disponível para reservas.');
      const [leitores] = await conn.query<RowDataPacket[]>('SELECT ativo FROM leitores WHERE id=? FOR UPDATE', [leitorId]);
      if (!leitores.length || !leitores[0].ativo) throw new ErroDominio('Leitor não está ativo.');
      const [existente] = await conn.query<RowDataPacket[]>("SELECT id FROM reservas WHERE livro_id=? AND leitor_id=? AND status IN ('aguardando','disponivel')", [livroId, leitorId]);
      if (existente.length) throw new ErroDominio('Este leitor já está na fila para o livro.');
      const [emprestado] = await conn.query<RowDataPacket[]>('SELECT id FROM emprestimos WHERE livro_id=? AND leitor_id=? AND data_devolucao IS NULL', [livroId, leitorId]);
      if (emprestado.length) throw new ErroDominio('Leitor já está com este título emprestado.');
      const estoque = await this.disponibilidade(conn, livroId);
      const [fila] = await conn.query<RowDataPacket[]>("SELECT id FROM reservas WHERE livro_id=? AND status='aguardando' LIMIT 1", [livroId]);
      if (estoque.total - estoque.ativas - estoque.separadas > 0 && !fila.length) throw new ErroDominio('Há exemplares livres. Faça o empréstimo diretamente.');
      await conn.execute('INSERT INTO reservas (livro_id, leitor_id) VALUES (?,?)', [livroId, leitorId]);
    });
  }

  async cancelarReserva(idDado: unknown): Promise<void> {
    const id = V.inteiro(idDado, 'reserva');
    const avisos = await Conexao.transacao(async conn => {
      const livroId = await this.travarLivroDe(conn, 'reservas', id, 'Reserva');
      const [res] = await conn.query<RowDataPacket[]>('SELECT status FROM reservas WHERE id=? FOR UPDATE', [id]);
      if (!res.length) throw new ErroDominio('Reserva não encontrada.');
      if (!['aguardando', 'disponivel'].includes(res[0].status)) throw new ErroDominio('Reserva já encerrada.');
      await conn.execute("UPDATE reservas SET status='cancelada' WHERE id=?", [id]);
      await conn.execute('UPDATE notificacoes SET lida=1 WHERE reserva_id=?', [id]);
      return res[0].status === 'disponivel' ? this.disponibilizarFila(conn, livroId) : [];
    });
    this.emitirAvisos(avisos);
  }

  /** Update: devolve uma reserva cancelada ao fim da fila. */
  async reativarReserva(idDado: unknown): Promise<void> {
    const id = V.inteiro(idDado, 'reserva');
    const avisos = await Conexao.transacao(async conn => {
      const livroId = await this.travarLivroDe(conn, 'reservas', id, 'Reserva');
      const [res] = await conn.query<RowDataPacket[]>('SELECT leitor_id, status FROM reservas WHERE id=? FOR UPDATE', [id]);
      if (!res.length) throw new ErroDominio('Reserva não encontrada.');
      if (res[0].status !== 'cancelada') throw new ErroDominio('Só é possível reativar reservas canceladas.');
      const leitorId = Number(res[0].leitor_id);
      const [livro] = await conn.query<RowDataPacket[]>('SELECT ativo FROM livros WHERE id=?', [livroId]);
      if (!livro.length || !livro[0].ativo) throw new ErroDominio('Livro arquivado: não aceita reservas.');
      const [leitor] = await conn.query<RowDataPacket[]>('SELECT ativo FROM leitores WHERE id=? FOR UPDATE', [leitorId]);
      if (!leitor.length || !leitor[0].ativo) throw new ErroDominio('Leitor não está ativo.');
      const [outra] = await conn.query<RowDataPacket[]>("SELECT id FROM reservas WHERE livro_id=? AND leitor_id=? AND status IN ('aguardando','disponivel')", [livroId, leitorId]);
      if (outra.length) throw new ErroDominio('Este leitor já está na fila para o livro.');
      const [emprestado] = await conn.query<RowDataPacket[]>('SELECT id FROM emprestimos WHERE livro_id=? AND leitor_id=? AND data_devolucao IS NULL', [livroId, leitorId]);
      if (emprestado.length) throw new ErroDominio('Leitor já está com este título emprestado.');
      await conn.execute("UPDATE reservas SET status='aguardando', criada_em=NOW(), avisada_em=NULL WHERE id=?", [id]);
      return this.disponibilizarFila(conn, livroId);
    });
    this.emitirAvisos(avisos);
  }

  async excluirReserva(idDado: unknown): Promise<void> {
    const id = V.inteiro(idDado, 'reserva');
    const avisos = await Conexao.transacao(async conn => {
      const livroId = await this.travarLivroDe(conn, 'reservas', id, 'Reserva');
      const [res] = await conn.query<RowDataPacket[]>('SELECT status FROM reservas WHERE id=? FOR UPDATE', [id]);
      if (!res.length) throw new ErroDominio('Reserva não encontrada.');
      await conn.execute('DELETE FROM notificacoes WHERE reserva_id=?', [id]);
      await conn.execute('DELETE FROM reservas WHERE id=?', [id]);
      return res[0].status === 'disponivel' ? this.disponibilizarFila(conn, livroId) : [];
    });
    this.emitirAvisos(avisos);
  }

  // ---------- Notificações ----------
  async marcarNotificacao(idDado: unknown): Promise<void> {
    await Conexao.executar('UPDATE notificacoes SET lida=1 WHERE id=?', [V.inteiro(idDado, 'notificação')]);
  }

  async marcarTodasNotificacoes(): Promise<void> {
    await Conexao.executar('UPDATE notificacoes SET lida=1 WHERE lida=0');
  }

  async excluirNotificacao(idDado: unknown): Promise<void> {
    await Conexao.executar('DELETE FROM notificacoes WHERE id=?', [V.inteiro(idDado, 'notificação')]);
  }
}
