import bcrypt from 'bcryptjs';
import { RowDataPacket } from 'mysql2/promise';
import { Conexao } from '../conexao';
import { ErroDominio, Validacao as V } from '../validacao';

export type Perfil = 'admin' | 'atendente';
export interface UsuarioSessao { id: number; nome: string; usuario: string; perfil: Perfil; }
interface Colaborador extends RowDataPacket { id: number; nome: string; usuario: string; senha_hash: string; perfil: Perfil; ativo: number; }

const CUSTO_BCRYPT = 12;
const OCIOSIDADE_MAXIMA_MS = 30 * 60 * 1000; // a sessão expira após 30 min sem uso
const PADRAO_USUARIO = /^[a-z0-9._-]{3,60}$/;

/**
 * Autenticação e gestão da equipe.
 * Decisões de segurança: hash bcrypt (custo 12), bloqueio após 5 erros, expiração por
 * inatividade, tempo de resposta igualado quando o usuário não existe e proteção
 * contra remoção do último administrador.
 */
export class AutenticacaoService {
  private sessao: UsuarioSessao | null = null;
  private ultimoAcesso = 0;
  private readonly tentativas = new Map<string, { numero: number; bloqueioAte: number }>();
  private hashFalso: Promise<string> | null = null;

  async estado(): Promise<{ necessitaConfiguracao: boolean; usuario: UsuarioSessao | null }> {
    const [linha] = await Conexao.consultar<RowDataPacket>('SELECT COUNT(*) AS total FROM colaboradores');
    return { necessitaConfiguracao: Number(linha.total) === 0, usuario: this.sessaoValida() ? this.sessao : null };
  }

  private sessaoValida(): boolean {
    if (!this.sessao) return false;
    if (Date.now() - this.ultimoAcesso > OCIOSIDADE_MAXIMA_MS) { this.sessao = null; return false; }
    return true;
  }

  /** Garante login (e, opcionalmente, perfil de administrador). Lança erro se não houver permissão. */
  exigir(perfil?: Perfil, contarAtividade = true): UsuarioSessao {
    if (!this.sessaoValida() || !this.sessao) throw new ErroDominio('Sessão encerrada. Faça login novamente.', 'SESSAO');
    if (perfil && this.sessao.perfil !== perfil) throw new ErroDominio('Apenas administradores podem realizar esta ação.');
    if (contarAtividade) this.ultimoAcesso = Date.now();
    return this.sessao;
  }

  private usuarioValido(dado: unknown): string {
    const usuario = V.texto(dado, 'usuário', 60).toLowerCase();
    if (!PADRAO_USUARIO.test(usuario)) throw new ErroDominio('Usuário: use de 3 a 60 letras minúsculas, números, ponto, hífen ou sublinhado, sem espaços.');
    return usuario;
  }

  async configurar(dados: unknown): Promise<UsuarioSessao> {
    const d = V.objeto(dados);
    const nome = V.texto(d.nome, 'nome', 120);
    const usuario = this.usuarioValido(d.usuario);
    const senha = V.senha(d.senha);
    const hash = await bcrypt.hash(senha, CUSTO_BCRYPT);
    await Conexao.transacao(async conn => {
      const [linhas] = await conn.query<RowDataPacket[]>('SELECT id FROM colaboradores LIMIT 1 FOR UPDATE');
      if (linhas.length) throw new ErroDominio('O administrador inicial já foi configurado.');
      await conn.execute('INSERT INTO colaboradores (nome, usuario, senha_hash, perfil) VALUES (?,?,?,?)', [nome, usuario, hash, 'admin']);
    });
    return this.entrar({ usuario, senha });
  }

  async entrar(dados: unknown): Promise<UsuarioSessao> {
    const d = V.objeto(dados);
    const usuario = V.texto(d.usuario, 'usuário', 60).toLowerCase();
    // A senha não é aparada: espaços podem fazer parte dela.
    const senha = typeof d.senha === 'string' && d.senha.length <= 200 ? d.senha : '';
    const estado = this.tentativas.get(usuario) ?? { numero: 0, bloqueioAte: 0 };
    if (estado.bloqueioAte > Date.now()) {
      throw new ErroDominio(`Muitas tentativas. Aguarde ${Math.ceil((estado.bloqueioAte - Date.now()) / 1000)} segundos.`);
    }
    const [registro] = await Conexao.consultar<Colaborador>('SELECT * FROM colaboradores WHERE usuario=? AND ativo=1 LIMIT 1', [usuario]);
    // Compara sempre com algum hash: evita descobrir usuários existentes pelo tempo de resposta.
    const alvo = registro ? registro.senha_hash : await this.obterHashFalso();
    const correto = (await bcrypt.compare(senha, alvo)) && !!registro;
    if (!correto) {
      const numero = estado.numero + 1;
      if (this.tentativas.size > 500) this.tentativas.clear();
      this.tentativas.set(usuario, numero >= 5 ? { numero: 0, bloqueioAte: Date.now() + 60_000 } : { numero, bloqueioAte: 0 });
      throw new ErroDominio('Usuário ou senha incorretos.');
    }
    this.tentativas.delete(usuario);
    this.sessao = { id: registro.id, nome: registro.nome, usuario: registro.usuario, perfil: registro.perfil };
    this.ultimoAcesso = Date.now();
    return this.sessao;
  }

