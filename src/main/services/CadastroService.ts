import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { Conexao } from '../conexao';
import { ErroDominio, Validacao as V } from '../validacao';
import { CirculacaoService } from './CirculacaoService';
import { isbn13 } from './PesquisaBibliografica';

const ISBN_DUPLICADO = 'Já existe um livro cadastrado com esse ISBN.';

export class CadastroService {
  static readonly DOMINIOS_CAPA = ['books.google.com', 'books.googleusercontent.com', 'lh3.googleusercontent.com', 'covers.openlibrary.org'];

  constructor(private readonly circulacao: CirculacaoService) {}

  async autores(): Promise<RowDataPacket[]> {
    return Conexao.consultar<RowDataPacket>(`SELECT a.*, (SELECT COUNT(*) FROM livro_autores la WHERE la.autor_id=a.id) AS total_livros
      FROM autores a ORDER BY a.nome`);
  }

  async editoras(): Promise<RowDataPacket[]> {
    return Conexao.consultar<RowDataPacket>(`SELECT e.*, (SELECT COUNT(*) FROM livros l WHERE l.editora_id=e.id) AS total_livros
      FROM editoras e ORDER BY e.nome`);
  }

  async leitores(): Promise<RowDataPacket[]> {
    return Conexao.consultar<RowDataPacket>(`SELECT l.*,
      (SELECT COUNT(*) FROM emprestimos e WHERE e.leitor_id=l.id AND e.data_devolucao IS NULL) AS emprestimos_ativos,
      (SELECT COUNT(*) FROM emprestimos e WHERE e.leitor_id=l.id) AS emprestimos_total,
      (SELECT COUNT(*) FROM reservas r WHERE r.leitor_id=l.id) AS reservas_total
      FROM leitores l ORDER BY l.ativo DESC, l.nome`);
  }

  async livros(): Promise<RowDataPacket[]> {
    return Conexao.consultar<RowDataPacket>(`SELECT l.id, l.titulo, l.isbn, l.ano_publicacao, l.genero, l.capa_url,
      l.editora_id, l.quantidade, l.ativo, l.criado_em, e.nome AS editora,
      (SELECT GROUP_CONCAT(a.nome ORDER BY a.nome SEPARATOR ', ') FROM livro_autores la JOIN autores a ON a.id=la.autor_id WHERE la.livro_id=l.id) AS autores,
      (SELECT GROUP_CONCAT(la.autor_id ORDER BY la.autor_id) FROM livro_autores la WHERE la.livro_id=l.id) AS autor_ids,
      (SELECT COUNT(*) FROM emprestimos em WHERE em.livro_id=l.id AND em.data_devolucao IS NULL) AS emprestados,
      (SELECT COUNT(*) FROM reservas r WHERE r.livro_id=l.id AND r.status='disponivel') AS separados,
      (SELECT COUNT(*) FROM reservas r WHERE r.livro_id=l.id AND r.status='aguardando') AS na_fila,
      (SELECT COUNT(*) FROM emprestimos em WHERE em.livro_id=l.id) AS historico_emprestimos,
      (SELECT COUNT(*) FROM reservas r WHERE r.livro_id=l.id) AS historico_reservas
      FROM livros l LEFT JOIN editoras e ON e.id=l.editora_id ORDER BY l.ativo DESC, l.criado_em DESC, l.id DESC`);
  }

  private async apagar(sql: string, id: number, rotulo: string): Promise<void> {
    const res = await Conexao.executar(sql, [id]);
    if (!res.affectedRows) throw new ErroDominio(`${rotulo} não encontrado(a).`);
  }

  async salvarAutor(dados: unknown): Promise<void> {
    const d = V.objeto(dados);
    const nome = V.texto(d.nome, 'nome do autor', 160);
    const pais = V.texto(d.nacionalidade, 'nacionalidade', 80, false);
    if (d.id) {
      const res = await Conexao.executar('UPDATE autores SET nome=?, nacionalidade=? WHERE id=?', [nome, pais || null, V.inteiro(d.id, 'autor')]);
      if (!res.affectedRows && !(await this.existe('autores', V.inteiro(d.id, 'autor')))) throw new ErroDominio('Autor não encontrado.');
    } else await Conexao.executar('INSERT INTO autores (nome, nacionalidade) VALUES (?,?)', [nome, pais || null]);
  }

