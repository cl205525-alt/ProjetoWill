# LUMI — Biblioteca Comunitária

Aplicativo desktop de gestão de livros, autores, editoras, leitores, empréstimos, reservas e avisos.
**Electron + TypeScript + HTML/CSS/Bootstrap + MySQL + Axios.** Toda a lógica está em `.ts`; os `.js` em `dist/` são gerados pelo `tsc`.

## Como executar (Windows)

1. `npm install`
2. Copie `.env.example` para `.env` e preencha com os dados da sua conexão do Workbench (`DB_NAME=cl205299`). Se já tem um `.env` funcionando, mantenha-o.
3. Um comando por vez:

```powershell
npm install
npm run check
npm run db:setup
npm start
```

`db:setup` só executa `CREATE TABLE IF NOT EXISTS` no banco existente (sem `DROP`, `CREATE DATABASE` ou `USE`); suas tabelas antigas não são tocadas. O schema não mudou em relação à versão anterior, então não precisa recriar nada.
No primeiro acesso, a tela pede o administrador (senha de 10+ caracteres).

## Requisitos do projeto final de DAD

| Requisito | Onde está |
| --- | --- |
| ≥ 6 tabelas relacionadas | 9 tabelas com chaves estrangeiras (`database/schema.sql`) |
| CRUD completo de **todas** as entidades | Livros, autores, editoras, leitores, empréstimos, reservas, notificações e equipe: criar, listar, editar e excluir/encerrar (tabela abaixo) |
| 4 situações de uso de API | Google Books, Open Library, ViaCEP, BrasilAPI (Axios, só no processo principal) |
| Segurança justificada | `docs/SEGURANCA.md` |
| Código em classes (POO/MVC) | Model: `services/*`; Controller: `controllers/BibliotecaController.ts`; View: classes `Pagina*` no renderer |
| Só TypeScript, HTML, CSS | Sem `.js` escritos à mão; Bootstrap como biblioteca |

### Conteúdo das aulas aplicado

- **Menu nativo** (Arquivo/Exibir/Ajuda), **diálogos** (`showSaveDialog`, `showOpenDialog`, `showMessageBox`) e **módulo `fs`**: relatórios `.txt`/`.csv` e backup/restauração `.json` (menu *Arquivo* ou página *Relatórios e backup*).
- **Notificação nativa** do sistema quando um livro reservado fica disponível.
- **Modal de confirmação Bootstrap** antes de qualquer exclusão; formulários em modais Bootstrap.
- **CSP e escape de HTML** contra XSS; **IPC** com `contextBridge`; **Axios** para APIs; **async/await** e transações.
- Tema claro/escuro, gráficos em SVG puro, paginação, busca e filtros.

## CRUD por entidade

| Entidade | Criar | Ler | Editar | Excluir / encerrar |
| --- | --- | --- | --- | --- |
| Livros | cadastro (com ISBN/capa automáticos) | grade ou lista, detalhes | sim | arquivar/restaurar; excluir (admin, sem histórico) |
| Autores / Editoras | sim | lista com nº de livros | sim | admin (autor ligado a livro é protegido) |
| Leitores | sim (CEP via ViaCEP) | lista + histórico | sim | desativar/reativar; excluir (admin, sem histórico) |
| Empréstimos | sim (prazo em dias úteis via BrasilAPI) | filtros e atrasos | renovar / ajustar prazo | devolver; excluir (admin) |
| Reservas | sim (fila) | posição na fila | reativar cancelada | cancelar; excluir (admin) |
| Notificações | automática | pendentes/todas | marcar lida / todas | excluir |
| Equipe (admin) | sim | lista | nome, perfil, ativo, senha | excluir (protegido) |

## O que foi corrigido em relação à versão anterior

- Capas da Open Library redirecionam para o Internet Archive; o domínio era recusado e a capa nunca aparecia. Agora o redirecionamento é aceito (revalidado) na CSP e no download pelo Axios.
- Faltavam as operações de exclusão/edição de várias entidades, reativação de livros/leitores/reservas e renovação de prazo.
- Leitor que já estava na fila e pegava o livro direto continuava "aguardando"; agora a reserva é concluída.
- Senha: o limite de 72 era em caracteres, mas o bcrypt trunca em **bytes**; usuário inexistente respondia mais rápido (revelava usuários); não havia expiração de sessão nem proteção do último administrador.
- Menu nativo estava removido, impedindo DevTools em desenvolvimento; agora há menu (DevTools só fora do pacote).
- Pesquisa na lista recriava a página a cada tecla (perdia o foco); agora só a tabela é atualizada.
- Se a BrasilAPI estiver fora do ar, o prazo é calculado só com fins de semana e o usuário é avisado.

## Estrutura

```text
Biblioteca-Lumi/
├── .env.example  .gitignore  package.json  tsconfig.main.json  tsconfig.renderer.json
├── database/schema.sql
├── docs/SEGURANCA.md
└── src/
    ├── main/
    │   ├── main.ts  preload.ts  conexao.ts  validacao.ts  configurarBanco.ts  copiarArquivos.ts
    │   ├── controllers/BibliotecaController.ts
    │   └── services/ AutenticacaoService  CadastroService  CirculacaoService  IntegracoesService  ArquivosService
    └── renderer/
        ├── index.html  css/style.css
        └── ts/ Aplicacao  PaginaBase  Pagina*  Ui  Api  Html  Graficos  Estado  Util  tipos
```

Não apague `dist/` com o app aberto; ela é recriada em `npm start`.

## Se algo falhar

- `Access denied` / `Unknown database`: confira host, usuário, senha e `DB_NAME` iguais aos do Workbench.
- `Table ... doesn't exist`: rode `npm run db:setup`.
- `ISBN não encontrado`: tente *Buscar pelo título* ou preencha manualmente.
- API externa limitada (429): aguarde ou informe `GOOGLE_BOOKS_API_KEY` no `.env`.
