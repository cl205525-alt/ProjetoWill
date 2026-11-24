# Decisões de segurança — Lumi

Cada decisão abaixo responde ao requisito "segurança justificada" do projeto final de DAD.

| Risco | Decisão no código | Por quê |
| --- | --- | --- |
| Código remoto/Node no renderer | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`; o `preload.ts` expõe a chamada IPC e inscrições em canais fixos | Se a tela fosse comprometida, ela não teria acesso ao Node, ao MySQL nem ao `.env` |
| Chamadas IPC forjadas | O controller só atende ações de uma tabela fixa e confere que o `senderFrame` é o nosso `index.html` | Impede executar operações arbitrárias ou vindas de outra página |
| Acesso sem permissão | Cada rota declara `publica`, `logado` ou `admin`; exclusões e gestão de equipe são só de administrador, verificadas no processo principal | O renderer pode ser adulterado; a regra precisa morar no main |
| SQL Injection | Todas as consultas usam parâmetros `?` (mysql2 `execute`) e todos os dados passam por `Validacao` | O banco nunca interpreta texto digitado como SQL |
| XSS | Textos são inseridos com `textContent` ou `.value` quando possível; em modelos HTML, `Util.esc` protege texto e atributos entre aspas. Os componentes `Html` recebem os textos originais e fazem o escape na saída, não na gravação. A CSP continua restritiva. | Tags digitadas são exibidas literalmente, sem transformar o conteúdo salvo nem interpretar a entrada como marcação |
| Senhas | bcrypt (custo 12); troca exige a senha atual; tempo de resposta igualado para usuário inexistente | Vazamento do banco não revela senhas; dificulta descobrir usuários |
| Força bruta | Bloqueio de 60 s após 5 erros; sessão expira após 30 min sem uso | Limita tentativas e uso de máquina deixada aberta |
| Perder o último admin | Não é possível rebaixar/desativar/excluir a si mesmo nem o último administrador | Evita travar o sistema |
| Vazamento de erros | Erros técnicos viram mensagens genéricas; stack e SQL só vão ao console do main | Detalhes de infraestrutura ajudam atacantes |
| Imagens/URLs externas | Capas só de domínios permitidos, HTTPS, até 2 redirecionamentos (revalidados), tipo e tamanho checados por assinatura de bytes | Impede o app de baixar conteúdo arbitrário |
| Arquivos | Backup não contém contas nem hashes; importação valida estrutura, tipos, tamanhos e enum, usa transação e pede confirmação; CSV neutraliza fórmulas (`=`, `+`, `-`, `@`) | Backup não vira vazamento de senhas; arquivo malformado não corrompe o banco |
| Concorrência | Transações com `SELECT … FOR UPDATE` no livro, na mesma ordem em todos os métodos | Dois atendentes não emprestam o mesmo último exemplar |
| Navegação/permissões do Electron | `will-navigate` e `window.open` negados, `webview` bloqueado, permissões do navegador negadas, instância única | Reduz a superfície de ataque |
| Segredos | `.env` fora do Git; `.env.example` sem senhas | Credenciais não vão para o repositório |
| Lembretes de devolução | Envio optativo no processo principal, por HTTPS ao Resend, com chave fora do renderer. Só o endereço do leitor, o título e o prazo entram na mensagem. Erros do provedor não são registrados com a chave ou os destinatários; o histórico é visível ao administrador. | Reduz a exposição de dados e distingue o aceite da mensagem da entrega e da leitura |
| Lembretes repetidos | Restrição única por empréstimo e prazo; a mesma chave é usada nas retentativas com o provedor. A atualização passiva da aba não reinicia o tempo de sessão. | Evita envios duplicados e preserva a expiração por inatividade |

Ao montar uma tela, reserve `innerHTML` e os parâmetros de composição de `Html` para markup do próprio aplicativo. Use `textContent` para texto, `.value` para campos e `Util.esc` para texto interpolado diretamente nos modelos. URLs de capa passam também pela lista de domínios permitidos; escape de HTML não valida URLs. Rode `npm test` para verificar os cenários de regressão.