  async excluirAutor(idDado: unknown): Promise<void> {
    const id = V.inteiro(idDado, 'autor');
    const [uso] = await Conexao.consultar<RowDataPacket>('SELECT COUNT(*) AS total FROM livro_autores WHERE autor_id=?', [id]);
    if (Number(uso.total)) throw new ErroDominio(`Este autor está ligado a ${uso.total} livro(s). Edite os livros antes de excluí-lo.`);
    await this.apagar('DELETE FROM autores WHERE id=?', id, 'Autor');
  }

  async salvarEditora(dados: unknown): Promise<void> {
    const d = V.objeto(dados);
    const nome = V.texto(d.nome, 'nome da editora', 160);
    const cidade = V.texto(d.cidade, 'cidade', 100, false);
    if (d.id) {
      const id = V.inteiro(d.id, 'editora');
      const res = await Conexao.executar('UPDATE editoras SET nome=?, cidade=? WHERE id=?', [nome, cidade || null, id]);
      if (!res.affectedRows && !(await this.existe('editoras', id))) throw new ErroDominio('Editora não encontrada.');
    } else await Conexao.executar('INSERT INTO editoras (nome, cidade) VALUES (?,?)', [nome, cidade || null]);
  }

  async excluirEditora(idDado: unknown): Promise<void> {

    await this.apagar('DELETE FROM editoras WHERE id=?', V.inteiro(idDado, 'editora'), 'Editora');
  }

  private async existe(tabela: 'autores' | 'editoras' | 'leitores', id: number): Promise<boolean> {
    const linhas = await Conexao.consultar<RowDataPacket>(`SELECT id FROM ${tabela} WHERE id=?`, [id]);
    return linhas.length > 0;
  }

  async salvarLeitor(dados: unknown): Promise<void> {
    const d = V.objeto(dados);
    const nome = V.texto(d.nome, 'nome do leitor', 160);
    const email = V.email(d.email);
    const telefone = V.texto(d.telefone, 'telefone', 24, false);
    if (telefone && !/^[\d\s()+.-]{8,24}$/.test(telefone)) throw new ErroDominio('Telefone inválido.');
    const cidade = V.texto(d.cidade, 'cidade', 100, false);
    const uf = V.texto(d.uf, 'UF', 2, false).toUpperCase();
    if (uf && !/^[A-Z]{2}$/.test(uf)) throw new ErroDominio('UF inválida.');
    const params = [nome, email || null, telefone || null, cidade || null, uf || null];
    if (d.id) {
      const id = V.inteiro(d.id, 'leitor');
      const res = await Conexao.executar('UPDATE leitores SET nome=?, email=?, telefone=?, cidade=?, uf=? WHERE id=?', [...params, id]);
      if (!res.affectedRows && !(await this.existe('leitores', id))) throw new ErroDominio('Leitor não encontrado.');
    } else await Conexao.executar('INSERT INTO leitores (nome, email, telefone, cidade, uf) VALUES (?,?,?,?,?)', params);
  }

  async desativarLeitor(idDado: unknown): Promise<void> {
    const leitorId = V.inteiro(idDado, 'leitor');
    await Conexao.transacao(async conn => {
      const [leitores] = await conn.query<RowDataPacket[]>('SELECT id, ativo FROM leitores WHERE id=? FOR UPDATE', [leitorId]);
      if (!leitores.length) throw new ErroDominio('Leitor não encontrado.');
      if (!leitores[0].ativo) throw new ErroDominio('Leitor já está inativo.');
      const [emp] = await conn.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM emprestimos WHERE leitor_id=? AND data_devolucao IS NULL', [leitorId]);
      if (Number(emp[0].total)) throw new ErroDominio('Não é possível desativar um leitor com empréstimos abertos.');
      const [res] = await conn.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM reservas WHERE leitor_id=? AND status IN ('aguardando','disponivel')", [leitorId]);
      if (Number(res[0].total)) throw new ErroDominio('Cancele as reservas antes de desativar o leitor.');
      await conn.execute('UPDATE leitores SET ativo=0 WHERE id=?', [leitorId]);
    });
  }

