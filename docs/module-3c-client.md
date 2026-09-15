# Módulo 3 — Parte 3c: cliente de corrida online

## Estado em 15/09/2026

**Atualização após teste manual:** o autor relatou solavancos na classificação
de Suzuka com dois humanos e um bot. PR #140 já mesclado em develop. Correção
de horizonte/tempo fracionário de predição em revisão separada; evidências e
limites em [module-3c-online-stutter-2026-09-15.md](module-3c-online-stutter-2026-09-15.md).
O restante deste documento registra a entrega original; M3c continua pendente.

Implementação frontend em validação; **não declarar a Parte 3c nem o Módulo 3
prontos**. As Partes 3a/3b permanecem aprovadas. Branch:
`codex/module-3c-frontend`, criada de `origin/develop` em `9b52721`.

Implementação publicada no commit `4c2aa8b`. PR em rascunho para develop:
[frontend #140](https://github.com/Never-Lift/never-lift-frontend/pull/140).
Backend correspondente: commit `218973e`,
[backend #104](https://github.com/Never-Lift/never-lift-backend/pull/104).
Nenhum desses PRs foi mesclado por esta tarefa; main não foi promovida.

O autor aprovou as decisões adicionais abaixo. O protocolo foi coordenado
diretamente com a tarefa do backend, sem implementar backend neste checkout.

## Decisões aprovadas e sincronizadas

- Classificação: **duas voltas cronometradas**, simultâneas mas isoladas por
  piloto; sem limite de tempo. Melhor válida define grid; inválida consome
  tentativa. Perda total encerra as tentativas restantes. Não são três voltas.
- Corrida principal: `settings.laps` editável no lobby, 1–99, padrão 3.
- Todos os humanos confirmam novamente após quali, inclusive host. Cinco luzes
  vermelhas, seguidas de liberação autoritativa.
- Intenção bruta de acelerar é enviada mesmo antes da liberação, permitindo ao
  servidor detectar queima; a predição fica imóvel. Esta revisão substitui a
  instrução inicial de não enviar throttle. Bloqueio: 600 subpassos = 5 s.
- Extensão mínima do `RaceEngine` para restaurar estado/reaplicar comandos,
  preservando integralmente as fórmulas, tuning e contrato físico `2.0.3`.
- Erro visual acima de 0,10 m é compensado em 100 ms. Erro angular usa o
  deslocamento na extremidade do carro com o mesmo limiar métrico.
- Histórico remoto limitado a 12 snapshots; cada quadro usa somente os dois
  que envolvem o instante 100 ms no passado. Sem extrapolação indefinida.
- Ghosts colidem apenas com ghosts no servidor; carros normais com normais.
  Barreiras continuam físicas. Ghost alheio só aparece para quem já terminou.
- Desconexão: congelar apresentação, tentar reconectar por até 30 s, aguardar
  snapshot novo e descartar predição anterior. O bot substituto e o resultado
  associado ao jogador são responsabilidade do servidor.

Contrato completo: [module-3c-race-flow.md](module-3c-race-flow.md).
Registro normativo: [module-3-online-decisions.md](module-3-online-decisions.md).

## Implementação

### Transporte e estado

- `OnlineRoomClient`: input com `clientSeq`/`clientTimestamp`, ticket fora do
  JWT principal, backoff e prazo de reconexão independente da abertura do socket.
  Timers globais são invocados por wrappers para evitar `Illegal invocation`
  no Chrome. Ticket tardio após saída não abre conexão órfã.
- `OnlineRoomSession`: stream físico separado do store React; guarda somente
  o último snapshot e no máximo 64 envelopes para remount. Preserva sequência
  enviada ao navegar, sem colocar posições em estado React.
- `race-protocol.ts`: validação runtime finita dos campos reais do contrato.
  O schema compartilhado mantém mensagens 3b históricas; a apresentação 3c
  exige os campos novos. ACK canônico: `lastProcessedClientSeq`.
- `OnlineRaceRuntime`: fases, comandos a 30 Hz com transições curtas,
  restauração de relógio/estado, seleção de carros visíveis, buffers e congelamento.
  UUID de outra sessão e snapshots atrasados são ignorados.

### Predição e apresentação

- `OnlinePrediction`: um `RaceEngine` para o humano focal, mesmas barreiras e
  passo 120 Hz; até 120 passos pendentes. Restaura estado físico completo,
  descarta passos confirmados e reaplica pendentes. Correção é visual; HUD e
  progresso não são calculados no cliente. Não executa IA ou colisões remotas.
- `RemoteSnapshotBuffer`: interpolação temporal e angular, com memória limitada.
- `OnlineRacePanel`: Canvas da corrida dentro da rota existente da sala,
  classificação, grid, pronto, semáforo, HUD autoritativo, penalidade, pódio e
  confirmação da saída por Esc. Resultado encerra o loop de desenho. Notificações
  de erro expiram em 5 s; sair do Canvas envia neutro sem executar teclas antigas.
- `RaceRenderer`: somente opacidade opcional por veículo, isolada por save/restore;
  câmera, minimapa, split-screen e desenho das pistas não foram alterados.
- `RaceEngine`: API de restauração disponível somente no modo de predição;
  nesse modo, deixa progresso/fim da prova para a autoridade. Integrador,
  colisores, dano, constantes e runtime solo/local permanecem os mesmos.
- `OnlineLobbyPage`, API e normalização: fases 3c e voltas editáveis usando o
  controle numérico já existente. Preferência WASD/setas/IJKL é reutilizada.

## Evidências executadas

1. Gate completo **anterior aos últimos testes/regressões de reconexão**:
   `npm run check`: 446 testes em 53 arquivos, lint e build aprovados.
2. Após as correções e testes adicionais:
   `npm run test -- src/online src/components/race/OnlineRacePanel.test.tsx src/race/RaceRenderer.camera.test.ts`:
   **40 testes em 8 arquivos aprovados**. Cobre predição imediata, replay por
   ACK, correção suave/limiar, buffer remoto, dois clientes via WebSocket mock,
   semáforo, ghost sem vazamento de opacidade, HUD, pódio, pronto, Esc,
   congelamento e encerramento do prazo de reconexão.
3. Revisão final: **456 testes em 55 arquivos aprovados** no gate completo,
   incluindo neutralização de input ao sair e expiração das notificações.
   `npm run check` completo aprovado: lint sem avisos, TypeScript e build Vite.
   O Vite informa bundle principal de 717,31 kB (218,02 kB gzip), acima do aviso
   padrão de 500 kB; isso não é medição de FPS nem bloqueou o build.
4. `node tools/online-race-browser-smoke.mjs`: **aprovado**, Chrome headless com
   dois contextos reais, dois humanos autenticados e um bot, Red Bull Ring
   (`spielberg`), backend H2 isolado em `127.0.0.1:8081`, sem Neon.
   Login, ticket, sala/pronto, início da quali, isolamento, teclado chegando à
   física autoritativa, queda/reconexão e Esc com confirmação passaram.
   Clientes receberam 114/119 snapshots e enviaram 169/178 inputs; zero pageerrors.
   Esse teste **não completou duas voltas nem chegou ao pódio**.
5. Imagens `output/online-3c/qualifying-client-1.png` e `-2.png`; relatório
   `output/online-3c/browser-smoke.json` (saídas locais ignoradas pelo Git).
   Primeira imagem inspecionada: pista, carro, HUD e minimapa renderizados.
6. Schema de tempo real SHA-256 idêntico nos checkouts:
   `A50B8C310788487564F889BA56685664C5DEFC533D36F4A0FA2564B161AC1E84`.
   Os 21 artefatos compartilhados não apresentam diferença de conteúdo; dois
   arquivos de definição do veículo diferem somente em LF/CRLF preexistente.

O Chrome exige autorização loopback no contexto automatizado; o harness concede
apenas essa permissão aos contextos descartáveis. CORS do backend foi verificado
via OPTIONS (200 e origem correta). Não houve relaxamento de segurança do app,
proxy para esconder CORS, alteração de credenciais de produção ou uso do Neon.
O harness cria contas/sala somente no H2 de teste e fecha a sala ao terminar.

## O que falta — gates de conclusão

- Usar a revisão final backend `218973e` na validação integrada. A tarefa backend
  confirmou suíte de 130 testes sem falhas/erros (um diagnóstico opcional
  ignorado), package e 7 testes Node aprovados; inclui reconexão e fechamento
  de socket durante broadcast. O H2 do smoke frontend era anterior a esses fixes.
- Corrida completa em dois navegadores: duas tentativas cronometradas de quali,
  confirmação de ambos, cinco luzes, duas voltas de corrida curta com ao menos
  um bot, contato observado nas duas telas, ghost, pódio idêntico e volta ao lobby.
- Repetir reconexão durante corrida e resultados, incluindo rejeição após 30 s;
  validar teclado e sensação de correção/interpolação com latência real.
- Conferir desempenho online em grid cheio. Não declarar 40/60 FPS garantidos
  por reutilizar as otimizações locais ou por este smoke de três carros.
- Autor realizar/aprovar a validação manual integrada da preview correspondente.
- Revisar/integrar os PRs das features para develop somente após os gates;
  promoção develop → main depois da validação integrada, sem merge automático
  e preservando ancestralidade.

## Ponto de retomada e publicação

Em 15/09/2026 a consulta GitHub por `gh pr list` com permissão de rede foi
temporariamente recusada pelo serviço de aprovação automática por limite de uso.
Após checagens locais, a repetição direta foi autorizada: lista de PRs vazia,
sem duplicata. O gate local também foi autorizado. Não foi usado contorno.
Publicação concluída no PR #140 em rascunho; nenhum merge ou promoção à main.

Comandos para reproduzir as verificações:

```powershell
npm run check
# Com backend H2 isolado ativo em :8081, nunca o Neon:
node tools/online-race-browser-smoke.mjs
git diff --check
gh pr list --state open --json number,title,baseRefName,headRefName,url
```

PR #140 permanece em rascunho enquanto houver gate manual/integrado pendente.
Não promover o develop antigo como se já incluísse esta feature. O backend usa
uma tarefa/branch própria; não editar seu checkout.
