interface ConfigFormulario {
  kicker: string;
  titulo: string;
  corpo: string;
  rotuloSalvar?: string;
  tamanho?: 'md' | 'lg' | 'xl';
  somenteLeitura?: boolean;
  salvar?: (form: HTMLFormElement) => Promise<void>;
  aoAbrir?: (form: HTMLFormElement) => void;
  aoFechar?: () => void;
}

interface OpcoesConfirmacao { titulo: string; mensagem: string; rotulo?: string; perigo?: boolean; icone?: string; }

/** Janelas (modais Bootstrap) e avisos. Textos de confirmação entram via textContent (sem HTML). */
class Ui {
  private static config: ConfigFormulario | null = null;
  private static modalForm: BsModal;
  private static modalConfirmar: BsModal;
  private static resolverConfirmacao: ((v: boolean) => void) | null = null;
  private static temporizadorToast: number | undefined;

  static iniciar(): void {
    const elForm = document.querySelector<HTMLElement>('#form-modal')!;
    const elConf = document.querySelector<HTMLElement>('#confirm-modal')!;
    Ui.modalForm = bootstrap.Modal.getOrCreateInstance(elForm);
    Ui.modalConfirmar = bootstrap.Modal.getOrCreateInstance(elConf);
    // O Bootstrap ignora hide() durante a animação de abertura: guardamos o pedido e fechamos quando terminar.
    for (const el of [elForm, elConf]) {
      el.addEventListener('shown.bs.modal', () => {
        el.dataset.pronto = '1';
        if (el.dataset.fecharAoMostrar === '1') { delete el.dataset.fecharAoMostrar; bootstrap.Modal.getOrCreateInstance(el).hide(); }
      });
      el.addEventListener('hidden.bs.modal', () => { el.dataset.pronto = '0'; });
    }

    elForm.addEventListener('shown.bs.modal', () => {
      elForm.querySelector<HTMLElement>('#modal-fields input:not([type=hidden]):not([type=checkbox]), #modal-fields select, #modal-fields textarea')?.focus();
    });
    elForm.addEventListener('hidden.bs.modal', () => {
      const fechar = Ui.config?.aoFechar;
      Ui.config = null;
      document.querySelector('#modal-fields')!.innerHTML = '';
      fechar?.();
    });
    document.querySelector<HTMLFormElement>('#modal-form')!.addEventListener('submit', e => { e.preventDefault(); void Ui.enviar(); });

    document.querySelector('#confirm-ok')!.addEventListener('click', () => Ui.encerrarConfirmacao(true));
    elConf.addEventListener('hidden.bs.modal', () => Ui.encerrarConfirmacao(false));
  }

  static abrirFormulario(cfg: ConfigFormulario): void {
    Ui.config = cfg;
    document.querySelector('#modal-kicker')!.textContent = cfg.kicker;
    document.querySelector('#form-modal-title')!.textContent = cfg.titulo;
    document.querySelector('#modal-fields')!.innerHTML = cfg.corpo;
    document.querySelector('#form-modal-dialog')!.className = `modal-dialog modal-dialog-centered modal-dialog-scrollable${cfg.tamanho === 'xl' ? ' modal-xl' : cfg.tamanho === 'lg' ? ' modal-lg' : ''}`;
    const salvar = document.querySelector<HTMLButtonElement>('#save-modal')!;
    salvar.classList.toggle('d-none', !!cfg.somenteLeitura);
    salvar.innerHTML = `${Util.esc(cfg.rotuloSalvar ?? 'Salvar')} <i class="bi bi-check2 ms-1"></i>`;
    document.querySelector('#cancel-modal')!.textContent = cfg.somenteLeitura ? 'Fechar' : 'Cancelar';
    cfg.aoAbrir?.(document.querySelector<HTMLFormElement>('#modal-form')!);
    Util.aplicarLarguras(document.querySelector('#modal-fields')!);
    delete document.querySelector<HTMLElement>('#form-modal')!.dataset.fecharAoMostrar;
    Ui.modalForm.show();
  }

  static fecharFormulario(): void { Ui.esconder(Ui.modalForm, '#form-modal'); }

  private static esconder(modal: BsModal, seletor: string): void {
    const el = document.querySelector<HTMLElement>(seletor)!;
    if (el.dataset.pronto === '1') modal.hide(); else el.dataset.fecharAoMostrar = '1';
  }

  static formularioAberto(): boolean { return Ui.config !== null; }

  private static async enviar(): Promise<void> {
    const cfg = Ui.config;
    if (!cfg?.salvar) return;
    const form = document.querySelector<HTMLFormElement>('#modal-form')!;
    if (!form.reportValidity()) return;
    const botao = document.querySelector<HTMLButtonElement>('#save-modal')!;
    botao.disabled = true;
    try {
      await cfg.salvar(form);
      Ui.fecharFormulario();
    } catch (erro) {
      Ui.toast((erro as Error).message, true);
    } finally {
      botao.disabled = false;
    }
  }

  static confirmar(opcoes: OpcoesConfirmacao): Promise<boolean> {
    Ui.encerrarConfirmacao(false);
    document.querySelector('#confirm-title')!.textContent = opcoes.titulo;
    document.querySelector('#confirm-text')!.textContent = opcoes.mensagem;
    const perigo = opcoes.perigo !== false;
    const icone = document.querySelector<HTMLElement>('#confirm-icon')!;
    icone.className = `confirm-icon ${perigo ? 'danger' : 'info'}`;
    icone.innerHTML = `<i class="bi bi-${Util.esc(opcoes.icone ?? (perigo ? 'exclamation-triangle' : 'question-circle'))}"></i>`;
    const ok = document.querySelector<HTMLButtonElement>('#confirm-ok')!;
    ok.className = `btn ${perigo ? 'btn-danger' : 'btn-primary app-primary'}`;
    ok.textContent = opcoes.rotulo ?? 'Confirmar';
    return new Promise<boolean>(resolver => { Ui.resolverConfirmacao = resolver; delete document.querySelector<HTMLElement>('#confirm-modal')!.dataset.fecharAoMostrar; Ui.modalConfirmar.show(); });
  }

  private static encerrarConfirmacao(resultado: boolean): void {
    const resolver = Ui.resolverConfirmacao;
    if (!resolver) return;
    Ui.resolverConfirmacao = null;
    resolver(resultado);
    if (resultado) Ui.esconder(Ui.modalConfirmar, '#confirm-modal');
  }

  static toast(mensagem: string, erro = false): void {
    const el = document.querySelector<HTMLElement>('#toast')!;
    el.innerHTML = `<i class="bi bi-${erro ? 'exclamation-octagon' : 'check-circle'}"></i><span></span>`;
    el.querySelector('span')!.textContent = mensagem;
    el.classList.toggle('error', erro);
    el.classList.add('show');
    if (Ui.temporizadorToast) clearTimeout(Ui.temporizadorToast);
    Ui.temporizadorToast = window.setTimeout(() => el.classList.remove('show'), erro ? 6000 : 4000);
  }
}
