import { contextBridge, ipcRenderer } from 'electron';

// O renderer nunca recebe acesso ao Node.js, ao MySQL ou às credenciais:
// só estas duas funções, que repassam mensagens ao processo principal.
contextBridge.exposeInMainWorld('biblioteca', {
  chamar: (acao: string, dados?: unknown): Promise<unknown> => ipcRenderer.invoke('biblioteca:acao', acao, dados),
  aoMenu: (retorno: (acao: string) => void): void => {
    ipcRenderer.on('menu:acao', (_evento, acao: unknown) => { if (typeof acao === 'string') retorno(acao); });
  },
  versao: '1.2.0'
});
