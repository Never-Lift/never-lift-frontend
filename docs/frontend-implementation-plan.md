# Plano de Implementação — Frontend
### Never Lift — MVP e expansão planejada

> Este documento cobre o frontend. Ele assume conhecimento do plano de backend (`backend-implementation-plan.md`) — os dois compartilham a seção de arquitetura e o protocolo de tempo real abaixo, que **deve ser idêntico nos dois documentos**.
>
> A direção visual e de experiência aprovada está em `game-design-guide.md`. Este plano define **quando** cada decisão entra; o guia define **como** ela deve aparecer. Documentar uma expansão não autoriza implementá-la antes de seu módulo.

---

## 1. Stack e hospedagem

| Camada | Escolha | Onde roda |
|---|---|---|
| Linguagem/build | TypeScript + Vite | Vercel ou Cloudflare Pages, tier free |
| UI | React + Tailwind CSS + shadcn/ui | — |
| Renderização da corrida | Canvas 2D (API nativa), dentro de um componente React | — |
| Estado de app (conta, amigos, lobby) | React Query (ou fetch simples) sobre o REST do backend | — |
| Estado de corrida (tempo real) | Store dedicado fora do ciclo de render do React (ex.: Zustand, ou um módulo com pub/sub simples) | — |

**Por que separar o estado de corrida do estado de app:** a corrida atualiza a ~20-30x por segundo via WebSocket; se isso passar pelo re-render normal do React junto com o resto da UI, sobra performance na mesa e sobra bug de sincronização visual. O loop de desenho do Canvas roda no seu próprio `requestAnimationFrame`, lendo o store de corrida diretamente — o React só monta o `<canvas>` uma vez e não re-renderiza a cada tick.

**Por que React mesmo sendo um jogo:** o app tem muito mais tela de formulário/lista (conta, amigos, notificações, campeonato, recordes) do que tela de jogo propriamente dita. Componentes compensam aqui, diferente do protótipo que manipulava DOM na mão porque era só um jogo sem essas telas.

**Por que shadcn/ui:** não é uma dependência instalada — são componentes prontos (Radix + Tailwind por baixo) que vocês colam no próprio código e customizam livremente, o que combina bem com um projeto "quase 100% feito por IA": é uma das combinações mais documentadas do ecossistema React hoje, então o agente erra menos usando ela do que inventando componente do zero. Cobre bem formulário, diálogo de confirmação, abas, tabela e toast — ou seja, a "casca" do app nos módulos abaixo. Não ajuda em nada dentro do `<canvas>` da corrida, que continua sendo desenho manual.

---

## 2. Arquitetura de alto nível

Mesmo modelo do backend: **plano REST** pra tudo que não é corrida ao vivo, **plano tempo real** (um WebSocket por sala) pro motor de corrida, onde o servidor é a autoridade e o cliente prevê + reconcilia + interpola (ver diagramas de arquitetura discutidos antes deste plano).

Duas implementações de física existem no projeto: a do servidor (Java, autoritativa) e a do cliente (TypeScript, usada tanto pra **predição online** quanto — sozinha, sem servidor nenhum — pros **modos solo e local**). Elas precisam reproduzir as mesmas fórmulas, ordem de integração, estado dinâmico, constantes de pneus/aerodinâmica/powertrain e solver de colisão, além dos mesmos cenários de referência. Trate qualquer divergência percebida (o carro "sente" diferente entre local e online) como bug de prioridade alta, não como ajuste de sensação.

Todas as grandezas espaciais compartilhadas usam **1 unidade de mundo = 1 metro**. O `RaceEngine`, as definições de pista, checkpoints e snapshots trabalham em metros; a câmera converte metros em pixels somente na renderização. Circuitos extensos são segmentados e desenhados por visibilidade, nunca armazenados como um bitmap do tamanho do mundo inteiro.

---

## 3. Protocolo de tempo real (idêntico ao do plano de backend)

Envelope: `{ "type": "...", "payload": {...} }`.

**Cliente → Servidor:** `join_room { roomCode, trackCatalogVersion, physicsContractVersion }`, `select_loadout { color }`, `ready { ready }`, `input { throttle, brake, steer, clientSeq, clientTimestamp }` — nunca posição, só intenção. `ready` aceita `true` e `false`, pois a confirmação é reversível enquanto a sala está no lobby. O modelo do carro e o modo de condução não fazem parte do payload: toda corrida usa o mesmo F1 e a mesma configuração física. Boost/nitro não existe e propriedades desconhecidas são rejeitadas.

**Servidor → Cliente:** `room_state`, `countdown { startAtServerTime }`, `state_snapshot { tick, serverTime, physicsContractVersion, cars: [{ playerId, x, y, velocityX, velocityY, angle, speed, physicsState: { yawRate, steeringAngle, appliedThrottle, appliedBrake, frontWheelAngularSpeed, rearWheelAngularSpeed, gear, engineRpm, gearShiftTimeRemaining }, damageState: { health, engineDamaged, steeringDamaged, steeringPull, totalLoss }, lap, isGhost, inPit }] }`, `race_event`, `race_result`, `error`.

Nos snapshots, `x` e `y` são metros num plano cartesiano com `+X` para a direita e `+Y` para cima; `velocityX`/`velocityY` e `speed` usam metros por segundo; `angle` usa radianos no sentido anti-horário a partir de `+X`. Dentro de `physicsState`, `yawRate` usa radianos por segundo, `steeringAngle` é o ângulo físico das rodas dianteiras e as velocidades angulares usam radianos por segundo. Controles aplicados, rodas, marcha, RPM e transição de troca são estado autoritativo necessário à reconciliação. O frontend não converte esses valores em pixels até o estágio de câmera/renderização.