  private obterHashFalso(): Promise<string> {
    if (!this.hashFalso) this.hashFalso = bcrypt.hash('senha-que-nao-existe', CUSTO_BCRYPT);
    return this.hashFalso;
  }

  sair(): void { this.sessao = null; }

  async alterarSenha(dados: unknown): Promise<void> {
    const eu = this.exigir();
    const d = V.objeto(dados);
    const atual = typeof d.atual === 'string' ? d.atual : '';
    const nova = V.senha(d.nova);
    const [registro] = await Conexao.consultar<Colaborador>('SELECT * FROM colaboradores WHERE id=? LIMIT 1', [eu.id]);
    if (!registro || !(await bcrypt.compare(atual, registro.senha_hash))) throw new ErroDominio('A senha atual está incorreta.');
    if (atual === nova) throw new ErroDominio('A nova senha deve ser diferente da atual.');
    await Conexao.executar('UPDATE colaboradores SET senha_hash=? WHERE id=?', [await bcrypt.hash(nova, CUSTO_BCRYPT), eu.id]);
  }

  async listarEquipe(): Promise<RowDataPacket[]> {
    this.exigir('admin');
    return Conexao.consultar<RowDataPacket>(`SELECT c.id, c.nome, c.usuario, c.perfil, c.ativo, c.criado_em,
      (SELECT COUNT(*) FROM emprestimos e WHERE e.colaborador_id=c.id) AS emprestimos_registrados
      FROM colaboradores c ORDER BY c.ativo DESC, c.nome`);
  }

  async criarColaborador(dados: unknown): Promise<void> {
    this.exigir('admin');
    const d = V.objeto(dados);
    const nome = V.texto(d.nome, 'nome', 120);
    const usuario = this.usuarioValido(d.usuario);
    const hash = await bcrypt.hash(V.senha(d.senha), CUSTO_BCRYPT);
    const perfil = V.opcao(d.perfil, ['admin', 'atendente'] as const, 'perfil');
    await Conexao.executar('INSERT INTO colaboradores (nome, usuario, senha_hash, perfil) VALUES (?,?,?,?)', [nome, usuario, hash, perfil]);
  }

  async atualizarColaborador(dados: unknown): Promise<void> {
    const eu = this.exigir('admin');
    const d = V.objeto(dados);
    const id = V.inteiro(d.id, 'colaborador');
    const nome = V.texto(d.nome, 'nome', 120);
    const perfil = V.opcao(d.perfil, ['admin', 'atendente'] as const, 'perfil');
    const ativo = V.booleano(d.ativo);
    const novaSenha = d.senha ? V.senha(d.senha) : null;
    const hash = novaSenha ? await bcrypt.hash(novaSenha, CUSTO_BCRYPT) : null;
    await Conexao.transacao(async conn => {
      const [linhas] = await conn.query<Colaborador[]>('SELECT * FROM colaboradores WHERE id=? FOR UPDATE', [id]);
      if (!linhas.length) throw new ErroDominio('Colaborador não encontrado.');
      const alvo = linhas[0];
      const perdeAdmin = alvo.perfil === 'admin' && alvo.ativo && (perfil !== 'admin' || !ativo);
      if (id === eu.id && (perfil !== 'admin' || !ativo)) throw new ErroDominio('Você não pode remover o seu próprio acesso de administrador.');
      if (perdeAdmin) await this.garantirOutroAdmin(conn, id);
      if (hash) await conn.execute('UPDATE colaboradores SET nome=?, perfil=?, ativo=?, senha_hash=? WHERE id=?', [nome, perfil, ativo ? 1 : 0, hash, id]);
      else await conn.execute('UPDATE colaboradores SET nome=?, perfil=?, ativo=? WHERE id=?', [nome, perfil, ativo ? 1 : 0, id]);
    });
    if (id === eu.id && this.sessao) this.sessao = { ...this.sessao, nome };
  }

  async excluirColaborador(idDado: unknown): Promise<void> {
    const eu = this.exigir('admin');
    const id = V.inteiro(idDado, 'colaborador');
    if (id === eu.id) throw new ErroDominio('Você não pode excluir a sua própria conta.');
    await Conexao.transacao(async conn => {
      const [linhas] = await conn.query<Colaborador[]>('SELECT * FROM colaboradores WHERE id=? FOR UPDATE', [id]);
      if (!linhas.length) throw new ErroDominio('Colaborador não encontrado.');
      if (linhas[0].perfil === 'admin' && linhas[0].ativo) await this.garantirOutroAdmin(conn, id);
      const [uso] = await conn.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM emprestimos WHERE colaborador_id=?', [id]);
      if (Number(uso[0].total)) throw new ErroDominio('Este colaborador registrou empréstimos. Desative o acesso em vez de excluir.');
      await conn.execute('DELETE FROM colaboradores WHERE id=?', [id]);
    });
  }

  private async garantirOutroAdmin(conn: import('mysql2/promise').PoolConnection, ignorarId: number): Promise<void> {
    const [outros] = await conn.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM colaboradores WHERE perfil='admin' AND ativo=1 AND id<>?", [ignorarId]);
    if (!Number(outros[0].total)) throw new ErroDominio('É preciso manter ao menos um administrador ativo.');
  }
}
