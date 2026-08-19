# Plano de Implementação — Backend
### Never Lift — MVP e expansão planejada

> Este documento cobre o backend. Ele assume conhecimento do plano de frontend (`frontend-implementation-plan.md`) — os dois compartilham a seção de arquitetura e o protocolo de tempo real abaixo, que **deve ser idêntico nos dois documentos**.
>
> As decisões visuais e de experiência estão em `game-design-guide.md`. O backend não implementa apresentação, mas deve respeitar as unidades, metadados e contratos compartilhados necessários para câmera, minimapa, circuitos e telas.

---

## 1. Stack e hospedagem

| Camada | Escolha | Onde roda |
|---|---|---|
| Linguagem/framework | Java 21 (LTS) + Spring Boot 3.x | Render — Web Service, tier free |
| Módulos Spring | Web (REST), WebSocket, Data JPA, Security, Validation | — |
| Banco de dados | PostgreSQL | Neon — tier free permanente |
| Autenticação | JWT stateless (cobre usuário logado **e** guest) | — |

**Por que essa combinação:** Render free hiberna após 15 min sem tráfego (~1 min pra acordar) — aceitável pra um jogo com amigos, não pra um serviço 24/7. Neon é usado em vez do Postgres do próprio Render porque o Postgres free do Render expira em 30 dias; o do Neon é permanente. Ambos sem custo pra começar; upgrade é só trocar variável de ambiente de conexão, não muda arquitetura.

**Convenção de nomenclatura:** todo identificador de código (classes, campos JSON, paths de endpoint, nomes de eventos) é em **inglês**, por exigência do projeto. Este documento é em português, mas todo nome técnico citado abaixo já está no formato final que deve ir pro código.

---

## 2. Arquitetura de alto nível

O backend tem dois planos distintos:

- **Plano REST** (`/api/**`): autenticação, conta, amigos, notificações, configuração de campeonato, recordes/histórico. CRUD convencional, sem exigência de baixa latência.
- **Plano tempo real** (`/ws`, um socket por sala): o motor de corrida. Aqui o servidor é a **única autoridade** — ele roda a simulação física, decide colisões, valida checkpoints/voltas, e os clientes só enviam intenção de input e recebem snapshots do resultado. Isso é o oposto do protótipo, onde cada cliente simulava sozinho e só repassava sua própria opinião.

Cada sala ativa tem um **loop de simulação de passo fixo** (tick), independente da taxa de rede ou da taxa de frame de qualquer cliente — recomendo `30 ticks/segundo`, implementado com um `ScheduledExecutorService` (ou `@Scheduled` de instância por sala) dedicado, não atrelado às threads de request HTTP.

**Risco arquitetural a documentar e vigiar:** como o backend é Java e o frontend é TypeScript, a física de predição do cliente (ver plano de frontend) e a física autoritativa do servidor são **duas implementações separadas da mesma fórmula**, em linguagens diferentes. Isso é uma fonte real de bugs sutis — se as constantes de atrito, arrasto, drift etc. divergirem entre os dois lados, o cliente vai prever errado e corrigir (reconciliar) o tempo todo, mesmo com rede perfeita. Recomendação: manter uma única "folha de constantes" documentada (pode ser um JSON versionado, lido por ambos os lados via geração de código ou só copiado manualmente com testes de regressão comparando saída do motor Java e do motor TS pros mesmos inputs) e tratar qualquer divergência como bug de prioridade alta, não como "gosto" de tuning.

**Unidades compartilhadas:** 1 unidade de mundo equivale a 1 metro. Posições, dimensões, limites, checkpoints e definições de pista usam um plano cartesiano com `+X` para a direita e `+Y` para cima; `angle` é expresso em radianos, no sentido anti-horário a partir de `+X`; velocidades usam metros por segundo. Pixels nunca entram no domínio do backend.

---

## 3. Protocolo de tempo real (contrato compartilhado com o frontend)

Envelope de toda mensagem WebSocket: `{ "type": "...", "payload": {...} }`.

### Cliente → Servidor

| type | payload | quando |
|---|---|---|
| `join_room` | `{ roomCode, trackCatalogVersion }` | ao entrar numa sala; permite rejeitar geometria incompatível antes da corrida |
| `select_loadout` | `{ carModel, color }` | antes de ficar ready |
| `ready` | `{}` | jogador confirma pronto |
| `input` | `{ throttle, brake, steer, nitro, clientSeq, clientTimestamp }` | a cada mudança de input (não a cada frame) |

