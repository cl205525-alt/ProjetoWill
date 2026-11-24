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

`db:setup` só executa `CREATE TABLE IF NOT EXISTS` no banco configurado (sem `DROP`, `CREATE DATABASE` ou `USE`). Para atualizar uma instalação existente com os lembretes, o mesmo comando cria a tabela `lembretes_devolucao` sem alterar as anteriores.
No primeiro acesso, a tela pede o administrador (senha de 10+ caracteres).

## Lembretes de devolução por e-mail

O envio fica desligado por padrão. Para ativá-lo em uma instalação:

1. Execute `npm run db:setup` com o `.env` apontando para o banco que deseja atualizar.
2. No [Resend](https://resend.com/docs/dashboard/domains/introduction), verifique um domínio de envio e obtenha uma chave com permissão para enviar e-mails. Adicione ao `.env` (sem compartilhá-lo):

   ```dotenv
   LEMBRETES_EMAIL_ATIVOS=true
   LEMBRETES_EMAIL_REMETENTE=biblioteca@seu-dominio.example
   RESEND_API_KEY=
   ```

3. Preencha a chave e abra o Lumi. Mantenha-o aberto e conectado na véspera. O prazo é verificado pelo dia do calendário e fuso do computador da biblioteca, na abertura e a cada minuto. Se o app não rodar na véspera, não há envio retroativo.

O administrador acompanha o histórico em **Notificações → Lembretes de devolução**. **Enviado** indica que o provedor aceitou a mensagem, não que ela foi entregue ou lida. **Sem e-mail** e **Falha no envio** não contam como enviados. Depois de corrigir contato ou configuração, o app pode tentar de novo na própria véspera; se precisar alterar o `.env`, feche e abra o Lumi.

O Lumi evita repetir um lembrete para o mesmo empréstimo e a mesma data; um prazo renovado é tratado separadamente. Os avisos de reservas continuam manuais. O histórico dos lembretes fica no MySQL e não entra no backup JSON do aplicativo; preserve a tabela `lembretes_devolucao` no backup do banco ao migrar a instalação.

Para validar a lógica sem conectar ao banco ou enviar mensagens reais, use `npm test`.

## Pesquisa bibliográfica no cadastro

- **Por título:** o cadastro e a tela **Descobrir livros** consultam o Google Books e, quando faltam dados ou resultados, a Open Library. Confira ISBN, editora e ano antes de escolher. Resultados sem edição identificada são sinalizados; o ano e a capa de outras edições não são reaproveitados.
- **Por ISBN:** o Lumi valida o dígito verificador, reconhece ISBN-10 e ISBN-13 equivalentes e consulta Open Library e Google Books. Se necessário, usa a BrasilAPI para buscar na Câmara Brasileira do Livro (CBL) e no Mercado Editorial. Só combina dados de fontes que confirmem o mesmo ISBN.
- As sugestões preenchem apenas campos vazios que não foram editados no formulário. A origem é exibida, e você pode completar os dados manualmente antes de salvar. As consultas são feitas no aplicativo; não exigem o OpenCode aberto.

## Requisitos do projeto final de DAD

| Requisito | Onde está |
| --- | --- |
| ≥ 6 tabelas relacionadas | 10 tabelas relacionadas (`database/schema.sql`) |
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
| Notificações | automática | não lidas/todas; histórico de e-mail (admin) | marcar lida / todas | excluir avisos de reserva |
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

## Equipe de agentes no OpenCode

Abra este projeto no OpenCode. `arquiteto` é o agente padrão nas novas sessões; em uma sessão já aberta, selecione-o no seletor de agentes. Ele coordena os [sete especialistas do projeto](.opencode/agents/), incluindo `pesquisa-bibliografica` para verificar dados de livros ausentes nas APIs e `organizacao-imagens` para padronizar molduras de capa sem cortar a imagem. Esses perfis atuam no OpenCode; não executam automaticamente no aplicativo.

Para começar, peça: “Proponha a primeira etapa para revisar o fluxo de empréstimos.” O arquiteto apresenta uma etapa curta com escopo e critérios de aceite e aguarda sua aprovação antes de delegar. Responda, por exemplo, `Aprovo a etapa E1`, usando o ID apresentado. A aprovação vale só para aquela etapa.

## Se algo falhar

- `Access denied` / `Unknown database`: confira host, usuário, senha e `DB_NAME` iguais aos do Workbench.
- `Table ... doesn't exist`: rode `npm run db:setup`.
- `ISBN não encontrado`: tente *Buscar pelo título* ou preencha manualmente.
- API externa limitada (429): aguarde ou informe `GOOGLE_BOOKS_API_KEY` no `.env`.
