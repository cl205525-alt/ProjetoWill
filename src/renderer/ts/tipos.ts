interface RespostaIpc<T> { ok: boolean; data?: T; error?: string; codigo?: string; }
interface Window {
  biblioteca: {
    chamar(acao: string, dados?: unknown): Promise<RespostaIpc<unknown>>;
    aoMenu(retorno: (acao: string) => void): void;
    aoAtualizarNotificacoes(retorno: () => void): void;
    versao: string;
  };
}

interface BsModal { show(): void; hide(): void; }
declare const bootstrap: { Modal: { getOrCreateInstance(elemento: Element, opcoes?: Record<string, unknown>): BsModal } };

type Registro = Record<string, any>;
type IdPagina = 'dashboard' | 'books' | 'loans' | 'reservations' | 'readers' | 'authors' | 'publishers' | 'explore' | 'notifications' | 'reports' | 'team';
type Tom = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface ResultadoBibliografico {
  titulo: string; autores: string[]; editora: string; ano: number | null;
  isbn: string; genero?: string; fonteAno?: string; capa: string | null; origem: string;
}

interface Notificacao {
  id: number;
  tipo: 'reserva' | 'devolucao';
  lida: boolean | number;
  criada_em: string;
  leitor: string;
  email: string | null;
  telefone: string | null;
  livro: string | null;
  mensagem: string;
  status_envio: 'pendente' | 'enviado' | 'falha' | 'sem_email' | null;
  data_prevista: string | null;
  envio_epoch: number | string | null;
}
interface ResumoNotificacoes {
  itens: Notificacao[];
  pendentes: number;
}

interface Contexto {
  readonly estado: Estado;
  readonly usuario: Registro;
  readonly ehAdmin: boolean;
  recarregar(): Promise<void>;
  redesenhar(): void;
  irPara(pagina: IdPagina): void;
  pagina(id: IdPagina): PaginaBase;
}