**Importante:** o cliente nunca envia posição — só intenção (`input`). Isso é o que torna o servidor a única fonte de verdade.

### Servidor → Cliente

| type | payload | quando |
|---|---|---|
| `room_state` | `{ players[], hostId, settings, readyStates }`, com `settings.trackId` e `settings.trackCatalogVersion` | mudança no lobby |
| `countdown` | `{ startAtServerTime }` | semáforo iniciando (feature 14) |
| `state_snapshot` | `{ tick, serverTime, cars: [{ playerId, x, y, velocityX, velocityY, angle, speed, damageState: { health, engineDamaged, steeringDamaged, steeringPull, totalLoss }, nitroRemaining, lap, isGhost, inPit }] }` | a cada broadcast (~20/s) |
| `race_event` | `{ type: collision \| checkpoint \| lap_complete \| finished \| false_start \| pit_enter \| pit_exit \| breakdown, ...dados específicos }` | evento discreto decidido pelo servidor |
| `race_result` | `{ standings[] }` | fim de corrida |
| `error` | `{ code, message }` | falha de validação |

`state_snapshot` é usado pelo frontend pra reconciliação (carro do próprio jogador) e interpolação (carros dos outros) — ver plano de frontend, seção do Módulo 3.

`x`/`y` estão em metros, `velocityX`/`velocityY` em metros por segundo e `speed` é a magnitude da velocidade. O vetor de velocidade é necessário para a câmera dinâmica, inclusive no modo espectador, sem confundir direção de movimento com ângulo da carroceria durante um drift.

---

## 4. Modelo de dados (visão geral)

- **User**: `id (UUID)`, `gamertag (unique, sem espaço)`, `displayName`, `passwordHash`, `avatarId`, `preferredLanguage`, `createdAt`
- **Track**: dado semente (seed), não editável via API — `id`, `name`, `countryCode`, `lengthMeters`, `catalogVersion`, `pathDefinition`, `sceneryLayout`. Os dois últimos usam coordenadas métricas; 24 registros são carregados via migration.
- **RaceResult**: `id`, `userId (nullable p/ bot)`, `trackId`, `mode (solo|local|online|championship)`, `position`, `totalTimeMs`, `bestLapTimeMs`, `finished`, `createdAt`
- **Championship**: `id`, `name`, `trackOrder[]`, `pointsTable`, `status`, `createdAt`
- **ChampionshipEntry**: `championshipId`, `userId`, `totalPoints`, `position`
- **Friendship**: `requesterId`, `addresseeId`, `status (pending|accepted)`, `createdAt`
- **Notification**: `id`, `userId`, `type`, `payload (json)`, `read`, `createdAt`

Recordes/estatísticas (feature 3 e 10) são **calculados via query** sobre `RaceResult`/`ChampionshipEntry`, não guardados numa tabela separada — evita ficar sincronizando dado duplicado. Se performance virar problema, adicionar view materializada depois, não desde o início.

---

## 5. Módulos

Cada módulo é uma unidade que pode virar um prompt isolado pro Codex. A ordem abaixo respeita dependências.

**Regra válida pra todo módulo, sem exceção:** nenhum módulo é considerado pronto sem testes automatizados rigorosos — unitários pras regras de negócio (cálculo de pontos, resolução de colisão, decremento de nitro, etc.) e de integração pros endpoints/eventos WebSocket. Vale até pros módulos que parecem simples, tipo CRUD de amigos. O "Critério de pronto" de cada módulo abaixo é o mínimo funcional a validar manualmente; a suíte de testes automatizados é obrigatória em cima disso, não um substituto.

**Regra de design e fase:** decisões visuais pós-MVP não autorizam endpoints, entidades ou campos antes do módulo indicado. Exceções são somente contratos compartilhados indispensáveis ao motor, como unidades métricas, catálogo de pistas e vetor de velocidade.

### Módulo 0 — Fundação e deploy
**Objetivo:** provar que Render + Neon + o pipeline de deploy funcionam de ponta a ponta antes de escrever qualquer feature.
**Escopo:** projeto Spring Boot vazio, conexão com Neon configurada via variável de ambiente, endpoint `GET /api/health` retornando status + versão, deploy automático a partir do Git no Render.
**Critério de pronto:** `curl` no endpoint de produção retorna 200 depois de um `git push`.

