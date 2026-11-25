import { app, BrowserWindow, dialog } from 'electron';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RowDataPacket } from 'mysql2/promise';
import { Conexao } from '../conexao';
import { ErroDominio, Validacao as V } from '../validacao';
import { CadastroService } from './CadastroService';
import { CirculacaoService } from './CirculacaoService';

export type TipoRelatorio = 'acervo' | 'emprestimos' | 'atrasados' | 'leitores';
const TIPOS: readonly TipoRelatorio[] = ['acervo', 'emprestimos', 'atrasados', 'leitores'];

interface Tabela { titulo: string; cabecalhos: string[]; linhas: string[][]; }
export interface ResultadoArquivo { salvo: boolean; caminho?: string; registros?: number; detalhes?: Record<string, number>; }

type TipoColuna = 'int' | 'texto' | 'enum';
interface EsquemaTabela { nome: string; colunas: Record<string, TipoColuna>; enum?: Record<string, readonly string[]>; chavesComposta?: boolean; }

const ESQUEMA_BACKUP: EsquemaTabela[] = [
  { nome: 'editoras', colunas: { id: 'int', nome: 'texto', cidade: 'texto' } },
  { nome: 'autores', colunas: { id: 'int', nome: 'texto', nacionalidade: 'texto' } },
  { nome: 'leitores', colunas: { id: 'int', nome: 'texto', email: 'texto', telefone: 'texto', cidade: 'texto', uf: 'texto', ativo: 'int', cadastrado_em: 'texto' } },
  { nome: 'livros', colunas: { id: 'int', titulo: 'texto', isbn: 'texto', ano_publicacao: 'int', genero: 'texto', capa_url: 'texto', editora_id: 'int', quantidade: 'int', ativo: 'int', criado_em: 'texto' } },
  { nome: 'livro_autores', colunas: { livro_id: 'int', autor_id: 'int' }, chavesComposta: true },
  { nome: 'reservas', colunas: { id: 'int', livro_id: 'int', leitor_id: 'int', status: 'enum', criada_em: 'texto', avisada_em: 'texto' }, enum: { status: ['aguardando', 'disponivel', 'concluida', 'cancelada'] } },
  { nome: 'emprestimos', colunas: { id: 'int', livro_id: 'int', leitor_id: 'int', colaborador_id: 'int', data_retirada: 'texto', data_prevista: 'texto', data_devolucao: 'texto', criado_em: 'texto' } },
  { nome: 'notificacoes', colunas: { id: 'int', reserva_id: 'int', leitor_id: 'int', mensagem: 'texto', lida: 'int', criada_em: 'texto' } }
];

export class ArquivosService {
  constructor(private readonly cadastros: CadastroService, private readonly circulacao: CirculacaoService) {}

  async exportarRelatorio(janela: BrowserWindow | null, dados: unknown): Promise<ResultadoArquivo> {
    const d = V.objeto(dados);
    const tipo = V.opcao(d.tipo, TIPOS, 'relatório');
    const tabela = await this.montarTabela(tipo);
    const hoje = new Date().toISOString().slice(0, 10);
    const escolha = await this.dialogoSalvar(janela, {
      title: 'Salvar relatório', defaultPath: join(app.getPath('documents'), `lumi-${tipo}-${hoje}.txt`),
      filters: [{ name: 'Texto (.txt)', extensions: ['txt'] }, { name: 'Planilha CSV (.csv)', extensions: ['csv'] }]
    });
    if (!escolha) return { salvo: false };
    const csv = escolha.toLowerCase().endsWith('.csv');
    const caminho = csv || escolha.toLowerCase().endsWith('.txt') ? escolha : `${escolha}.txt`;
    await writeFile(caminho, csv ? ArquivosService.paraCsv(tabela) : ArquivosService.paraTexto(tabela), 'utf8');
    return { salvo: true, caminho, registros: tabela.linhas.length };
  }