### Como o cliente usa `state_snapshot`
- **Carro do próprio jogador:** já foi desenhado localmente no instante do input (predição). Quando chega o snapshot, comparar posição prevista com a posição real; se divergir, corrigir suavemente (não teleportar) ao longo de alguns frames.
- **Carros dos outros:** nunca desenhar direto na posição recebida. Manter um pequeno buffer dos últimos 2 snapshots e interpolar entre eles, renderizando ~100ms no passado — é o que substitui o `interpolateRemote()` ingênuo do protótipo.

---

## 4. Mapa de rotas (visão geral)

`/` (menu, com guest ativo por padrão) · `/login` `/register` · `/account` · `/friends` · `/notifications` · `/records` · `/info` · `/race/setup?mode=solo|local|online` · `/race/lobby/:roomCode` · `/race/:roomCode` · `/championship/setup` · `/championship/:id`

Guest autenticado por padrão ao abrir o app (feature 2): a tela online exibe ao guest uma prévia escurecida das formas de entrada e um aviso para fazer login, sem consultar ou alterar salas. Lobby, ticket e WebSocket exigem `role: user`; demais rotas online que exigirem conta continuam sob `OnlineRoute`.

---

## 5. Módulos

Mesma numeração e dependências do plano de backend.

**Regra válida pra todo módulo, sem exceção:** nenhum módulo é considerado pronto sem testes automatizados rigorosos — testes de componente pras telas e, no Módulo 3 em especial, um teste com dois clientes simulados confirmando que reconciliação e interpolação convergem pro mesmo resultado do servidor. O "Critério de pronto" abaixo é o mínimo funcional a validar manualmente; a suíte automatizada é obrigatória em cima disso, não um substituto.

**Regra de design e fase:** antes do Módulo 2, executar a fundação visual descrita em `game-design-guide.md` numa rodada isolada, preservando os fluxos e testes dos Módulos 0 e 1. Depois disso, cada módulo implementa somente as decisões marcadas para sua fase. O status funcional do Módulo 1 continua pronto durante a modernização visual.

### Módulo 0 — Fundação e deploy
**Objetivo:** provar o pipeline Vercel/Cloudflare Pages funcionando com um build real do Vite antes de qualquer feature.
**Escopo:** scaffold Vite + React + TS + Tailwind, deploy automático a partir do Git, uma tela única consumindo `GET /api/health` do backend (Módulo 0 do backend) pra confirmar que os dois lados já se enxergam em produção.
**Critério de pronto:** URL de produção mostra "backend: ok" puxado ao vivo do Render.

### Módulo 1 — Usuários e autenticação
**Depende de:** Módulo 0 (frontend) + Módulo 1 (backend).
**Cobre features:** 2, 3 (parcial), 13.
**Telas:** `/login`, `/register` (avatar opcional), guest automático na `/`, `/account` com edição (pede senha) e exclusão (pede senha, com confirmação explícita de que é irreversível).
**Componentes:** `AuthForm`, `AvatarPicker`, `AccountEditForm` — formulários com `Form`/`Input` do shadcn/ui; exclusão de conta usando `AlertDialog` do shadcn pra confirmação (feature 3 pede "irreversível" — merece fricção de verdade, não um `confirm()` de navegador).
**Nota de design — avatares padrão (feature 13):** o conjunto atual de oito avatares chibi originais permanece válido e mantém o Módulo 1 pronto. A direção futura aprovada é substituí-los, em uma rodada visual própria, por aproximadamente oito retratos semirrealistas originais e identificados pelo mesmo `avatarId`; não misturar essa troca com funcionalidade de autenticação.
**Estado:** token JWT em memória (não em `localStorage` — recomendo cookie `httpOnly` setado pelo backend no login, mais seguro contra XSS; se o backend preferir retornar o token no corpo, guardar em variável de módulo, não em storage do navegador).
**Critério de pronto:** os três fluxos (login, registro, guest) levam ao menu principal; editar/excluir conta pedindo senha errada mostra erro sem alterar nada.

### Módulo 2 — Motor de corrida local (sem rede)
**Depende de:** Módulo 0 (frontend) + Módulo 2 (backend, catálogo versionado de pistas e persistência de resultado).
**Contrato de entrada atual:** `contracts/module-2/v2/` define `TrackDefinition` `2.0.0`, catálogo `2026.12`, constantes físicas `2.0.1`, colliders compostos, faces canônicas de barreira, aberturas físicas de pit, face traseira `pitLane.garageBarrier` das garagens, placas métricas de frenagem e perfis visuais métricos de infraestrutura. O frontend consome as 24 geometrias pela API e mantém localmente somente os artefatos comuns do contrato; `contracts/module-2/v1/` preserva o runtime `1.3.0` como histórico imutável.
**Estado da entrega:** pronto. As Partes 2a, 2b, 2c e 2d, a física `2.0.0` e o catálogo `2026.12` foram validados manualmente de forma integrada em 31/08/2026. A revisão `2.0.1` recalibra somente dano e desvio de direção, tem validação automatizada e aguarda confirmação manual. A simplificação para F1 único/condução única, o refinamento de câmera 2.5D/F1 multidirecional e a revisão de segurança visual das 24 pistas estão concluídos: zebras autorais, faixas contínuas de muro/grade, placas completas por curva, largada de Silverstone reposicionada, Marina Bay orientada no sentido anti-horário, entradas/saídas navegáveis do pit, 22 vãos opacos de garagem por circuito com face traseira colidível e remoção do escape provisório do Rettifilo de Monza. A reorganização do setup solo/local e do HUD foi automatizada em 02/09/2026, com validação visual da preview pendente; isso não reabre o critério funcional já aprovado do módulo. A Parte 2d e o Módulo 2 permanecem prontos; a Parte 3a foi validada manualmente em dois navegadores e está pronta desde 03/09/2026, enquanto 3b/3c permanecem pendentes.