### Módulo 1 — Usuários e autenticação
**Depende de:** Módulo 0.
**Cobre features:** 1, 2, 3 (parcial — edição/exclusão, não estatísticas ainda), 13 (referência de avatar, não a arte em si).
**Entidades:** `User`.
**Endpoints:**
- `POST /api/auth/register` `{ gamertag, displayName, password }`
- `POST /api/auth/login` `{ gamertag, password }` → JWT
- `POST /api/auth/guest` → JWT de guest (sem persistência de `User`, claim `role: guest`)
- `GET /api/account/me`
- `PATCH /api/account/me` (requer senha atual no corpo) `{ displayName?, avatarId?, password? }`
- `DELETE /api/account/me` (requer senha atual no corpo)
**Regras de negócio:** gamertag único e sem espaço (validar regex no DTO); senha mínimo 4 caracteres, sem espaço, sem restrição de conjunto de caracteres; guest não pode acessar nenhum endpoint marcado como `online-only` (ver Módulo 3) — middleware de autorização checando a claim `role`.
**Critério de pronto:** os 6 endpoints com testes de integração cobrindo caminho feliz + os erros óbvios (gamertag duplicado, senha errada no delete/edit).

### Módulo 2 — Suporte a corrida local (sem rede)
**Depende de:** Módulo 0.
**Contrato de entrada:** `contracts/module-2/v1/` contém os schemas compartilhados, catálogo `2026.1`, constantes físicas `1.2.0` e, neste repositório, as 24 definições métricas geradas de forma reproduzível. O Módulo 2 transforma esses dados canônicos em seed/migration e API; não redesenha circuitos durante a implementação.
**Cobre features:** parte de 3 (registrar resultado local, se o usuário estiver logado), 26.
**Nota:** o motor de física em si (solo/local) roda **inteiramente no frontend** neste módulo — ver plano de frontend, Módulo 2. O backend fornece o catálogo versionado de pistas e persiste o resultado no fim; não participa da simulação local.
**Endpoints:**
- `GET /api/tracks` → catálogo público com `catalogVersion` e metadados dos 24 circuitos (`id`, `name`, `countryCode`, `lengthMeters`)
- `GET /api/tracks/{id}` → definição métrica versionada (`pathDefinition`, `sceneryLayout`) usada pelo motor local e pelo minimapa
- `POST /api/races/local-result` `{ trackId, trackCatalogVersion, mode: solo|local, results: [{ userIdOrNull, position, totalTimeMs, bestLapTimeMs, finished }] }`
**Regras do catálogo:** `pathDefinition` precisa conter traçado fechado, limites dirigíveis, checkpoints, largada e pits em metros; `sceneryLayout` usa o mesmo sistema de coordenadas. Comprimentos variados e ajustes aproximados de 10–20% são permitidos conforme o guia, mas frontend e backend precisam consumir a mesma `catalogVersion`.
**Regra de identidade:** o backend deriva o usuário do JWT. O payload nunca pode atribuir um resultado a um `userId` arbitrário; guest e bot permanecem sem associação de conta.
**Testes obrigatórios específicos:** validar os 24 registros, identidade/versão do catálogo, geometria fechada, ordem de checkpoints, comprimento coerente e rejeição de resultado com `trackId` inexistente ou versão incompatível.
**Critério de pronto:** o catálogo permite carregar um circuito curto e um longo no frontend, e o resultado de uma corrida solo/local é persistido e consultável pela camada de repositório que será exposta pelo `race history` no Módulo 8. O endpoint público de histórico não é antecipado no Módulo 2.

