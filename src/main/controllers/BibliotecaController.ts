import { BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron';
import { AutenticacaoService, UsuarioSessao } from '../services/AutenticacaoService';
import { CadastroService } from '../services/CadastroService';
import { CirculacaoService } from '../services/CirculacaoService';
import { IntegracoesService } from '../services/IntegracoesService';
import { ArquivosService } from '../services/ArquivosService';
import { ErroDominio } from '../validacao';

export const CANAL_IPC = 'biblioteca:acao';

interface ContextoRota { pessoa: UsuarioSessao | null; janela: BrowserWindow | null; }
type Executor = (dados: unknown, ctx: ContextoRota) => unknown | Promise<unknown>;
type Acesso = 'publica' | 'logado' | 'admin';
interface Rota { acesso: Acesso; executar: Executor; }

/**
 * Controller (o "C" do MVC): recebe as ações do renderer, confere permissões numa
 * tabela única e delega aos serviços (Model). O renderer (View) nunca fala com o banco.
 */
export class BibliotecaController {
  private readonly rotas = new Map<string, Rota>();

  constructor(
    private readonly auth: AutenticacaoService,
    private readonly cadastros: CadastroService,
    private readonly circulacao: CirculacaoService,
    private readonly apis: IntegracoesService,
    private readonly arquivos: ArquivosService,
    private readonly obterJanela: () => BrowserWindow | null
  ) {
    this.definirRotas();
  }

  private rota(acao: string, acesso: Acesso, executar: Executor): void { this.rotas.set(acao, { acesso, executar }); }

  private definirRotas(): void {
    const a = this.auth, c = this.cadastros, ci = this.circulacao, api = this.apis, f = this.arquivos;
    // Autenticação
    this.rota('auth:status', 'publica', () => a.estado());
    this.rota('auth:setup', 'publica', d => a.configurar(d));
    this.rota('auth:login', 'publica', d => a.entrar(d));
    this.rota('auth:logout', 'publica', () => { a.sair(); return null; });
    this.rota('auth:password', 'logado', d => a.alterarSenha(d));
    // Equipe (apenas administradores)
    this.rota('staff:list', 'admin', () => a.listarEquipe());
    this.rota('staff:create', 'admin', d => a.criarColaborador(d));
    this.rota('staff:update', 'admin', d => a.atualizarColaborador(d));
    this.rota('staff:delete', 'admin', d => a.excluirColaborador(d));
    // Painel
    this.rota('dashboard:stats', 'logado', () => ci.painel());
    this.rota('dashboard:charts', 'logado', () => ci.graficos());
    // Livros
    this.rota('books:list', 'logado', () => c.livros());
    this.rota('books:save', 'logado', d => c.salvarLivro(d));
    this.rota('books:archive', 'admin', d => c.arquivarLivro(d));
    this.rota('books:restore', 'admin', d => c.restaurarLivro(d));
    this.rota('books:delete', 'admin', d => c.excluirLivro(d));
    // Autores
    this.rota('authors:list', 'logado', () => c.autores());
    this.rota('authors:save', 'logado', d => c.salvarAutor(d));
    this.rota('authors:delete', 'admin', d => c.excluirAutor(d));
    // Editoras
    this.rota('publishers:list', 'logado', () => c.editoras());
    this.rota('publishers:save', 'logado', d => c.salvarEditora(d));
    this.rota('publishers:delete', 'admin', d => c.excluirEditora(d));
    // Leitores
    this.rota('readers:list', 'logado', () => c.leitores());
    this.rota('readers:save', 'logado', d => c.salvarLeitor(d));
    this.rota('readers:disable', 'admin', d => c.desativarLeitor(d));
    this.rota('readers:enable', 'admin', d => c.reativarLeitor(d));
    this.rota('readers:delete', 'admin', d => c.excluirLeitor(d));
    // Empréstimos
    this.rota('loans:list', 'logado', () => ci.emprestimos());
    this.rota('loans:borrow', 'logado', (d, ctx) => ci.emprestar(d, ctx.pessoa!.id));
    this.rota('loans:return', 'logado', d => ci.devolver(d));
    this.rota('loans:renew', 'logado', d => ci.renovar(d));
    this.rota('loans:delete', 'admin', d => ci.excluirEmprestimo(d));
    // Reservas
    this.rota('reservations:list', 'logado', () => ci.reservas());
    this.rota('reservations:create', 'logado', d => ci.reservar(d));
    this.rota('reservations:cancel', 'logado', d => ci.cancelarReserva(d));
    this.rota('reservations:reactivate', 'logado', d => ci.reativarReserva(d));
    this.rota('reservations:delete', 'admin', d => ci.excluirReserva(d));
    // Notificações
    this.rota('notifications:list', 'logado', () => ci.notificacoes());
    this.rota('notifications:read', 'logado', d => ci.marcarNotificacao(d));
    this.rota('notifications:readall', 'logado', () => ci.marcarTodasNotificacoes());
    this.rota('notifications:delete', 'logado', d => ci.excluirNotificacao(d));
    // APIs externas
    this.rota('apis:google', 'logado', d => api.googleBooks(d));
    this.rota('apis:isbn', 'logado', d => api.openLibrary(d));
    this.rota('apis:cover', 'logado', d => api.obterCapa(d));
    this.rota('apis:cep', 'logado', d => api.viaCep(d));
    this.rota('apis:holidays', 'logado', d => api.calcularPrazo(d));
    // Arquivos
    this.rota('files:report', 'logado', (d, ctx) => f.exportarRelatorio(ctx.janela, d));
    this.rota('files:backup-export', 'admin', (_d, ctx) => f.exportarBackup(ctx.janela));
    this.rota('files:backup-import', 'admin', (_d, ctx) => f.importarBackup(ctx.janela));
  }

  registrar(): void {
    ipcMain.handle(CANAL_IPC, (evento, acao: unknown, dados: unknown) => this.tratar(evento, acao, dados));
  }

  /** Só aceita chamadas vindas da nossa própria página (checklist de segurança do Electron). */
  private origemConfiavel(evento: IpcMainInvokeEvent): boolean {
    const url = evento.senderFrame?.url ?? '';
    return url.startsWith('file://') && /\/renderer\/index\.html$/.test(url.split(/[?#]/)[0]);
  }

  async tratar(evento: IpcMainInvokeEvent | null, acao: unknown, dados: unknown): Promise<{ ok: boolean; data?: unknown; error?: string; codigo?: string }> {
    try {
      if (evento && !this.origemConfiavel(evento)) throw new ErroDominio('Origem não autorizada.');
      if (typeof acao !== 'string') throw new ErroDominio('Operação inválida.');
      const rota = this.rotas.get(acao);
      if (!rota) throw new ErroDominio('Operação não permitida.');
      const pessoa = rota.acesso === 'publica' ? null : this.auth.exigir(rota.acesso === 'admin' ? 'admin' : undefined);
      const resultado = await rota.executar(dados, { pessoa, janela: this.obterJanela() });
      return { ok: true, data: resultado ?? null };
    } catch (erro) {
      return this.responderErro(erro, acao);
    }
  }

  /** Traduz erros técnicos em mensagens seguras: nunca expõe stack, SQL ou credenciais ao renderer. */
  private responderErro(erro: unknown, acao: unknown): { ok: false; error: string; codigo?: string } {
    const e = erro as Error & { code?: string; response?: { status?: number } };
    let mensagem = 'Não foi possível concluir a operação. Confira os dados e a conexão com o MySQL.';
    if (erro instanceof ErroDominio) return { ok: false, error: erro.message, codigo: erro.codigo };
    if (e.code === 'ER_DUP_ENTRY') mensagem = 'Já existe um cadastro com esse nome, usuário ou ISBN.';
    else if (e.code === 'ER_NO_REFERENCED_ROW_2') mensagem = 'Autor, editora, leitor ou livro não encontrado.';
    else if (e.code === 'ER_ROW_IS_REFERENCED_2') mensagem = 'Este registro está ligado a outros dados e não pode ser excluído.';
    else if (e.code === 'ER_CHECK_CONSTRAINT_VIOLATED') mensagem = 'Algum valor informado viola uma regra do banco (confira datas e quantidades).';
    else if (e.code === 'ER_NO_SUCH_TABLE') mensagem = 'As tabelas ainda não existem. Execute "npm run db:setup".';
    else if (e.code === 'ER_ACCESS_DENIED_ERROR') mensagem = 'O MySQL recusou o usuário ou a senha. Confira o arquivo .env.';
    else if (e.code === 'ER_BAD_DB_ERROR') mensagem = 'O banco de dados informado no .env não existe.';
    else if (e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT') mensagem = 'Não foi possível conectar ao MySQL. Verifique o serviço e o arquivo .env.';
    else if (e.name === 'AxiosError' && e.response?.status === 404) mensagem = 'Nenhum registro encontrado na API externa para esta consulta.';
    else if (e.name === 'AxiosError' && e.response?.status === 429) mensagem = 'A API externa limitou as consultas por agora. Aguarde um pouco e tente de novo.';
    else if (e.name === 'AxiosError') mensagem = 'A API externa não respondeu. Confira a internet e tente novamente.';
    console.error('[Biblioteca] Falha de operação:', acao, e.code || e.name);
    return { ok: false, error: mensagem };
  }
}