  private async montarTabela(tipo: TipoRelatorio): Promise<Tabela> {
    const data = (v: unknown): string => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '');
    if (tipo === 'acervo') {
      const livros = await this.cadastros.livros();
      return {
        titulo: 'Relatório do acervo', cabecalhos: ['Título', 'Autores', 'Editora', 'ISBN', 'Gênero', 'Exemplares', 'Emprestados', 'Livres', 'Situação'],
        linhas: livros.map(l => [l.titulo, l.autores || '', l.editora || '', l.isbn || '', l.genero || '', String(l.quantidade), String(l.emprestados),
          String(Number(l.quantidade) - Number(l.emprestados) - Number(l.separados)), l.ativo ? 'Ativo' : 'Arquivado'].map(String))
      };
    }
    if (tipo === 'leitores') {
      const leitores = await this.cadastros.leitores();
      return {
        titulo: 'Relatório de leitores', cabecalhos: ['Nome', 'E-mail', 'Telefone', 'Cidade/UF', 'Com livros', 'Total de empréstimos', 'Situação'],
        linhas: leitores.map(l => [l.nome, l.email || '', l.telefone || '', [l.cidade, l.uf].filter(Boolean).join('/'), String(l.emprestimos_ativos), String(l.emprestimos_total), l.ativo ? 'Ativo' : 'Inativo'].map(String))
      };
    }
    const todos = await this.circulacao.emprestimos();
    const itens = tipo === 'atrasados' ? todos.filter(e => e.situacao === 'atrasado') : todos;
    return {
      titulo: tipo === 'atrasados' ? 'Relatório de empréstimos em atraso' : 'Relatório de empréstimos',
      cabecalhos: ['Livro', 'Leitor', 'Retirada', 'Prazo', 'Devolução', 'Dias de atraso', 'Situação', 'Atendente'],
      linhas: itens.map(e => [e.livro, e.leitor, data(e.data_retirada), data(e.data_prevista), data(e.data_devolucao), String(e.dias_atraso),
        e.situacao === 'devolvido' ? 'Devolvido' : e.situacao === 'atrasado' ? 'Atrasado' : 'Em dia', e.atendente].map(String))
    };
  }

  static paraTexto(t: Tabela): string {
    const largura = t.cabecalhos.map((c, i) => Math.min(42, Math.max(c.length, ...t.linhas.map(l => l[i].length))));
    const celula = (v: string, i: number): string => (v.length > largura[i] ? `${v.slice(0, largura[i] - 1)}…` : v).padEnd(largura[i]);
    const linha = (cols: string[]): string => cols.map(celula).join('  ').trimEnd();
    const separador = largura.map(n => '-'.repeat(n)).join('  ');
    const agora = new Date().toLocaleString('pt-BR');
    return [`LUMI — ${t.titulo}`, `Gerado em ${agora}`, `${t.linhas.length} registro(s)`, '', linha(t.cabecalhos), separador, ...t.linhas.map(linha), ''].join('\r\n');
  }

  static paraCsv(t: Tabela): string {
    const celula = (v: string): string => {
      const seguro = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
      return /[";\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
    };
    return `\uFEFF${[t.cabecalhos, ...t.linhas].map(l => l.map(celula).join(';')).join('\r\n')}\r\n`;
  }

  async exportarBackup(janela: BrowserWindow | null): Promise<ResultadoArquivo> {
    const conteudo: Record<string, unknown[]> = {};
    const detalhes: Record<string, number> = {};
    let total = 0;
    for (const t of ESQUEMA_BACKUP) {
      const linhas = await Conexao.consultar<RowDataPacket>(`SELECT ${Object.keys(t.colunas).join(', ')} FROM ${t.nome}`);
      conteudo[t.nome] = linhas.map(l => ({ ...l }));
      detalhes[t.nome] = linhas.length;
      total += linhas.length;
    }
    const agora = new Date();
    const carimbo = agora.toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const escolha = await this.dialogoSalvar(janela, {
      title: 'Salvar backup', defaultPath: join(app.getPath('documents'), `lumi-backup-${carimbo}.json`),
      filters: [{ name: 'Backup JSON (.json)', extensions: ['json'] }]
    });
    if (!escolha) return { salvo: false };
    const caminho = escolha.toLowerCase().endsWith('.json') ? escolha : `${escolha}.json`;

    const envelope = { aplicativo: 'lumi-biblioteca', versao: 2, geradoEm: agora.toISOString(), tabelas: conteudo };
    await writeFile(caminho, JSON.stringify(envelope, null, 2), 'utf8');
    return { salvo: true, caminho, registros: total, detalhes };
  }

  async importarBackup(janela: BrowserWindow | null): Promise<ResultadoArquivo> {
    const opcoes: Electron.OpenDialogOptions = { title: 'Escolher backup', properties: ['openFile'], filters: [{ name: 'Backup JSON (.json)', extensions: ['json'] }] };
    const escolha = janela ? await dialog.showOpenDialog(janela, opcoes) : await dialog.showOpenDialog(opcoes);
    if (escolha.canceled || !escolha.filePaths[0]) return { salvo: false };
    const caminho = escolha.filePaths[0];
    if ((await stat(caminho)).size > 50 * 1024 * 1024) throw new ErroDominio('Arquivo grande demais para um backup do Lumi (limite de 50 MB).');
    let bruto: unknown;
    try { bruto = JSON.parse(await readFile(caminho, 'utf8')); } catch { throw new ErroDominio('O arquivo não é um JSON válido.'); }
    const tabelas = this.validarBackup(bruto);

    const total = Object.values(tabelas).reduce((n, l) => n + l.length, 0);
    const mensagem: Electron.MessageBoxOptions = {
      type: 'warning', buttons: ['Cancelar', 'Importar'], defaultId: 0, cancelId: 0, title: 'Confirmar importação',
      message: `Importar ${total} registro(s) do backup?`,
      detail: 'Registros com o mesmo ID serão atualizados e os ausentes serão criados. Nada é apagado. Se algum dado for inválido, nada será importado.'
    };
    const resposta = janela ? await dialog.showMessageBox(janela, mensagem) : await dialog.showMessageBox(mensagem);
    if (resposta.response !== 1) return { salvo: false };

    const detalhes: Record<string, number> = {};
    await Conexao.transacao(async conn => {
      for (const t of ESQUEMA_BACKUP) {
        const linhas = tabelas[t.nome] ?? [];
        detalhes[t.nome] = linhas.length;
        const colunas = Object.keys(t.colunas);
        for (const linha of linhas) {
          const valores = colunas.map(c => (c in linha ? linha[c] : null));
          const marcas = colunas.map(() => '?').join(',');
          const atualiza = colunas.filter(c => c !== 'id').map(c => `${c}=VALUES(${c})`).join(', ');
          const sql = t.chavesComposta
            ? `INSERT IGNORE INTO ${t.nome} (${colunas.join(',')}) VALUES (${marcas})`
            : `INSERT INTO ${t.nome} (${colunas.join(',')}) VALUES (${marcas}) ON DUPLICATE KEY UPDATE ${atualiza}`;
          await conn.execute(sql, valores);
        }
      }
    });
    return { salvo: true, caminho, registros: total, detalhes };
  }

  private validarBackup(bruto: unknown): Record<string, Record<string, string | number | null>[]> {
    const raiz = V.objeto(bruto);
    if (raiz.aplicativo !== 'lumi-biblioteca') throw new ErroDominio('Este arquivo não é um backup do Lumi.');
    const origem = V.objeto(raiz.tabelas);
    const saida: Record<string, Record<string, string | number | null>[]> = {};
    for (const t of ESQUEMA_BACKUP) {
      const lista = origem[t.nome] ?? [];
      if (!Array.isArray(lista) || lista.length > 50000) throw new ErroDominio(`Backup inválido: tabela ${t.nome}.`);
      saida[t.nome] = lista.map((item, i) => {
        const l = V.objeto(item);
        const limpo: Record<string, string | number | null> = {};
        for (const [coluna, tipo] of Object.entries(t.colunas)) {
          const v = l[coluna];
          if (v === undefined || v === null) { limpo[coluna] = null; continue; }
          if (tipo === 'int') {
            if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw new ErroDominio(`Backup inválido: ${t.nome}[${i}].${coluna}.`);
            limpo[coluna] = v;
          } else {
            if (typeof v !== 'string' || v.length > 3000) throw new ErroDominio(`Backup inválido: ${t.nome}[${i}].${coluna}.`);
            if (tipo === 'enum' && !t.enum?.[coluna].includes(v)) throw new ErroDominio(`Backup inválido: ${t.nome}[${i}].${coluna}.`);
            limpo[coluna] = coluna === 'capa_url' ? CadastroService.capaSegura(v) : v;
          }
        }
        return limpo;
      });
    }
    return saida;
  }

  private async dialogoSalvar(janela: BrowserWindow | null, opcoes: Electron.SaveDialogOptions): Promise<string | null> {
    const r = janela ? await dialog.showSaveDialog(janela, opcoes) : await dialog.showSaveDialog(opcoes);
    return r.canceled || !r.filePath ? null : r.filePath;
  }
}