### Módulo 3 — Motor autoritativo online (núcleo)
**Depende de:** Módulo 1.
**Cobre features:** 4 (modos online — lobby, configuração de sala), 8, parte de 6 (física básica compartilhada), parte de 5 (colisão).
**Este é o módulo de maior risco do projeto — é onde a lição sobre servidor autoritativo se aplica.**
**Escopo:**
- Sessão WebSocket por conexão (`/ws`), autenticada via JWT na query string ou header de handshake.
- `RoomManager`: cria/lista salas, no máximo 4 jogadores+bots por sala, atribui `hostId`.
- `RaceEngine` por sala: física nova, escrita do zero em Java — o protótipo entra só como referência de sensação/comportamento esperado, não como código a converter (isso é um jogo novo, não uma versão do antigo). Cobre aceleração, atrito — incluindo atrito maior fora da pista (grama: carro fica mais liso e mais lento, feature 5) —, colisão e o modo normal/drift definido uma vez para a sala e aplicado igualmente a todos. Modelos de carro são somente visuais e nunca selecionam constantes mecânicas. Roda a `30 ticks/segundo` num `ScheduledExecutorService` próprio, lendo o último `input` recebido de cada jogador (não esperando por ele a cada tick).
- O motor usa exclusivamente metros, segundos e radianos conforme a convenção compartilhada; cada carro mantém vetor de velocidade para snapshots, drift e reconciliação.
- A sala fixa `trackId` e `trackCatalogVersion` antes da largada e rejeita cliente com catálogo incompatível em vez de simular geometrias diferentes.
- Resolução de colisão **uma vez, no servidor**, usando o estado real de todos os carros da sala — não a aproximação que existia no protótipo. A colisão também classifica e aplica o dano mecânico cumulativo do contrato v1.2 para manter a predição do frontend convergente.
- Broadcast de `state_snapshot` a cada ~50ms (20/s) pra todos da sala.
**Critério de pronto:** dois clientes de teste (podem ser scripts, não precisa ser a UI final) conectados na mesma sala veem exatamente a mesma colisão acontecer no mesmo lugar — esse é o teste que valida que o bug original foi resolvido.

### Módulo 4 — Ambiente e modo caos
**Depende de:** Módulo 3.
**Cobre features:** 4 (dia/noite, chuva/sol, modo caos), 16, 21 (estado, não o desenho do cone de luz — isso é frontend).
**Escopo:** `RoomSettings` estendido com `timeOfDay`, `weather`, `chaosMode`, `driftMode` (checkbox independente do modo caos — alterna a tunagem de atrito lateral que o `RaceEngine` do Módulo 3 usa, feature 4); quando `chaosMode` ativo, servidor sorteia direção do vento, até 3 poças de óleo e 3 caixas por corrida (autoritativo — se o cliente sorteasse, cada tela veria obstáculos em posições diferentes, mesmo bug de novo); chuva aplica multiplicador de derrapagem na física do Módulo 3; vento aplica força lateral constante por corrida.
**Critério de pronto:** ativar modo caos bloqueia os outros campos de configuração na resposta de `room_state` (`settingsLocked: true`) e todo cliente recebe os mesmos obstáculos.

### Módulo 5 — Corrida completa (dano, nitro, vácuo, fantasma, pits)
**Depende de:** Módulo 3.
**Cobre features:** 5, 6, 7, 15, 19, 24 (estado, alerta visual é frontend).
**Escopo:**
- `damageState` por carro: `{ health, engineDamaged, steeringDamaged, steeringPull, totalLoss }`, cumulativo e calculado pela intensidade do impacto no `RaceEngine`: fraco afeta direção, médio afeta motor, alto combina ambos e crítico causa perda total; colisões menores repetidas também zeram a vida. Dano de motor aplica penalidade moderada e dano de direção gera leve desvio persistente sem reduzir a autoridade de esterço. Este módulo acrescenta a integração completa com pits, eventos, resultado e demais regras de corrida.
- `nitroRemaining`: orçamento total calculado como `f(número de voltas)` na criação da sala, decrementa com uso, não recarrega.
- Vácuo: redução leve de arrasto quando um carro está atrás e próximo de outro, calculado no tick da física.
- Ao cruzar a linha, carro vira `isGhost: true`; regra de colisão do Módulo 3 passa a ignorar par (ghost, não-ghost) e (não-ghost, não-ghost-diferente-de-ghost) — só `(ghost, ghost)` e `(normal, normal)` colidem.
- `pit_enter`/`pit_exit`: ao sobrepor a zona de pit com vida abaixo do máximo ou alguma falha mecânica, servidor assume o carro por 2s (ignora `input` do jogador), restaura vida e dano, e emite os dois eventos.
- Loadout: `carModel` (F1/Supercar/Drift) e `color` selecionados antes do `ready`, validados no `select_loadout` do Módulo 3. Ambos são exclusivamente visuais e nunca alteram física, colisão ou desempenho.
**Critério de pronto:** simular uma batida forte reduz velocidade máxima do carro pro resto da corrida; usar todo o nitro numa volta o deixa indisponível nas seguintes; carro com perda total fica parado até o fim.

