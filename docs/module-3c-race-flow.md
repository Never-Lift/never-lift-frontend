# Parte 3c — fluxo autoritativo de corrida

## Revisão aprovada em 15/09/2026

O autor confirmou que esta revisão substitui os trechos divergentes das decisões
11, 13, 14, 53 e 56 do registro online e dos planos:

- O host pode configurar as voltas da corrida no lobby (padrão: 3).
- Queima de largada é qualquer `throttle > 0` antes da liberação. A penalidade
  dura exatamente 600 subpassos de 1/120 s (5 segundos de simulação).
  A menção anterior a 300 subpassos era aritmeticamente incompatível com 5 s.
- Carros finalizados colidem com outros ghosts; carros normais colidem com
  normais. Pares mistos não colidem. Barreiras continuam físicas para todos.

Revisão final solicitada pelo autor: classificação de exatamente duas voltas
por piloto, sem limite de tempo. Substitui a proposta intermediária de sessão
livre e as decisões 34/56/67. A melhor volta válida define o grid; uma volta
inválida também consome tentativa. Sem volta válida, o piloto vai ao fim por
seed determinística. Permanecem simulações isoladas, contagem de 3 s e nova
confirmação antes da corrida. Um participante conectado parado pode manter a
classificação aguardando. Saída explícita encerra sua participação sem tempo;
desconexão mantém o bot substituto. Perda total encerra as tentativas restantes
como inválidas, pois o M3 não tem reparos.

## Plano de implementação e verificação

1. Registrar decisões e contratos REST/WebSocket compartilhados.
2. Acrescentar orquestração por subpassos ao motor existente: semáforo,
   penalidade, checkpoints direcionais, voltas, ghost e classificação.
3. Integrar ciclo de sala, reconexão/bot substituto, publicação de eventos e
   persistência atômica somente ao finalizar a corrida.
4. Testar regras isoladas e transporte autenticado; executar dois clientes
   reais de script até o resultado de uma corrida de duas voltas, verificando
   os registros persistidos.
5. Sincronizar documentação/contratos com o frontend, atualizar Project,
   registrar evidências e abrir promoção develop → main sem mesclar.

## Limites

As fórmulas físicas 2.0.3 permanecem canônicas. Pits com serviço, vácuo,
ambiente, caos e campeonatos continuam nos seus módulos. A implementação da
interface e da predição/reconciliação da Parte 3c pertence ao frontend.

Status: implementação em andamento; critérios de pronto ainda não cumpridos.

## Contrato de integração frontend/backend — 15/09/2026

Envelope permanece `{type,payload}`. Modelo/versão física: F1/2.0.3.
O schema executável é `contracts/module-2/v2/realtime-race-protocol.schema.json`.

- `PATCH /api/rooms/{code}/settings` aceita `laps` inteiro inclusivo 1–99,
  somente host no lobby. Padrão 3. `settings.qualifyingLaps` é sempre 2 e
  não é editável. Não existe campo de duração da classificação.
- `room_state.state`: `lobby`, `qualifying`, `qualifying_results`, `countdown`,
  `race`, `results`, `closed`. `settings` continua bloqueada após lobby.
- `ready {ready:boolean}`: não-host no lobby; todos os humanos, inclusive host,
  em `qualifying_results`; todos os humanos em `results` para confirmar saída.
  A corrida inicia quando todos os humanos conectados confirmarem novamente.
  Resultados retornam ao lobby após confirmações ou 60 s de simulação.
- `select_loadout {color}` aceita somente as três cores publicadas, antes de
  ready, sem modelo. A cor padrão já é válida; não exige abrir o seletor.

### Snapshot

`state_snapshot` preserva os campos 3b, inclusive `lastProcessedClientSeq`.
Acrescenta `sessionId` (UUID estável quali→corrida→resultado; novo no próximo
ciclo), `phase`, `substep`, `physicsSubstep`, `totalLaps`, `raceTimeMs`.
`tick` avança a 30 Hz, `substep = tick * 4` a 120 Hz, ambos monotônicos na
sessão. `physicsSubstep` identifica o relógio do motor físico e reinicia quando
os carros são restaurados no começo do semáforo. Tempo físico em segundos é
`physicsSubstep / 120`. `serverTime` é epoch em milissegundos ancorado no início
da sessão e avançado pelo relógio de simulação.

Cada carro acrescenta: `lap` (voltas válidas concluídas), `isGhost`,
`falseStart`, `inPit`, `position` (1-based), `nextCheckpoint` (0-based),
`qualifyingAttempts` (0–2), `currentLapTimeMs`, `bestLapTimeMs` (0 sem válida).
Na quali cada socket recebe somente seu próprio carro. Snapshots congelam
durante contagens, espera e resultado; somente `qualifying` após 3 s e `race`
integram movimento. No reinício da física, o frontend descarta predições antigas.

### Eventos

Todos os novos `race_event` incluem `sessionId`, `tick`, `substep`, `serverTime`.

