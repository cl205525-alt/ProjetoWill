class ErroApi extends Error {
  constructor(mensagem: string, readonly codigo?: string) { super(mensagem); this.name = 'ErroApi'; }
}

/** Única porta do renderer para o processo principal (IPC via preload/contextBridge). */
class Api {
  /** Chamado quando o main avisa que a sessão acabou (inatividade ou logout em outra tela). */
  static aoExpirarSessao: (() => void) | null = null;

  static async chamar<T = unknown>(acao: string, dados?: unknown): Promise<T> {
    let resposta: RespostaIpc<T> | undefined;
    try { resposta = await window.biblioteca.chamar(acao, dados) as RespostaIpc<T>; }
    catch { throw new ErroApi('Falha de comunicação com o aplicativo.'); }
    if (!resposta || !resposta.ok) {
      if (resposta?.codigo === 'SESSAO') Api.aoExpirarSessao?.();
      throw new ErroApi(resposta?.error || 'Falha de comunicação com o aplicativo.', resposta?.codigo);
    }
    return resposta.data as T;
  }
}