### Módulo 6 — Campeonatos
**Depende de:** Módulo 3, Módulo 5.
**Cobre features:** 9, 20.
**Entidades:** `Championship`, `ChampionshipEntry`.
**Endpoints:**
- `POST /api/championships` `{ trackOrder[] (até 24, repetição permitida) }`
- `GET /api/championships/{id}`
**Regras de negócio:** primeira corrida é classificação em pista aleatória do pool escolhido; grid de cada corrida seguinte é o inverso da posição final da corrida anterior; pontos dinâmicos por número de jogadores (`{2: [5,2], 3: [7,4,1], 4: [10,6,3,1]}`); +1 ponto de volta mais rápida só se quem fez a volta terminou a corrida; só vitória de campeonato e melhores voltas entram em recordes globais (Módulo 8), corrida avulsa não conta.
**Critério de pronto:** um campeonato de 3 corridas com 3 jogadores fixos produz a tabela de pontos correta ao final, incluindo o ponto bônus de volta mais rápida.

### Módulo 7 — Social (amigos e notificações)
**Depende de:** Módulo 1.
**Cobre features:** 11, 12.
**Entidades:** `Friendship`, `Notification`.
**Endpoints:**
- `POST /api/friends/request` `{ gamertag }`
- `POST /api/friends/{id}/accept`
- `GET /api/friends`
- `GET /api/notifications`
- `PATCH /api/notifications/{id}/read`
**Tempo real:** convite de amizade/sala gera `Notification` persistida **e** um push via WebSocket (`type: notification`) se o usuário estiver conectado, pro toast de 5s do frontend; se estiver offline, fica só na aba pra quando entrar.
**Critério de pronto:** convite entre dois usuários logados aparece como toast em quem está online e como pendente em quem não está.

### Módulo 8 — Perfil, recordes e histórico
**Depende de:** Módulo 6.
**Cobre features:** 3 (estatísticas), 10, 26.
**Endpoints:**
- `GET /api/account/me/stats` (vitórias, derrotas, campeonatos vencidos, recorde por circuito)
- `GET /api/account/me/history` (paginado)
- `GET /api/records/global` (top vitórias, melhores tempos por circuito — só dado de campeonato, conforme regra do Módulo 6)

**Critério de pronto:** ganhar um campeonato de teste muda o "campeonatos vencidos" da conta e aparece no ranking global na consulta seguinte.

### Módulo 9 — Polimento
**Depende de:** todos os anteriores.
**Cobre features:** 25, 27 (`preferredLanguage` já existe desde o Módulo 1; aqui é só garantir que toda resposta de erro tem chave i18n, não string fixa em português).
**Escopo:** endpoint `GET /api/info/rules` servindo conteúdo estático (pode ser JSON versionado no repo, não precisa banco); revisão de mensagens de erro pra usar chaves (`error.gamertag_taken`) em vez de texto fixo, pro frontend traduzir.
**Critério de pronto:** trocar `preferredLanguage` da conta muda o idioma das mensagens de erro recebidas, sem precisar mudar nada no backend.

---

## 6. Expansão aprovada (pós-MVP)

Os Módulos 0–9 continuam formando o MVP original. Os módulos abaixo são expansões posteriores e não bloqueiam o Módulo 9. O servidor continua sendo a autoridade sobre desbloqueios competitivos, fantasmas validados, espectadores, placares, torneios e penalidades.

### Módulo 10 — Progressão, carros e medalhas
**Depende de:** Módulo 5, Módulo 6 e Módulo 8.
**Entidades:** `Achievement`, `UserAchievement`, `CarUnlock`, `ProfileMedalSlot`.
**Escopo:** catálogo versionado de conquistas com requisito, progresso, raridade e recompensa; progresso derivado de resultados autoritativos; um carro inicial por conta; desbloqueios e recompensas cosméticas idempotentes; medalhas de idade da conta derivadas de `User.createdAt`; até três medalhas públicas ordenadas no perfil. A forma/material visual é resolvida pelo frontend a partir do identificador e da raridade, não armazenada como imagem no backend.
**Endpoints:** `GET /api/achievements`, `GET /api/account/me/progression`, `PATCH /api/account/me/medals`, `GET /api/users/{id}/showcase`.
**Regras:** nunca aceitar do cliente conclusão, progresso ou desbloqueio como verdade; nenhuma recompensa altera constantes físicas; migrações devem conceder o carro inicial às contas existentes.
**Critério de pronto:** reprocessar o mesmo resultado não duplica recompensa e um perfil público expõe no máximo três medalhas pertencentes ao usuário.