  async reativarLeitor(idDado: unknown): Promise<void> {
    await this.apagarOuAtualizar('UPDATE leitores SET ativo=1 WHERE id=?', V.inteiro(idDado, 'leitor'), 'Leitor');
  }

  async excluirLeitor(idDado: unknown): Promise<void> {
    const id = V.inteiro(idDado, 'leitor');
    await Conexao.transacao(async conn => {
      const [leitores] = await conn.query<RowDataPacket[]>('SELECT id FROM leitores WHERE id=? FOR UPDATE', [id]);
      if (!leitores.length) throw new ErroDominio('Leitor não encontrado.');
      const [uso] = await conn.query<RowDataPacket[]>(`SELECT
        (SELECT COUNT(*) FROM emprestimos WHERE leitor_id=?) AS emprestimos,
        (SELECT COUNT(*) FROM reservas WHERE leitor_id=?) AS reservas`, [id, id]);
      if (Number(uso[0].emprestimos) || Number(uso[0].reservas)) {
        throw new ErroDominio('Este leitor possui histórico de empréstimos ou reservas. Desative o cadastro em vez de excluir.');
      }
      await conn.execute('DELETE FROM notificacoes WHERE leitor_id=?', [id]);
      await conn.execute('DELETE FROM leitores WHERE id=?', [id]);
    });
  }

  private async apagarOuAtualizar(sql: string, id: number, rotulo: string): Promise<void> {
    const res = await Conexao.executar(sql, [id]);
    if (!res.affectedRows) throw new ErroDominio(`${rotulo} não encontrado(a).`);
  }

