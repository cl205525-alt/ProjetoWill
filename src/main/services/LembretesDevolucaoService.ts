import type { RegistroLembretesDevolucao, ResultadoEnvioLembrete, TentativaLembrete } from '../repositorios/LembretesDevolucaoRepositorio';
import { enderecoEmailUnico, type EnviadorEmailLembrete } from './EmailResendService';

/** Usa o dia civil na máquina da biblioteca, não as próximas 24 horas nem o fuso do MySQL. */
export function prazoAmanha(agora: Date): string {
  const dia = new Date(agora);
  dia.setDate(dia.getDate() + 1);
  return `${dia.getFullYear()}-${String(dia.getMonth() + 1).padStart(2, '0')}-${String(dia.getDate()).padStart(2, '0')}`;
}

export class LembretesDevolucaoService {
  private emExecucao = false;

  constructor(
    private readonly registro: RegistroLembretesDevolucao,
    private readonly email: EnviadorEmailLembrete | null,
    private readonly aoAtualizar: () => void,
    private readonly agora: () => Date = () => new Date()
  ) {}

  async verificar(): Promise<void> {
    if (this.emExecucao) return;
    this.emExecucao = true;
    let mudou = false;
    try {
      const prazo = prazoAmanha(this.agora());
      for (const emprestimoId of await this.registro.candidatos(prazo)) {
        if (prazo !== prazoAmanha(this.agora())) break;
        const tentativa = await this.registro.reservarTentativa(emprestimoId, prazo);
        if (!tentativa) continue;
        if (prazo !== prazoAmanha(this.agora())) break;
        const resultado = await this.enviar(tentativa);
        if (await this.registro.registrarResultado(tentativa.id, resultado)) mudou = true;
      }
    } finally {
      this.emExecucao = false;
      if (mudou) this.aoAtualizar();
    }
  }

  private async enviar(tentativa: TentativaLembrete): Promise<ResultadoEnvioLembrete> {
    const destinatario = enderecoEmailUnico(tentativa.email);
    if (!destinatario) return { status: 'sem_email' };
    if (!this.email) return { status: 'falha' };
    const prazo = tentativa.prazo.split('-').reverse().join('/');
    try {
      const referencia = await this.email.enviar({
        destinatario,
        chaveEnvio: tentativa.chaveEnvio,
        texto: `Olá!\n\nO prazo para devolver "${tentativa.livro}" à biblioteca vence em ${prazo}.\n\nSe precisar de ajuda, entre em contato com a biblioteca.\n\nLumi — Biblioteca Comunitária`
      });
      return { status: 'enviado', referencia };
    } catch {
      // O erro HTTP pode conter destinatário e chave. Não é armazenado nem exibido.
      return { status: 'falha' };
    }
  }
}