### Módulo 11 — Contrarrelógio e fantasmas
**Depende de:** Módulo 2, Módulo 3, Módulo 7 e Módulo 8.
**Entidades:** `TimeTrialRecord`, `GhostRun` com versão de física e sequência compactada de inputs.
**Endpoints:** `POST /api/time-trials/{trackId}/runs`, `GET /api/time-trials/{trackId}/me`, `GET /api/time-trials/{trackId}/friends/{friendId}`.
**Regras:** validar circuito, checkpoints, condições e versão; reexecutar inputs no motor autoritativo antes de aceitar recorde; armazenar somente a melhor volta válida por combinação competitiva; permitir fantasma de amigo apenas com amizade aceita; fantasma nunca colide.
**Critério de pronto:** uma trajetória adulterada é rejeitada e uma trajetória validada reproduz o mesmo tempo dentro da tolerância determinística definida.

### Módulo 12 — Controles personalizáveis
**Responsabilidade:** exclusivamente frontend. Não há entidade, endpoint ou mudança de protocolo neste módulo; a numeração é reservada para manter os roadmaps alinhados.

### Módulo 13 — Modo espectador para amigos
**Depende de:** Módulo 3, Módulo 5 e Módulo 7.
**Escopo:** presença de amigos em corrida; ingresso com papel `spectator`; autorização por amizade aceita e privacidade da sala; snapshots somente de leitura com atraso configurável; limite de espectadores separado das quatro vagas de pilotos; revogação imediata ao perder acesso.
**Protocolo:** estender a entrada de sala com papel de espectador e emitir estado de câmera/participantes sem aceitar `select_loadout`, `ready` ou `input` de espectadores.
**Critério de pronto:** espectador autorizado acompanha a prova, não ocupa vaga e qualquer tentativa de input é rejeitada e auditável.

### Módulo 14 — Equipes e placar coletivo
**Depende de:** Módulo 7 e Módulo 8.
**Entidades:** `Team` (inclui `name`, `tag`, `primaryColor`, `emblemId`), `TeamMembership`, `TeamInvitation`.
**Endpoints:** criação/edição/consulta de equipe, convite/aceite/recusa/saída, gestão de membros e `GET /api/teams/leaderboard`.
**Regras:** nome e sigla únicos; `primaryColor` validada e `emblemId` limitado ao catálogo predefinido; uma equipe por usuário; convites somente entre amigos; papéis e permissões; transferência de liderança; fórmula de pontuação versionada e baseada em resultados elegíveis, sem duplicar histórico quando o jogador troca de equipe.
**Critério de pronto:** mudanças concorrentes de membros preservam as invariantes e o placar é recalculável a partir das fontes autoritativas.

### Módulo 15 — Torneios oficiais automáticos
**Depende de:** Módulo 4, Módulo 5, Módulo 6, Módulo 13 e Módulo 14.
**Entidades:** `Tournament`, `TournamentRegistration`, `TournamentRound`, `TournamentHeat`.
**Escopo:** agendamento oficial em horários predefinidos; inscrição e check-in; configuração aleatória gerada e persistida no servidor; baterias de até quatro jogadores com avanço dos dois primeiros; byes ou classificatória para totais incompatíveis; regras de empate, abandono e desconexão; chave e eventos consultáveis.
**Nota de produto:** o limite máximo de inscritos permanece configurável e marcado como pendente até medição de capacidade; nenhum valor arbitrário deve ser fixado no código.
**Critério de pronto:** simulações para todas as quantidades suportadas produzem exatamente um campeão, com cada inscrito avançando, recebendo bye ou sendo eliminado uma única vez.

### Módulo 16 — Conduta esportiva e penalidades
**Depende de:** Módulo 3 e Módulo 5.
**Entidades:** `RaceIncident`, `RacePenalty` e parâmetros versionados de detecção.
**Escopo:** detectar contato proposital usando velocidade relativa, direção, ponto de impacto, trajetória e oportunidade de evitar; detectar bloqueio após mais de cinco segundos parado em região relevante da pista; excluir pits, perda total, desconexão e carro estacionado em posição segura; aplicar penalidade determinística e publicar motivo/evidências mínimas no evento e resultado.
**Regra de segurança:** nenhum sinal isolado determina intenção; casos ambíguos devem gerar telemetria para revisão, não punição automática severa.
**Critério de pronto:** testes de cenários intencionais, inevitáveis e excepcionados não produzem falsos positivos nos casos documentados, e todos os clientes recebem a mesma decisão.
