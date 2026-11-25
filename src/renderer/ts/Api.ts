class ErroApi extends Error {
  constructor(mensagem: string, readonly codigo?: string) { super(mensagem); this.name = 'ErroApi'; }
}

class Api {

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