**Simplificação implementada em 24/08/2026 (frontend #90 / backend #72):** o produto tem somente o F1 e uma configuração fixa de condução que preserva os valores do antigo perfil Normal. A seleção Normal/Drift, os perfis visuais Supercarro/Drift e qualquer dimensão competitiva baseada em modelo ou handling foram removidos. O contrato físico incompatível `1.3.0` foi publicado de forma sincronizada nos dois repositórios.

**Refinamento visual implementado:** a câmera deixa de usar uma projeção ortográfica uniforme e passa a aplicar uma perspectiva 2.5D fixa de `42°` a partir da vista superior, comprimindo a profundidade para aproximadamente `0,743` sem alterar coordenadas, física, colisões ou contratos. O carro focado fica em `68%` da viewport para exibir pouco mais que o dobro de pista à frente em relação à traseira. A orientação depende somente do vetor de movimento, com retenção em baixa velocidade, atraso inicial em inversão sustentada e limite de giro por frame. O F1 provisório foi substituído por um modelo Canvas original detalhado cuja geometria usa continuamente o ângulo relativo a cada câmera, sem degraus entre poses, com volumes aerodinâmicos integrados, frente, traseira, laterais, pneus, rodas, suspensão, asas multicamada, assoalho, difusor, sidepods, cockpit, capacete e halo completos. A pintura do MVP oferece somente vermelho, azul ou verde em tons sóbrios e deriva os detalhes da própria cor selecionada, sem acentos neon concorrentes. Pista, zebras, barreiras, grades, marcas de pneu e ordenação dos carros usam a mesma projeção; split-screen continua com uma câmera independente por jogador.

**Parte 2d — implementação e validação manual concluídas em 31/08/2026:** o integrador cinemático v1.3 foi substituído por corpo rígido 2D com modelo de bicicleta dinâmico, pneus não lineares, aderência longitudinal/lateral combinada, transferência de carga, drag/downforce, powertrain traseiro com oito marchas automáticas, travamento sem ABS e patinagem sem controle de tração. Boost/nitro foi removido e `Shift` não possui função. Colliders convexos compostos acompanham a silhueta; faces canônicas de barreira são compartilhadas com o renderer; manifold, impulso no ponto de contato, torque, solver iterativo e CCD compõem a colisão v2. `physicsContractVersion` é persistida, cenários determinísticos foram publicados e todas as constantes do planejador dos bots estão no contrato; dificuldade altera somente decisões. Os cenários de física, colisão, câmera, minimapa, culling, circuitos curto/longo/urbano, bots e split-screen foram validados manualmente conforme o critério de pronto.

**Refinamento de interface de 02/09/2026:** o setup solo/local concentra modo, pinturas, pista, quantidade de bots, dificuldade, horário e início em um painel único; aceita zero bots e limita o grid a 22 carros. A escolha de pista compartilha com o lobby online um carrossel pesquisável e arrastável, sem truncar a rolagem após a seleção, enquanto a prévia fixa identifica largada e sentido. Durante a corrida, o cabeçalho e os rótulos permanentes sobre os carros foram removidos; os nomes ficam visíveis na contagem e, depois, somente ao segurar `Espaço`. O minimapa ampliado inclui linha de chegada e nome do circuito e a saída virou um controle compacto no canto inferior direito. Testes automatizados e build validam a entrega; conferência visual na preview permanece pendente.

**Parte 2a entregue — registro histórico anterior à decisão #90/#72:** `RaceEngine` determinístico a `1/60s`, interpolação entre ticks, física única para todos os modelos, superfícies do contrato v1.2, escolha normal/drift aplicada à corrida inteira, colisões de carros e barreiras, dano mecânico cumulativo, oval técnico temporário, seleção visual dos três modelos e cores, bots determinísticos, dois jogadores com controles distintos, corrida curta completa e persistência em `POST /api/races/local-result`. O motor e o Canvas mantêm posições e velocidades fora do estado React. A equivalência a 30/60/120 FPS, a equidade entre modelos, as regras físicas, os inputs, as colisões, os dois modos e o payload REST possuem cobertura automatizada.

**Limite da Parte 2a:** o oval usava provisoriamente o identificador de catálogo `albert-park` apenas para que o resultado técnico fosse aceito pelo contrato do backend. Ao fim da Parte 2a, split-screen com câmera individual, catálogo/24 pistas, minimapa e culling ainda estavam pendentes para a Parte 2b; semáforo, noite, partículas temáticas e alertas visuais permanecem pendentes para a Parte 2c.
**Parte 2b implementada:** `GET /api/tracks` e `GET /api/tracks/{id}` tipados pelo contrato real; preparação com as 24 pistas, metadados, ambiente e prévia; `TrackDefinition` injetada no `RaceEngine`; grid, largura, superfícies, checkpoints direcionais, `racingLine`, `curbs` e `trackLimits` oficiais; câmera por jogador suavizada em `0,25s`, carro limitado inicialmente a 6% da altura e enquadramento revisado em `68%`; minimapa fixo; split vertical ou horizontal no limite `1,35`; e renderização vetorial somente dos `chunks` visíveis. O resultado usa o `id` e a `catalogVersion` selecionados. As auditorias `2026.4`/`2026.5` renderizavam, por trecho e lado, asfalto externo, grama, brita, barreiras, grade externa, zebras e landmarks específicos por pista; a centerline suavizada e reamostrada a aproximadamente 5 m orienta pista e entornos. Esse registro descreve a entrega original v1.3. A Parte 2d publicou as faces canônicas no catálogo `2026.6`; `2026.7` corrigiu continuidade/sobreposição estrutural, zebras, pits, pontes, escape de Monza e largada de Mônaco; `2026.8` acrescentou identidade de box, arquibancadas, cercas e transparência contextual; `2026.9` publicou perfis de zebra por curva. O `2026.10` estabiliza as faces canônicas nas curvas apertadas, extruda muros/grades como faixas contínuas, publica placas regressivas de frenagem, remove as pontas escuras da estrutura de Suzuka e abre a proteção de Monza no corredor do Rettifilo. O escape de Monza sai reto da aproximação e reconecta depois da chicane; usa o mesmo asfalto da pista, blocos brancos com chevrons vermelhos e muro colidível apenas na borda externa. O `2026.11` acrescenta aberturas derivadas de `pit-entry`/`pit-exit` em todas as pistas, 22 vãos de garagem opacos (duas vagas por equipe) em arquitetura híbrida específica por circuito e a face física traseira de cada shell, sem bloquear o corredor navegável. O `2026.12` completa as placas solicitadas, corrige as origens de largada de Silverstone e Marina Bay e remove o escape provisório de Monza. As placas foram ampliadas no renderer sem mudar sua posição métrica. A implementação automatizada está concluída; a validação manual permanece pendente.
**Parte 2c implementada:** presets de dia, entardecer e noite; cone de farol limitado à pista e ocluso por níveis superiores; partículas ambientais com orçamento por qualidade; semáforo de largada e penalidade de largada queimada; alertas visuais e telemetria de dano sem alterar o estado físico.
**Limite da Parte 2b:** não inclui semáforo, largada queimada, presets visuais de horário, iluminação noturna, partículas temáticas nem alertas visuais completos de dano. Esses itens permanecem exclusivamente na Parte 2c ou no módulo indicado pelo guia de design.
**Cobre features:** 4 (solo/local), 5, 6 (menos vácuo, que só existe com outro jogador real), 14, 15, 16, 17, 18, 21, 22, 23, 24.
**Este módulo é o motor físico do jogo novo, escrito do zero em TypeScript — o protótipo entra só como referência de sensação/comportamento esperado, não como código a converter (isso não é uma versão do jogo antigo). Nenhuma rede envolvida aqui.**
**Escopo:**
- `RaceEngine` em TS: passo fixo desacoplado do `requestAnimationFrame`, com opção final entre `1/60s` e `1/120s` congelada somente após benchmark. O integrador v2 calcula corpo rígido, yaw, esterço físico, pneus por eixo, combined slip, transferência de carga, aerodinâmica, powertrain e frenagem. Existe uma única configuração física, aplicada igualmente a humanos e bots e reproduzida pelo backend; não há modo selecionável. A renderização apenas interpola os dois últimos estados.
- Input: WASD **e** setas simultaneamente habilitados; esquerda produz esterço à esquerda nos dois mapeamentos. Rampas determinísticas permitem modular comandos digitais sem impedir perda de aderência. `Shift` não é capturado e não possui função; não existe boost, nitro ou freio de mão.
- Modo local com colisão entre carros. O split-screen usa divisão vertical em telas largas e horizontal quando a razão de aspecto for menor que `1.35`; cada jogador possui câmera própria.
- Renderização: pista, carro, sujeira de pneu, partículas — com o protótipo como referência visual de ponto de partida, não como código reaproveitado diretamente.
- Carregar metadados por `GET /api/tracks` e a definição selecionada por `GET /api/tracks/{id}`; manter a `trackCatalogVersion` da definição para entrar em salas e registrar resultados. O motor local não depende do backend depois que a pista foi carregada.
- Coordenadas, dimensões, distância e velocidade usam metros e segundos; escala de câmera não pode afetar física ou colisão.
- Câmera top-down levemente inclinada em projeção 2.5D, acompanhando posição e exclusivamente a direção de movimento com suavização, zoom fixo e tratamento estável para parada, inversão e rodadas. O F1 usa uma vista relativa própria em cada viewport, inclusive no split-screen. Os valores de projeção, enquadramento e tamanho do carro são calibrações documentadas em `game-design-guide.md`.
- Minimap de orientação fixa com traçado completo, jogador e bots, derivado das mesmas coordenadas do mundo.
- Renderização por trechos com culling de pista, cenário e partículas fora da área visível; resolução interna limitada e ajustável por nível de qualidade.
- Semáforo de largada (não contagem regressiva): sequência de luzes; largada queimada trava o acelerador por 5s.
- Cone de luz dinâmico à frente do carro em pistas noturnas; escurecimento controlado do restante da pista, sem depender de blur pesado de tela inteira.
- Um único F1 é usado por todos. Antes de correr, o jogador escolhe somente uma pintura predefinida entre vermelho, azul ou verde, aplicada também ao capacete; detalhes visuais usam variações tonais da cor escolhida e não existe seleção de modelo. Massa, aceleração, potência, frenagem, esterço, pneus, aero e colisores são únicos.
- O collider do monoposto é uma união de convexos métricos cobrindo asa, bico, rodas, chassi e traseira, alinhada ao modelo visual dentro de `2–5 cm`. As barreiras publicam a face voltada à pista e renderer/colisão usam a mesma polilinha. CCD, manifold e impulsos no ponto de contato impedem atravessamento, contato invisível e enrosco; impactos excêntricos geram rotação.
- Catálogo `2026.5` congelado com as 24 etapas do calendário original de 2026, incluindo Bahrain e Jeddah mesmo diante de alterações posteriores no calendário real. Os traçados são reconhecíveis, têm comprimentos variados e escala métrica aproximada. `trackLimits` cobre toda a volta e descreve zonas laterais auditadas de asfalto, grama ou brita antes da barreira de impacto, com grade externa opcional em campo próprio; `curbs` descreve zebras por distância, lado, largura, cadência e paleta; `sceneryLayout` publica landmarks semânticos específicos e ancorados à pista. A centerline recebe suavização fechada e amostragem aproximada de 5 m, compartilhada por asfalto, entornos e proteções. As fontes ficam na definição. Pequenos ajustes de 10–20% são permitidos quando necessários à jogabilidade; uma futura distribuição pública exige revisão de nomes e apresentação.
- Cenário semirrealista simples: superfície limpa, limites legíveis, pontos marcantes próximos e áreas distantes de baixo detalhe; objetos ambientais estáticos.
- Impactos classificam dano mecânico cumulativo pelo impulso/energia ou `delta-v` do contato e reduzem uma barra de vida: fraco danifica direção, médio danifica motor, alto combina motor e direção e crítico causa perda total; impactos menores repetidos também podem zerar a vida. Falhas nunca são substituídas nem curadas por nova colisão. O Módulo 5 acrescenta reparo em pits e regras de corrida associadas.
- Bots usam a linha de corrida e planejam velocidade por curvatura, ponto de frenagem, tangência, aplicação de acelerador e recuperação. Dificuldade maior melhora decisões e execução, nunca física ou tolerância de contato.
**Testes obrigatórios específicos:** equivalência do resultado com renderização a 30/60/120 FPS; curva de aceleração e velocidade terminal; frenagem e travamento; curva constante, subesterço, sobresterço de potência, lift-off e transições de superfície; colisões centrais/excêntricas carro–carro e carro–muro; contato no bico/asa/roda, CCD sem tunneling, raspão sem enrosco e folga sem falso positivo em Mônaco; transformação mundo→câmera 2.5D e mundo→minimap; estabilidade da câmera; alinhamento collider↔silhueta; circuito curto, longo e urbano concluídos por humanos e bots.
**Critério de pronto:** correr sozinho contra bots ou em split-screen local do início ao fim em circuito de baixa e alta velocidade e em uma pista urbana; acelerar continuamente não produz volta competitiva; frenagem, tangência e retomada são necessárias; perdas dianteira/traseira e contatos têm causa física legível; não há sobreposição, colisão invisível, enrosco ou tunneling; câmera/minimap/culling permanecem estáveis; `Shift` não envia nem executa ação.

### Módulo 3 — Motor autoritativo online (núcleo)
**Depende de:** Módulo 1, Módulo 2, Módulo 3 do backend.
**Cobre features:** 4 (lobby online), 8.
**Decisões aprovadas:** o registro completo das 80 decisões desta rodada está em
[`module-3-online-decisions.md`](module-3-online-decisions.md). Ele é normativo
para a implementação, mas não altera o status: o Módulo 3 continua em andamento.

**Estado da Parte 3a:** sala e protocolo, incluindo o refinamento de acesso e configuração de 02/09/2026, implementados no frontend e validados
manualmente em dois navegadores em 03/09/2026; a Parte 3a está pronta. A tela de
`/race/setup?mode=online` lista e cria salas; `/race/lobby/:roomCode` mantém o
lobby conectado por WebSocket. A criação define somente nome e visibilidade;
salas privadas usam apenas o código como segredo, sem senha. Pista, grid e bots são configurados pelo host dentro da sala e sincronizados automaticamente. A sessão WebSocket vive
fora da página e permanece ativa durante a navegação; a saída normal ocorre somente
pelo comando explícito com confirmação. O cliente obtém `POST /api/rooms/{code}/connection-ticket`
antes do handshake, usa apenas o ticket temporário na URL, reconecta dentro da
janela de 30 s, e cobre pronto/permissões do host sem iniciar física. As Partes
3b (motor físico autoritativo) e 3c (classificação e fluxo de corrida) continuam
pendentes.
**Escopo:**
- Cliente WebSocket com reconexão automática (backoff simples), obtendo antes um ticket de uso único vinculado à sala/usuário (validade de 60 s) em vez de expor o JWT principal.
- Lobby: acesso restrito a contas; guest vê somente a prévia bloqueada. A lista pública mostra nome, host e ocupação e permite entrada direta; salas privadas são descobertas exclusivamente pelo código de quatro dígitos, sem senha. Cada sala aceita até 22 carros (humanos e bots), com grid de 2 a 22 normalizado no cliente e validado no servidor. O host não marca pronto e inicia quando todos os demais humanos estiverem `ready`; convidados podem confirmar ou retirar o pronto. O host edita pista por carrossel de traçados, grid, bots/dificuldade e visibilidade durante todo o lobby, sem botão de salvar e sem limpar confirmações, com propagação automática a todos. As configurações travam ao iniciar a classificação; o host pode cancelá-la e reabrir o lobby somente antes de qualquer carro começar a andar. Host e participantes comuns podem sair explicitamente, com transferência automática do host. Entrada, saída, remoção e configuração são propagadas imediatamente; desconexão reserva a vaga somente durante a janela de reconexão. Avisos e erros usam notificações no canto superior direito, expiram em 5 s e aceitam fechamento manual.
- Classificação simultânea e isolada: uma tentativa de até 3 minutos por participante, com contagem sincronizada de 3 s, lançamento padronizado antes da linha, mesmas condições secas da corrida e ordenação do grid por tempo autoritativo. Voltas inválidas ficam no fim em ordem determinística.
- Fluxo de corrida: três voltas, sentido oficial, sem entrada tardia, sem pausa ou reinício manual; após a chegada o carro vira `ghost`, os resultados ficam visíveis por confirmação ou no máximo 60 s e a sala retorna ao lobby.
- **Predição:** ao apertar uma tecla, o `RaceEngine` do Módulo 2 já simula o carro do próprio jogador imediatamente e envia `input` pro servidor.
- **Compatibilidade:** `join_room` envia `physicsContractVersion`; servidor rejeita cliente com física incompatível antes da corrida.
- **Reconciliação:** ao chegar `state_snapshot`, comparar posição, velocidade, ângulo e todo `physicsState` previsto com o estado autoritativo; reaplicar inputs ainda não confirmados e corrigir erro visual suavemente, sem esconder divergência persistente de motor.
- **Interpolação:** carros remotos desenhados ~100ms atrás, interpolando entre os dois snapshots mais recentes — nunca perseguindo um alvo cru como no protótipo.
- Reaproveita o mesmo `RaceEngine` do Módulo 2 como motor de predição — não duplicar a física numa segunda implementação dentro do próprio frontend.
- Minimap online transforma as posições interpoladas dos snapshots na mesma projeção fixa usada no modo local; nunca mantém um estado paralelo de posição.
- Transporte: servidor a 30 ticks/s com subpassos de 1/120 s, inputs a 30 Hz, snapshots a 20 Hz, heartbeat a cada 10 s, ticket de uso único vinculado à sala/usuário com validade de 60 s e janela de reconexão de aproximadamente 30 s. O servidor valida/normaliza inputs e mantém o último comando por aproximadamente 150–250 ms antes de neutralizar gradualmente.
- A corrida usa o pit lane navegável sem limite de velocidade ou serviço no M3; cortes respeitam checkpoints e limites, invalidam a quali e não concedem progresso até o retorno válido. O estado físico é restaurado entre quali e corrida.
**Critério de pronto:** dois navegadores, mesma sala e mesma versão física convergem em trajetória, perda de aderência e colisões; clientes incompatíveis não entram e o mesmo contato produz resultado autoritativo nas duas telas.

### Módulo 4 — Ambiente e modo caos
**Depende de:** Módulo 3.
**Cobre features:** 4 (dia/noite/chuva/sol/caos completo em multiplayer).
**Escopo:** tela compartilhada de preparação adaptada ao tipo de prova, com painel lateral de resumo; host edita bots/dificuldade/voltas/pista/período/clima. Não existe campo de modo de condução. O checkbox de modo caos desabilita visualmente os outros campos (`settingsLocked` vindo do backend) e mostra aviso de que tudo será sorteado. Período é um preset fixo por corrida (dia/entardecer/noite). Vento, chuva, spray, poças de óleo e caixas são renderizados com efeitos limitados por qualidade e recebidos do servidor quando autoritativos — nunca sorteados no cliente. Chuva e superfícies molhadas modulam os parâmetros de pneu/aderência do contrato v2, sem criar uma segunda física.
**Critério de pronto:** ativar modo caos na UI reflete exatamente os obstáculos que o servidor decidiu, iguais nas telas de todos os jogadores da sala.

### Módulo 5 — Corrida completa (dano, vácuo, fantasma, pits, HUD)
**Depende de:** Módulo 3.
**Cobre features:** 5 (feedback visual), 6, 7, 15 (aplicado online), 24.
**Escopo:**
- HUD periférico e compacto: posição, competidores, volta atual/total, tempo atual/melhor, velocidade e minimapa; dano e penalidades aparecem somente quando relevantes. Classificação detalhada não deve ocupar permanentemente o centro da corrida. Não existe indicador de boost/nitro.
- Vácuo reduz moderadamente o arrasto no modelo aerodinâmico v2 quando as condições autoritativas forem atendidas; nunca concede força extra independente da física.
- Renderização simples de dano por estado (`damageState` do snapshot): marcas discretas/fumaça leve, estado crítico mais visível e carro escurecido/parado na perda total; sem deformação complexa ou peças destacáveis.
- Ao `race_event: finished`, o próprio carro vira visualmente fantasma (transparência); a UI só desenha fantasma de quem também já terminou, conforme a regra de colisão do Módulo 5 do backend.
- Pódio final e resultado na mesma composição: top 3 em degraus, demais participantes em lista compacta, tempo total, melhor volta, penalidades e próximas ações.
**Critério de pronto:** HUD reflete sem atraso perceptível todos os campos do snapshot que têm representação de interface; pódio final renderiza corretamente com 2, 3 ou 4 jogadores.

### Módulo 6 — Campeonatos
**Depende de:** Módulo 3, Módulo 5.
**Cobre features:** 9, 20.
**Telas:** `/championship/setup` com biblioteca pesquisável de circuitos e calendário ordenável de até 24 etapas, com repetição permitida; `/championship/:id` combina calendário, tabela de pontos, próxima corrida, etapa anterior e grid calculado.
**Critério de pronto:** entre uma corrida e outra do campeonato, a tela mostra corretamente o grid invertido da corrida anterior antes do host iniciar a próxima.

### Módulo 7 — Social (amigos e notificações)
**Depende de:** Módulo 1.
**Cobre features:** 11, 12.
**Telas:** área Social com amigos, solicitações e notificações; lista compacta de amigos com painel de detalhes, busca por gamertag e convite pra sala; central mantém itens lidos/não lidos.
**Componente:** `NotificationToast` (componente `Toast` do shadcn/ui) — escuta o evento `type: notification` do WebSocket (se o usuário estiver conectado a qualquer sala/lobby) e mostra por 5s ou até fechar manualmente; se não estiver conectado a nada no momento do envio, só aparece ao entrar na aba depois.
**Critério de pronto:** convite de outro usuário aparece como toast em tempo real se eu estiver com o app aberto, e como pendente na aba se eu abrir depois.

### Módulo 8 — Perfil, recordes e histórico
**Depende de:** Módulo 6.
**Cobre features:** 3 (estatísticas), 10, 26.
**Telas:** Perfil híbrido com identidade e abas de visão geral/estatísticas/histórico; `/records` com top 3 discreto, tabelas filtráveis e marca pessoal fácil de localizar; histórico paginado dentro do perfil privado. Recordes e melhores tempos exibem a `physicsContractVersion` ativa e nunca misturam versões incompatíveis; resultados antigos aparecem somente em filtro/histórico identificado.
**Critério de pronto:** as três telas consomem os endpoints do Módulo 8 do backend e atualizam depois de uma corrida/campeonato novo, mantendo tempos de versões físicas diferentes em classificações separadas.

### Módulo 9 — Polimento e i18n
**Depende de:** todos os anteriores.
**Cobre features:** 25, 27.
**Escopo:** `/info` com regras gerais pra iniciante; troca de idioma (PT/EN) em `/account`, com biblioteca de i18n simples (ex. dicionário de chaves por idioma) — código-fonte permanece em inglês, só a camada de texto exibido troca; revisão final de 16:9/16:10/ultrawide, resolução interna adaptável, carregamentos minimalistas, erros contextuais e estados vazios com ação útil (usando as chaves que o Módulo 9 do backend passou a retornar).
**Critério de pronto:** trocar o idioma na conta muda todo texto visível, sem precisar de reload nem afetar nomenclatura interna do código.

---

## 6. Expansão aprovada (pós-MVP)

Os Módulos 0–9 continuam formando o MVP original. Os módulos abaixo registram funcionalidades aprovadas para uma fase posterior e não bloqueiam a conclusão do Módulo 9. Todos permanecem sujeitos às mesmas regras de testes, validação manual, PR isolado e sincronização de contrato com o backend.

### Módulo 10 — Progressão, personalização e medalhas
**Depende de:** Módulo 5, Módulo 6 e Módulo 8 dos dois repositórios.
**Escopo:**
- Toda conta usa o mesmo F1; não há catálogo nem desbloqueio de outros modelos de carro.
- Área de personalização com o F1 em destaque, rotação manual, painel de informações úteis e prévia imediata + Salvar/Descartar.
- Tela de conquistas com categorias, cards compactos, progresso, requisito, raridade, recompensa e painel de detalhes; concluir conquistas pode liberar pinturas, capacetes, acabamentos e outras recompensas exclusivamente cosméticas.
- Medalhas por idade da conta calculadas a partir de `createdAt`, sem confundir idade da conta com horas efetivamente jogadas.
- Seletor de até três medalhas para exibição pública no perfil, lobby, pódio e cartão do piloto; forma representa a conquista e material representa a raridade (bronze, prata, ouro, titânio escuro); a seleção pode ser alterada a qualquer momento.
- Nenhuma recompensa altera física, velocidade, dano ou qualquer vantagem competitiva.
**Testes obrigatórios:** cobrir F1 único, bloqueios/desbloqueios cosméticos, progresso, idempotência da recompensa e seleção de no máximo três medalhas.
**Critério de pronto:** uma conquista válida libera sua recompensa cosmética uma única vez e as três medalhas escolhidas aparecem de forma consistente para outros usuários.

### Módulo 11 — Contrarrelógio e fantasmas
**Depende de:** Módulo 2, Módulo 7, Módulo 8 e Módulo 11 do backend.
**Rotas:** `/time-trial`, `/time-trial/:trackId`.
**Escopo:**
- Salvar melhor tempo e trajetória por jogador, circuito, versão de física e condições determinísticas; modelo e modo de condução não são dimensões porque são únicos.
- Correr por padrão contra o fantasma do próprio recorde; permitir selecionar o recorde de um amigo quando houver permissão.
- Tela com lista compacta de circuitos, prévia detalhada e seleção separada entre fantasma pessoal e fantasmas de amigos; apenas um fantasma por tentativa.
- O fantasma é somente visual: não colide, não afeta física e não participa da classificação da corrida.
- Exibir diferença de tempo em tempo real, volta válida/inválida e comparação ao final.
- Enviar inputs/telemetria compactados para validação do backend; tempo não validado nunca entra em ranking ou desafio compartilhável.
**Testes obrigatórios:** cobrir reprodução determinística, invalidação por corte de pista, escolha de fantasma próprio/amigo e isolamento entre versões de física.
**Critério de pronto:** repetir uma trajetória validada produz o mesmo fantasma e o recorde só é substituído por uma volta válida mais rápida.

### Módulo 12 — Controles personalizáveis
**Responsabilidade:** exclusivamente frontend; não exige endpoint nem alteração no backend.
**Depende de:** Módulo 2.
**Escopo:**
- Tela de configuração para acelerador, freio/ré, esquerda, direita e demais ações existentes de corrida; `Shift` é explicitamente ignorado, não pode ser vinculado a nenhuma ação e boost/nitro não aparece como ação.
- Suportar teclado, botões do mouse ou combinação dos dois; cliques usados pela interface não podem acionar comandos da corrida.
- Detectar conflitos de teclas/botões e oferecer explicitamente Trocar ou Cancelar; permitir restaurar padrões e oferecer perfis distintos para os dois jogadores do modo local.
- Persistir preferências localmente de forma versionada e fornecer fallback seguro quando um mapeamento antigo ficar incompatível.
**Testes obrigatórios:** cobrir captura de tecla/botão, conflitos, restauração, dois perfis locais e bloqueio de input enquanto o usuário digita em formulário.
**Critério de pronto:** o jogador consegue terminar uma corrida com um mapeamento personalizado de teclado, mouse ou ambos sem ações duplicadas.

### Módulo 13 — Modo espectador para amigos
**Depende de:** Módulo 3, Módulo 5, Módulo 7 e Módulo 13 do backend.
**Escopo:**
- Exibir a opção de assistir somente em partidas elegíveis de amigos adicionados.
- Entrar como espectador não ocupa vaga de piloto, não recebe controles de corrida e nunca pode enviar `input`.
- Permitir alternar entre carros usando a mesma câmera dinâmica do piloto selecionado; mostrar HUD reduzido com classificação, voltas, tempos, condição da conexão e atraso proposital da transmissão.
- Tratar corrida encerrada, sala privada, remoção da amizade, desconexão e limite de espectadores.
**Testes obrigatórios:** cobrir autorização, ausência de input, troca de câmera e remoção ao perder acesso.
**Critério de pronto:** um amigo autorizado acompanha a corrida sem interferir na simulação e vê estado coerente com os snapshots atrasados do servidor.

### Módulo 14 — Equipes e placar coletivo
**Depende de:** Módulo 7, Módulo 8 e Módulo 14 do backend.
**Rotas:** `/teams`, `/teams/:id`.
**Escopo:**
- Criar equipe com nome e sigla únicos, cor principal e emblema escolhido em catálogo predefinido; convidar amigos, aceitar/recusar convites, sair e gerenciar membros conforme permissões.
- Exibir perfil da equipe, membros, resultados recentes, estatísticas resumidas e placar coletivo em um painel único.
- O placar soma somente estatísticas elegíveis definidas pelo backend e deixa a fórmula visível; alterações de equipe não podem duplicar resultados históricos.
- Aplicar limites de membros e regras claras para transferência de liderança e exclusão da equipe.
**Testes obrigatórios:** cobrir convites, permissões, mudanças de membro, paginação e consistência do placar.
**Critério de pronto:** resultados elegíveis dos membros atualizam o placar sem duplicidade e usuários sem permissão não alteram a equipe.

### Módulo 15 — Torneios oficiais automáticos
**Depende de:** Módulo 4, Módulo 5, Módulo 6, Módulo 13, Módulo 14 e Módulo 15 do backend.
**Rotas:** `/tournaments`, `/tournaments/:id`.
**Escopo:**
- Listar torneios oficiais gerados em horários predefinidos, com inscrição, check-in, regras sorteadas pelo servidor e chave visual em colunas por rodada, usando um card por bateria.
- Cada bateria comporta no máximo quatro pilotos e classifica os dois primeiros; o sistema mostra byes ou classificatória quando o total não forma uma chave perfeita.
- O limite máximo global de inscritos fica configurável e explicitamente pendente de definição de produto/capacidade, nunca codificado como suposição.
- Eliminados podem acompanhar baterias seguintes pelo modo espectador; abandono, empate, desconexão e ausência no check-in têm regras visíveis.
**Testes obrigatórios:** cobrir cálculo de chave para quantidades pares/ímpares, progressão dos dois primeiros, empate, bye, check-in e atualização em tempo real.
**Critério de pronto:** para qualquer quantidade aceita de inscritos, a chave termina com um campeão sem perder, duplicar ou classificar incorretamente participantes.

### Módulo 16 — Conduta esportiva e penalidades
**Depende de:** Módulo 3, Módulo 5 e Módulo 16 do backend.
**Escopo:**
- Exibir aviso curto e não bloqueante durante a corrida e explicação objetiva integrada ao resultado, sempre decididos exclusivamente pelo servidor, com motivo, intensidade, momento do incidente e efeito aplicado.
- Diferenciar colisão proposital de contato inevitável usando contexto autoritativo; o cliente nunca decide culpa.
- Alertar bloqueio somente quando o carro permanece por mais de cinco segundos na trajetória relevante e pode se mover; pits, perda total, desconexão e posição segura fora da linha não contam.
- Mostrar histórico pós-corrida e permitir contestação futura sem pausar a corrida.
**Testes obrigatórios:** cobrir apresentação dos motivos, exceções de bloqueio e impossibilidade de o cliente forjar/remover penalidade.
**Critério de pronto:** todos os participantes recebem a mesma decisão autoritativa e nenhuma exceção documentada gera penalidade por bloqueio.
