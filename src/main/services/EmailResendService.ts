import axios, { type AxiosInstance } from 'axios';

export interface EmailLembrete {
  destinatario: string;
  texto: string;
  chaveEnvio: string;
}

export interface EnviadorEmailLembrete {
  enviar(email: EmailLembrete): Promise<string>;
}

export function enderecoEmailUnico(valor: string | null | undefined): string | null {
  const email = valor?.trim();
  return email && email.length <= 180
    && /^[^\s@,<>\u0000-\u001f\u007f";:()\\]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(email)
    ? email : null;
}

export class EmailResendService implements EnviadorEmailLembrete {
  constructor(
    private readonly chave: string,
    private readonly remetente: string,
    private readonly cliente: AxiosInstance = axios.create({
      timeout: 8_000, maxRedirects: 0, maxContentLength: 16 * 1024
    })
  ) {}

  static configurar(env: NodeJS.ProcessEnv): EmailResendService | null {
    const chave = env.RESEND_API_KEY?.trim();
    const remetente = enderecoEmailUnico(env.LEMBRETES_EMAIL_REMETENTE);
    return chave && remetente ? new EmailResendService(chave, remetente) : null;
  }

  async enviar({ destinatario, texto, chaveEnvio }: EmailLembrete): Promise<string> {
    const { data } = await this.cliente.post<unknown>('https://api.resend.com/emails', {
      from: this.remetente, to: [destinatario], subject: 'Lumi · Lembrete de devolução', text: texto
    }, {
      headers: { Authorization: `Bearer ${this.chave}`, 'Idempotency-Key': `lumi-devolucao/${chaveEnvio}` }
    });
    if (!data || typeof data !== 'object' || !('id' in data) || typeof data.id !== 'string'
        || !/^[\w-]{1,80}$/.test(data.id)) {
      throw new Error('O provedor não confirmou o envio do lembrete.');
    }
    return data.id;
  }
}