  static capaSegura(dado: unknown): string | null {
    if (!dado) return null;
    const url = V.texto(dado, 'URL da capa', 500, false);
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' || !CadastroService.DOMINIOS_CAPA.includes(u.hostname)) return null;
      return u.toString();
    } catch { return null; }
  }

  async salvarLivro(dados: unknown): Promise<number> {
    const d = V.objeto(dados);
    const titulo = V.texto(d.titulo, 'título', 240);
    const isbn = isbn13(V.isbn(d.isbn));
    if (!isbn && typeof d.isbn === 'string' && d.isbn.trim()) {
      throw new ErroDominio('Informe um ISBN válido de 10 ou 13 dígitos, com o dígito verificador correto.');
    }
    const idEdicao = d.id ? V.inteiro(d.id, 'livro') : null;
    const ano = d.ano_publicacao ? V.inteiro(d.ano_publicacao, 'ano', 1450, new Date().getFullYear() + 2) : null;
    const genero = V.texto(d.genero, 'gênero', 80, false);
    const quantidade = V.inteiro(d.quantidade, 'exemplares', 1, 10000);
    let editora = d.editora_id ? V.inteiro(d.editora_id, 'editora') : null;
    const editoraNome = V.texto(d.editora_nome, 'editora sugerida', 160, false);
    const autores = V.listaIds(d.autor_ids || []);
    const autoresNomes = Array.isArray(d.autores_nomes) ? d.autores_nomes.slice(0, 10).map(nome => V.texto(nome, 'autor sugerido', 160)) : [];
    const capa = CadastroService.capaSegura(d.capa_url);
    const avisos = await Conexao.transacao(async conn => {
      if (idEdicao !== null) {
        const [livros] = await conn.query<RowDataPacket[]>('SELECT id FROM livros WHERE id=? FOR UPDATE', [idEdicao]);
        if (!livros.length) throw new ErroDominio('Livro não encontrado.');
        const [uso] = await conn.query<(RowDataPacket & { emprestados: unknown; reservados: unknown })[]>(`SELECT
          (SELECT COUNT(*) FROM emprestimos WHERE livro_id=? AND data_devolucao IS NULL) AS emprestados,
          (SELECT COUNT(*) FROM reservas WHERE livro_id=? AND status='disponivel') AS reservados`, [idEdicao, idEdicao]);
        if (quantidade < Number(uso[0].emprestados) + Number(uso[0].reservados)) {
          throw new ErroDominio('A quantidade não pode ser menor que os exemplares emprestados e separados para reservas.');
        }
      }
      if (isbn) {

        const [livros] = await conn.execute<(RowDataPacket & { isbn: unknown })[]>(
          'SELECT isbn FROM livros WHERE isbn IS NOT NULL AND NOT (id <=> ?)', [idEdicao]);
        if (livros.some(livro => isbn13(livro.isbn) === isbn)) throw new ErroDominio(ISBN_DUPLICADO);
      }
      if (!editora && editoraNome) {
        const [res] = await conn.execute<ResultSetHeader>('INSERT INTO editoras (nome) VALUES (?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)', [editoraNome]);
        editora = res.insertId;
      }
      for (const nome of autoresNomes) {
        const [res] = await conn.execute<ResultSetHeader>('INSERT INTO autores (nome) VALUES (?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)', [nome]);
        autores.push(res.insertId);
      }
      const todosAutores = [...new Set(autores)];
      const params = [titulo, isbn, ano, genero || null, quantidade, editora, capa];
      let id: number;
      try {
        if (idEdicao !== null) {
          id = idEdicao;
          await conn.execute('UPDATE livros SET titulo=?, isbn=?, ano_publicacao=?, genero=?, quantidade=?, editora_id=?, capa_url=? WHERE id=?',
            [...params, id]);
        } else {
          const [resultado] = await conn.execute<ResultSetHeader>(
            'INSERT INTO livros (titulo, isbn, ano_publicacao, genero, quantidade, editora_id, capa_url) VALUES (?,?,?,?,?,?,?)', params);
          id = resultado.insertId;
        }
      } catch (erro) {

        if (typeof erro === 'object' && erro !== null && 'code' in erro && erro.code === 'ER_DUP_ENTRY') {
          throw new ErroDominio(ISBN_DUPLICADO);
        }
        throw erro;
      }
      if (idEdicao !== null) await conn.execute('DELETE FROM livro_autores WHERE livro_id=?', [id]);
      for (const autorId of todosAutores) await conn.execute('INSERT INTO livro_autores (livro_id, autor_id) VALUES (?,?)', [id, autorId]);
      const promovidos = await this.circulacao.disponibilizarFila(conn, id);
      return { id, promovidos };
    });
    this.circulacao.emitirAvisos(avisos.promovidos);
    return avisos.id;
  }

  async arquivarLivro(idDado: unknown): Promise<void> {
    const id = V.inteiro(idDado, 'livro');
    await Conexao.transacao(async conn => {
      const [livros] = await conn.query<RowDataPacket[]>('SELECT id FROM livros WHERE id=? FOR UPDATE', [id]);
      if (!livros.length) throw new ErroDominio('Livro inexistente.');
      const [ativos] = await conn.query<RowDataPacket[]>(`SELECT
        (SELECT COUNT(*) FROM emprestimos WHERE livro_id=? AND data_devolucao IS NULL) AS emprestimos,
        (SELECT COUNT(*) FROM reservas WHERE livro_id=? AND status IN ('aguardando','disponivel')) AS reservas`, [id, id]);
      if (Number(ativos[0].emprestimos) || Number(ativos[0].reservas)) throw new ErroDominio('Resolva empréstimos e reservas pendentes antes de arquivar.');
      await conn.execute('UPDATE livros SET ativo=0 WHERE id=?', [id]);
    });
  }

  async restaurarLivro(idDado: unknown): Promise<void> {
    await this.apagarOuAtualizar('UPDATE livros SET ativo=1 WHERE id=?', V.inteiro(idDado, 'livro'), 'Livro');
  }

  async excluirLivro(idDado: unknown): Promise<void> {
    const id = V.inteiro(idDado, 'livro');
    await Conexao.transacao(async conn => {
      const [livros] = await conn.query<RowDataPacket[]>('SELECT id FROM livros WHERE id=? FOR UPDATE', [id]);
      if (!livros.length) throw new ErroDominio('Livro inexistente.');
      const [uso] = await conn.query<RowDataPacket[]>(`SELECT
        (SELECT COUNT(*) FROM emprestimos WHERE livro_id=?) AS emprestimos,
        (SELECT COUNT(*) FROM reservas WHERE livro_id=?) AS reservas`, [id, id]);
      if (Number(uso[0].emprestimos) || Number(uso[0].reservas)) {
        throw new ErroDominio('Este livro tem histórico de empréstimos ou reservas. Arquive-o em vez de excluir.');
      }
      await conn.execute('DELETE FROM livros WHERE id=?', [id]);
    });
  }
}