| payload.type | Campos adicionais |
|---|---|
| `qualifying_start` | `laps:2`, `countdownSeconds:3` |
| `session_phase` | `phase` |
| `qualifying_result` | `grid:[{playerId,position,bestLapTimeMs,valid}]` |
| `start_light` | `stage` (1 até 5) |
| `lights_out` | `stage:0` |
| `false_start` | `playerId`, `blockedSubsteps:600`, `penaltySeconds:5` |
| `checkpoint` | `playerId`, `checkpointIndex`, `lap` |
| `lap_complete` | `playerId`, `lap`, `lapTimeMs` |
| `finished` | `playerId`, `position`, `totalTimeMs` |

`countdown` contém `{sessionId,startAtServerTime}`. O primeiro estágio acende
ao começar a contagem, os seguintes a cada segundo; luzes apagam um segundo
após o quinto estágio. O cliente envia a intenção de throttle antes da largada:
bloquear envio impediria o servidor de detectar queima. A predição mantém o
carro no grid. A penalidade começa na liberação e bloqueia 600 subpassos; uma
tentativa curta seguida de soltura antes do tick também fica registrada.

`race_result` contém `{sessionId,trackId,trackCatalogVersion,
physicsContractVersion,standings}`. Cada entrada contém
`{playerId,userId,displayName,position,totalTimeMs,bestLapTimeMs,finished,laps,
progressMeters}`. Bots têm `userId:null`. Substituição por desconexão preserva
a associação original. Resultado só é emitido após commit da transação.

O cliente deve preservar `clientSeq` crescente na mesma sessão e descartar
snapshots de sessionId antigo. Reconexão recupera o mesmo estado e relógio.

## Evidências e ponto de retomada — 15/09/2026

- A suíte completa anterior à última correção terminou com 127 testes,
  zero falhas/erros e um diagnóstico opcional ignorado. Os sete testes Node
  de suporte/comparação de paridade também passaram.
- O E2E original usou dois clientes HTTP/WebSocket autenticados, duas voltas
  de classificação e duas de corrida em pista curta de teste, passando pelo
  semáforo até standings idênticos e dois `RaceResult` persistidos em H2.
  Não foi usado o banco de produção. A pista de teste não altera o catálogo.
- A ampliação desse E2E para reconectar na classificação, corrida e resultado
  revelou uma recusa `participant_not_found` no primeiro input após reconexão.
  `RoomRaceRuntime.input` foi corrigido para restaurar o controlador humano
  antes de aceitar o comando, sob o mesmo lock da simulação; o próximo tick
  físico observa a intenção recebida. A reexecução ampliada passou em 15/09/2026
  às 08:38 (America/Sao_Paulo), incluindo reconexão nas três fases e replay do
  resultado: sessão `4f721269-60e2-4eb4-9dd1-c3d8f33053cf`, dois finalistas com
  duas voltas (49.534 ms e 50.390 ms) e dois resultados persistidos.
- Há também um novo teste REST para rejeitar modelo/posição no loadout e impedir
  alteração da cor enquanto ready. Passou na mesma rodada: 18 testes ao todo
  (`OnlineRaceFlowIntegrationTest`, `RoomManagerTest`, `RoomIntegrationTest`),
  zero falhas/erros/ignorados.
- A tarefa do frontend reportou smoke integrado aprovado em dois contextos reais
  do Chrome contra o servidor H2 local em 8081: dois humanos e um bot em Spielberg,
  autenticação/ticket/WebSocket, ready/início, classificação isolada, teclado com
  movimento autoritativo, queda/reconexão e confirmação de saída, sem `pageerrors`.
  Esse smoke não completou duas voltas até o pódio e usou o servidor anterior ao
  último ajuste de reconexão; não substitui a revalidação do E2E ampliado.
  O preflight local respondeu 200 com a origem 127.0.0.1:5174 autorizada; o bloqueio
  inicial era a permissão de acesso à rede local do Chrome, não CORS do backend.
- Após a rodada focal aprovada, a execução de `package` com a suíte completa foi
  novamente bloqueada pelo serviço de aprovação automática por limite de uso.
  Isso não equivale a build aprovado. Não promover nem declarar a Parte 3c pronta
  até concluir a suíte completa e o empacotamento na revisão atual.
- As proteções remotas de `develop` e `main` foram conferidas: ambas exigem PR,
  `Validate source branch` e `Maven build and test`, inclusive para administradores.
  A implementação ainda está em `codex/module-3c-backend`. É necessário integrar
  o PR intermediário em `develop` antes da promoção conter a 3c; não contornar
  essa proteção nem mesclar sem autorização do autor. `main` permanece sem merge.

Comando de revalidação no ambiente Windows observado (JDK 22 compilando release
21; CI deve continuar usando Java 21):

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-22'
.\mvnw.cmd '-DargLine=-Djdk.net.unixdomain.tmpdir=C:\Windows\Temp' test
.\mvnw.cmd '-DargLine=-Djdk.net.unixdomain.tmpdir=C:\Windows\Temp' package
```

A propriedade JVM contorna somente uma falha de inicialização do transporte
local do JDK (`UnixDomainSockets`/loopback) neste Windows. Não muda protocolo,
física, resultados ou configurações de produção e não é requisito do produto.
