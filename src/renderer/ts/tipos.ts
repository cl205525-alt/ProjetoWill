// Tipos compartilhados do renderer. Os arquivos .ts desta pasta são scripts globais
// (module: None) carregados em ordem pelo index.html; não há `import`.

interface RespostaIpc<T> { ok: boolean; data?: T; error?: string; codigo?: string; }
interface Window {
  biblioteca: {
    chamar(acao: string, dados?: unknown): Promise<RespostaIpc<unknown>>;
    aoMenu(retorno: (acao: string) => void): void;
    versao: string;
  };
}

/** Bootstrap 5 (vendor/bootstrap.bundle.min.js): só o que usamos. */
interface BsModal { show(): void; hide(): void; }
declare const bootstrap: { Modal: { getOrCreateInstance(elemento: Element, opcoes?: Record<string, unknown>): BsModal } };

type Registro = Record<string, any>;
type IdPagina = 'dashboard' | 'books' | 'loans' | 'reservations' | 'readers' | 'authors' | 'publishers' | 'explore' | 'notifications' | 'reports' | 'team';
type Tom = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/** O que cada página enxerga da aplicação. */
interface Contexto {
  readonly estado: Estado;
  readonly usuario: Registro;
  readonly ehAdmin: boolean;
  recarregar(): Promise<void>;
  redesenhar(): void;
  irPara(pagina: IdPagina): void;
  pagina(id: IdPagina): PaginaBase;
}
