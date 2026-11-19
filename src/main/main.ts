import { app, BrowserWindow, dialog, Menu, MenuItemConstructorOptions, Notification, session } from 'electron';
import path from 'node:path';
import { AutenticacaoService } from './services/AutenticacaoService';
import { CadastroService } from './services/CadastroService';
import { CirculacaoService, AvisoFila } from './services/CirculacaoService';
import { IntegracoesService } from './services/IntegracoesService';
import { ArquivosService } from './services/ArquivosService';
import { BibliotecaController } from './controllers/BibliotecaController';

/** Ponto de entrada: janela, menu nativo, notificações do sistema e política de segurança. */
class Aplicacao {
  private janela: BrowserWindow | null = null;
  private readonly circulacao = new CirculacaoService();
  private readonly controller: BibliotecaController;

  constructor() {
    const auth = new AutenticacaoService();
    const cadastros = new CadastroService(this.circulacao);
    const arquivos = new ArquivosService(cadastros, this.circulacao);
    this.controller = new BibliotecaController(auth, cadastros, this.circulacao, new IntegracoesService(), arquivos, () => this.janela);
    this.circulacao.on('reserva-disponivel', (aviso: AvisoFila) => this.notificarSistema(aviso));
  }

  iniciar(): void {
    if (!app.requestSingleInstanceLock()) { app.quit(); return; }
    app.on('second-instance', () => { if (this.janela) { if (this.janela.isMinimized()) this.janela.restore(); this.janela.focus(); } });
    app.setAppUserModelId('br.cotil.lumi'); // necessário para notificações no Windows
    this.endurecerSeguranca();
    this.controller.registrar();
    app.whenReady().then(() => {
      session.defaultSession.setPermissionRequestHandler((_wc, _permissao, resposta) => resposta(false));
      this.criarMenu();
      this.criarJanela();
      app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) this.criarJanela(); });
    });
    app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  }

  private endurecerSeguranca(): void {
    app.on('web-contents-created', (_e, conteudo) => {
      conteudo.setWindowOpenHandler(() => ({ action: 'deny' }));
      conteudo.on('will-navigate', evento => evento.preventDefault());
      conteudo.on('will-attach-webview', evento => evento.preventDefault());
    });
  }

  private criarJanela(): void {
    const janela = new BrowserWindow({
      width: 1490, height: 940, minWidth: 1000, minHeight: 680, backgroundColor: '#0f1830',
      title: 'Lumi — Biblioteca Comunitária', show: false, autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false, contextIsolation: true, sandbox: true,
        webSecurity: true, allowRunningInsecureContent: false
      }
    });
    this.janela = janela;
    void janela.loadFile(path.join(__dirname, '../renderer/index.html'));
    janela.once('ready-to-show', () => janela.show());
    janela.on('closed', () => { if (this.janela === janela) this.janela = null; });
  }

  /** Notificação nativa do sistema operacional quando um livro reservado fica disponível. */
  private notificarSistema(aviso: AvisoFila): void {
    if (!Notification.isSupported()) return;
    new Notification({ title: 'Lumi · Reserva disponível', body: `"${aviso.livro}" está disponível para ${aviso.leitor}. Avise o leitor.` }).show();
  }

  private enviarAoRenderer(acao: string): void {
    this.janela?.webContents.send('menu:acao', acao);
  }

  private criarMenu(): void {
    const dev = !app.isPackaged;
    const modelo: MenuItemConstructorOptions[] = [
      { label: 'Arquivo', submenu: [
        { label: 'Relatório do acervo…', click: () => this.enviarAoRenderer('relatorio:acervo') },
        { label: 'Relatório de empréstimos…', click: () => this.enviarAoRenderer('relatorio:emprestimos') },
        { label: 'Relatório de atrasos…', click: () => this.enviarAoRenderer('relatorio:atrasados') },
        { label: 'Relatório de leitores…', click: () => this.enviarAoRenderer('relatorio:leitores') },
        { type: 'separator' },
        { label: 'Exportar backup (JSON)…', click: () => this.enviarAoRenderer('backup:exportar') },
        { label: 'Importar backup…', click: () => this.enviarAoRenderer('backup:importar') },
        { type: 'separator' },
        { role: 'quit', label: 'Sair' }
      ] },
      { label: 'Exibir', submenu: [
        ...(dev ? [{ role: 'reload' as const, label: 'Recarregar' }, { role: 'toggleDevTools' as const, label: 'Ferramentas do desenvolvedor' }, { type: 'separator' as const }] : []),
        { role: 'resetZoom', label: 'Zoom padrão' }, { role: 'zoomIn', label: 'Aumentar zoom' }, { role: 'zoomOut', label: 'Diminuir zoom' },
        { type: 'separator' }, { role: 'togglefullscreen', label: 'Tela cheia' }
      ] },
      { label: 'Ajuda', submenu: [
        { label: 'Sobre o Lumi', click: () => {
          const opcoes = { type: 'info' as const, title: 'Sobre', message: 'Lumi — Biblioteca Comunitária', detail: `Versão ${app.getVersion()}\nElectron, TypeScript e MySQL.\nProjeto final de DAD · COTIL.`, buttons: ['OK'] };
          if (this.janela) void dialog.showMessageBox(this.janela, opcoes); else void dialog.showMessageBox(opcoes);
        } }
      ] }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(modelo));
  }
}

new Aplicacao().iniciar();
