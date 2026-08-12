# Plano de Implementação — Frontend
### Never Lift — MVP e expansão planejada

> Este documento cobre o frontend. Ele assume conhecimento do plano de backend (`backend-implementation-plan.md`) — os dois compartilham a seção de arquitetura e o protocolo de tempo real abaixo, que **deve ser idêntico nos dois documentos**.

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

Duas implementações de física existem no projeto: a do servidor (Java, autoritativa) e a do cliente (TypeScript, usada tanto pra **predição online** quanto — sozinha, sem servidor nenhum — pros **modos solo e local**). Elas precisam ter exatamente as mesmas constantes de atrito, arrasto, aceleração e drift que o motor do backend. Trate qualquer divergência percebida (o carro "sente" diferente entre local e online) como bug de prioridade alta, não como ajuste de sensação.

---

## 3. Protocolo de tempo real (idêntico ao do plano de backend)

Envelope: `{ "type": "...", "payload": {...} }`.

**Cliente → Servidor:** `join_room`, `select_loadout`, `ready`, `input { throttle, brake, steer, nitro, clientSeq, clientTimestamp }` — nunca posição, só intenção.

**Servidor → Cliente:** `room_state`, `countdown { startAtServerTime }`, `state_snapshot { tick, serverTime, cars[] }`, `race_event`, `race_result`, `error`.

### Como o cliente usa `state_snapshot`
- **Carro do próprio jogador:** já foi desenhado localmente no instante do input (predição). Quando chega o snapshot, comparar posição prevista com a posição real; se divergir, corrigir suavemente (não teleportar) ao longo de alguns frames.
- **Carros dos outros:** nunca desenhar direto na posição recebida. Manter um pequeno buffer dos últimos 2 snapshots e interpolar entre eles, renderizando ~100ms no passado — é o que substitui o `interpolateRemote()` ingênuo do protótipo.

---

## 4. Mapa de rotas (visão geral)

`/` (menu, com guest ativo por padrão) · `/login` `/register` · `/account` · `/friends` · `/notifications` · `/records` · `/info` · `/race/setup?mode=solo|local|online` · `/race/lobby/:roomCode` · `/race/:roomCode` · `/championship/setup` · `/championship/:id`

Guest autenticado por padrão ao abrir o app (feature 2): rotas de `online` redirecionam pra `/login` com mensagem "Faça login para liberar" se a claim JWT for `role: guest`.

---

## 5. Módulos

Mesma numeração e dependências do plano de backend.

**Regra válida pra todo módulo, sem exceção:** nenhum módulo é considerado pronto sem testes automatizados rigorosos — testes de componente pras telas e, no Módulo 3 em especial, um teste com dois clientes simulados confirmando que reconciliação e interpolação convergem pro mesmo resultado do servidor. O "Critério de pronto" abaixo é o mínimo funcional a validar manualmente; a suíte automatizada é obrigatória em cima disso, não um substituto.

### Módulo 0 — Fundação e deploy
**Objetivo:** provar o pipeline Vercel/Cloudflare Pages funcionando com um build real do Vite antes de qualquer feature.
**Escopo:** scaffold Vite + React + TS + Tailwind, deploy automático a partir do Git, uma tela única consumindo `GET /api/health` do backend (Módulo 0 do backend) pra confirmar que os dois lados já se enxergam em produção.
**Critério de pronto:** URL de produção mostra "backend: ok" puxado ao vivo do Render.

### Módulo 1 — Usuários e autenticação
**Depende de:** Módulo 0 (frontend) + Módulo 1 (backend).
**Cobre features:** 2, 3 (parcial), 13.
**Telas:** `/login`, `/register` (avatar opcional), guest automático na `/`, `/account` com edição (pede senha) e exclusão (pede senha, com confirmação explícita de que é irreversível).
**Componentes:** `AuthForm`, `AvatarPicker`, `AccountEditForm` — formulários com `Form`/`Input` do shadcn/ui; exclusão de conta usando `AlertDialog` do shadcn pra confirmação (feature 3 pede "irreversível" — merece fricção de verdade, não um `confirm()` de navegador).
**Nota de design — avatares padrão (feature 13):** o pedido original cita personagens "cabeçudos" inspirados em pilotos famosos. Usar a semelhança de uma pessoa real (viva ou histórica) sem autorização é terreno legal incerto e eu evitaria — a recomendação é um conjunto de 6 a 8 avatares estilo chibi **originais**, com arquétipos genéricos (piloto de F1, drifter, mecânico etc.) em vez de caricaturas de gente real. Mesmo efeito visual pretendido, sem o risco.
**Estado:** token JWT em memória (não em `localStorage` — recomendo cookie `httpOnly` setado pelo backend no login, mais seguro contra XSS; se o backend preferir retornar o token no corpo, guardar em variável de módulo, não em storage do navegador).
**Critério de pronto:** os três fluxos (login, registro, guest) levam ao menu principal; editar/excluir conta pedindo senha errada mostra erro sem alterar nada.

### Módulo 2 — Motor de corrida local (sem rede)
**Depende de:** Módulo 0.
**Cobre features:** 4 (solo/local), 5, 6 (menos vácuo, que só existe com outro jogador real), 14, 15, 16, 17, 18, 21, 22, 23, 24.
**Este módulo é o motor físico do jogo novo, escrito do zero em TypeScript — o protótipo entra só como referência de sensação/comportamento esperado, não como código a converter (isso não é uma versão do jogo antigo). Nenhuma rede envolvida aqui.**
**Escopo:**
- `RaceEngine` em TS: passo de física em **delta de tempo fixo** (ex. `1/60s`), desacoplado do `requestAnimationFrame` — corrige o problema do protótipo onde a física dependia do FPS de cada máquina. Inclui atrito maior fora da pista (grama: carro mais liso e mais lento, feature 5) e a alternância `driftMode`/normal (feature 4, com a mesma tunagem que o motor autoritativo do backend usa). Renderização interpola visualmente entre os dois últimos passos de física quando o frame real cai entre dois ticks.
- Input: WASD **e** setas simultaneamente habilitados.
- Renderização: pista, carro, sujeira de pneu, partículas — com o protótipo como referência visual de ponto de partida, não como código reaproveitado diretamente.
- Semáforo de largada (não contagem regressiva): sequência de luzes; largada queimada trava o acelerador por 5s.
- Cone de luz dinâmico à frente do carro em pistas noturnas; blur + escurecimento pesado sobre o resto da pista.
- Seleção de modelo (F1 com cor = capacete, Supercarro, Drift) e cor antes de correr.
- Escala de carro/pista reduzida frente ao protótipo original, mantendo pistas customizáveis sem ficar minúsculo.
- 24 pistas com nomes/traçados inspirados em circuitos reais de F1 (ou um ponto marcante, tipo "S do Senna", quando o traçado completo não couber), com muro/grama/árvore/grade nos pontos correspondentes.
- Alertas visuais de peça danificada (aqui ainda sem dano real — dano de verdade só existe online, ver Módulo 5; local pode simular dano cosmético/local se quiserem consistência de sensação, a decidir).
**Critério de pronto:** correr sozinho contra bots ou em split-screen local (2 jogadores, mesmo teclado com mapeamentos distintos) do início ao fim de uma corrida, com física estável em qualquer taxa de frame do navegador.

### Módulo 3 — Motor autoritativo online (núcleo)
**Depende de:** Módulo 1, Módulo 2, Módulo 3 do backend.
**Cobre features:** 4 (lobby online), 8.
**Escopo:**
- Cliente WebSocket com reconexão automática (backoff simples).
- Lobby: lista de jogadores, host, checkbox de pronto por jogador, host só pode iniciar quando todos estão `ready`.
- **Predição:** ao apertar uma tecla, o `RaceEngine` do Módulo 2 já simula o carro do próprio jogador imediatamente e envia `input` pro servidor.
- **Reconciliação:** ao chegar `state_snapshot`, comparar posição prevista com a recebida; se divergir além de um limiar pequeno, corrigir suavemente ao longo de poucos frames (nunca um "pulo" perceptível).
- **Interpolação:** carros remotos desenhados ~100ms atrás, interpolando entre os dois snapshots mais recentes — nunca perseguindo um alvo cru como no protótipo.
- Reaproveita o mesmo `RaceEngine` do Módulo 2 como motor de predição — não duplicar a física numa segunda implementação dentro do próprio frontend.
**Critério de pronto:** dois navegadores, mesma sala, os carros colidem (ou não) igual nas duas telas — mesmo teste de aceitação do Módulo 3 do backend, visto do lado do cliente.

### Módulo 4 — Ambiente e modo caos
**Depende de:** Módulo 3.
**Cobre features:** 4 (dia/noite/chuva/sol/caos completo em multiplayer).
**Escopo:** tela de configuração de sala (host apenas) com os campos de bots/dificuldade/voltas/pista/período/clima/`driftMode`; checkbox de modo caos que desabilita visualmente os outros campos (`settingsLocked` vindo do backend) e mostra aviso de que tudo será sorteado; renderização de vento (partícula direcional), poças de óleo e caixas recebidas do servidor (nunca sorteadas no cliente).
**Critério de pronto:** ativar modo caos na UI reflete exatamente os obstáculos que o servidor decidiu, iguais nas telas de todos os jogadores da sala.

### Módulo 5 — Corrida completa (dano, nitro, vácuo, fantasma, pits, HUD)
**Depende de:** Módulo 3.
**Cobre features:** 5 (feedback visual), 6, 7, 15 (aplicado online), 19, 24.
**Escopo:**
- HUD durante a corrida: mini-classificação (voltas de cada um, volta mais rápida e quem fez), volta atual/melhor tempo do próprio jogador.
- Indicador de nitro (barra decrescente, não recarrega).
- Renderização de dano por estado (`damageState` do snapshot): fumaça leve pra motor, volante "puxando" visualmente pra direção, carro parado e com alerta pra perda total.
- Ao `race_event: finished`, o próprio carro vira visualmente fantasma (transparência); a UI só desenha fantasma de quem também já terminou, conforme a regra de colisão do Módulo 5 do backend.
- Pódio final: posição, nome, avatar, tempo total — layout inspirado em pódio real de corrida (top 3 em degraus), não uma tabela genérica.
**Critério de pronto:** HUD reflete every campo do `state_snapshot` sem atraso perceptível; pódio final renderiza corretamente com 2, 3 ou 4 jogadores.

### Módulo 6 — Campeonatos
**Depende de:** Módulo 3, Módulo 5.
**Cobre features:** 9, 20.
**Telas:** `/championship/setup` (escolha de até 24 pistas, com ordem, repetição permitida), `/championship/:id` (tabela de pontos ao vivo entre corridas, próxima corrida e grid de largada calculado).
**Critério de pronto:** entre uma corrida e outra do campeonato, a tela mostra corretamente o grid invertido da corrida anterior antes do host iniciar a próxima.

### Módulo 7 — Social (amigos e notificações)
**Depende de:** Módulo 1.
**Cobre features:** 11, 12.
**Telas:** `/friends` (lista, busca por gamertag, convite pra sala), `/notifications` (lidas/não lidas).
**Componente:** `NotificationToast` (componente `Toast` do shadcn/ui) — escuta o evento `type: notification` do WebSocket (se o usuário estiver conectado a qualquer sala/lobby) e mostra por 5s ou até fechar manualmente; se não estiver conectado a nada no momento do envio, só aparece ao entrar na aba depois.
**Critério de pronto:** convite de outro usuário aparece como toast em tempo real se eu estiver com o app aberto, e como pendente na aba se eu abrir depois.

### Módulo 8 — Perfil, recordes e histórico
**Depende de:** Módulo 6.
**Cobre features:** 3 (estatísticas), 10, 26.
**Telas:** `/account` (aba de estatísticas: vitórias/derrotas, campeonatos vencidos, recorde por circuito), `/records` (ranking global, usando `Table` do shadcn/ui), histórico paginado de corridas dentro de `/account`.
**Critério de pronto:** as três telas consomem os endpoints do Módulo 8 do backend e atualizam depois de uma corrida/campeonato novo.

### Módulo 9 — Polimento e i18n
**Depende de:** todos os anteriores.
**Cobre features:** 25, 27.
**Escopo:** `/info` com regras gerais pra iniciante; troca de idioma (PT/EN) em `/account`, com biblioteca de i18n simples (ex. dicionário de chaves por idioma) — código-fonte permanece em inglês, só a camada de texto exibido troca; revisão final de responsividade e mensagens de erro traduzidas (usando as chaves que o Módulo 9 do backend passou a retornar).
**Critério de pronto:** trocar o idioma na conta muda todo texto visível, sem precisar de reload nem afetar nomenclatura interna do código.

---

## 6. Expansão aprovada (pós-MVP)

Os Módulos 0–9 continuam formando o MVP original. Os módulos abaixo registram funcionalidades aprovadas para uma fase posterior e não bloqueiam a conclusão do Módulo 9. Todos permanecem sujeitos às mesmas regras de testes, validação manual, PR isolado e sincronização de contrato com o backend.

### Módulo 10 — Progressão, carros e medalhas
**Depende de:** Módulo 5, Módulo 6 e Módulo 8 dos dois repositórios.
**Escopo:**
- A conta começa com exatamente um carro padrão; os demais aparecem bloqueados na garagem, com a conquista necessária claramente indicada.
- Tela de conquistas com progresso, requisito, raridade e recompensa; concluir conquistas pode liberar carros e recompensas exclusivamente cosméticas.
- Medalhas por idade da conta calculadas a partir de `createdAt`, sem confundir idade da conta com horas efetivamente jogadas.
- Seletor de até três medalhas para exibição pública no perfil, lobby, pódio e cartão do piloto; a seleção pode ser alterada a qualquer momento.
- Nenhuma recompensa altera física, velocidade, dano ou qualquer vantagem competitiva.
**Testes obrigatórios:** cobrir carro inicial, bloqueios/desbloqueios, progresso, idempotência da recompensa e seleção de no máximo três medalhas.
**Critério de pronto:** uma conquista válida libera seu carro/recompensa uma única vez e as três medalhas escolhidas aparecem de forma consistente para outros usuários.

### Módulo 11 — Contrarrelógio e fantasmas
**Depende de:** Módulo 2, Módulo 7, Módulo 8 e Módulo 11 do backend.
**Rotas:** `/time-trial`, `/time-trial/:trackId`.
**Escopo:**
- Salvar melhor tempo e trajetória por jogador, circuito, modelo de carro, modo de drift e condições determinísticas.
- Correr por padrão contra o fantasma do próprio recorde; permitir selecionar o recorde de um amigo quando houver permissão.
- O fantasma é somente visual: não colide, não afeta física e não participa da classificação da corrida.
- Exibir diferença de tempo em tempo real, volta válida/inválida e comparação ao final.
- Enviar inputs/telemetria compactados para validação do backend; tempo não validado nunca entra em ranking ou desafio compartilhável.
**Testes obrigatórios:** cobrir reprodução determinística, invalidação por corte de pista, escolha de fantasma próprio/amigo e isolamento entre versões de física.
**Critério de pronto:** repetir uma trajetória validada produz o mesmo fantasma e o recorde só é substituído por uma volta válida mais rápida.

### Módulo 12 — Controles personalizáveis
**Responsabilidade:** exclusivamente frontend; não exige endpoint nem alteração no backend.
**Depende de:** Módulo 2.
**Escopo:**
- Tela de configuração para acelerador, freio/ré, esquerda, direita, nitro e demais ações de corrida.
- Suportar teclado, botões do mouse ou combinação dos dois; cliques usados pela interface não podem acionar comandos da corrida.
- Detectar conflitos de teclas/botões, permitir restaurar padrões e oferecer perfis distintos para os dois jogadores do modo local.
- Persistir preferências localmente de forma versionada e fornecer fallback seguro quando um mapeamento antigo ficar incompatível.
**Testes obrigatórios:** cobrir captura de tecla/botão, conflitos, restauração, dois perfis locais e bloqueio de input enquanto o usuário digita em formulário.
**Critério de pronto:** o jogador consegue terminar uma corrida com um mapeamento personalizado de teclado, mouse ou ambos sem ações duplicadas.

### Módulo 13 — Modo espectador para amigos
**Depende de:** Módulo 3, Módulo 5, Módulo 7 e Módulo 13 do backend.
**Escopo:**
- Exibir a opção de assistir somente em partidas elegíveis de amigos adicionados.
- Entrar como espectador não ocupa vaga de piloto, não recebe controles de corrida e nunca pode enviar `input`.
- Permitir alternar entre carros e mostrar classificação, voltas, tempos, condição da conexão e atraso proposital da transmissão.
- Tratar corrida encerrada, sala privada, remoção da amizade, desconexão e limite de espectadores.
**Testes obrigatórios:** cobrir autorização, ausência de input, troca de câmera e remoção ao perder acesso.
**Critério de pronto:** um amigo autorizado acompanha a corrida sem interferir na simulação e vê estado coerente com os snapshots atrasados do servidor.

### Módulo 14 — Equipes e placar coletivo
**Depende de:** Módulo 7, Módulo 8 e Módulo 14 do backend.
**Rotas:** `/teams`, `/teams/:id`.
**Escopo:**
- Criar equipe com nome e sigla únicos; convidar amigos, aceitar/recusar convites, sair e gerenciar membros conforme permissões.
- Exibir perfil da equipe, membros, resultados recentes e placar coletivo.
- O placar soma somente estatísticas elegíveis definidas pelo backend e deixa a fórmula visível; alterações de equipe não podem duplicar resultados históricos.
- Aplicar limites de membros e regras claras para transferência de liderança e exclusão da equipe.
**Testes obrigatórios:** cobrir convites, permissões, mudanças de membro, paginação e consistência do placar.
**Critério de pronto:** resultados elegíveis dos membros atualizam o placar sem duplicidade e usuários sem permissão não alteram a equipe.

### Módulo 15 — Torneios oficiais automáticos
**Depende de:** Módulo 4, Módulo 5, Módulo 6, Módulo 13, Módulo 14 e Módulo 15 do backend.
**Rotas:** `/tournaments`, `/tournaments/:id`.
**Escopo:**
- Listar torneios oficiais gerados em horários predefinidos, com inscrição, check-in, regras sorteadas pelo servidor e chave visual completa.
- Cada bateria comporta no máximo quatro pilotos e classifica os dois primeiros; o sistema mostra byes ou classificatória quando o total não forma uma chave perfeita.
- O limite máximo global de inscritos fica configurável e explicitamente pendente de definição de produto/capacidade, nunca codificado como suposição.
- Eliminados podem acompanhar baterias seguintes pelo modo espectador; abandono, empate, desconexão e ausência no check-in têm regras visíveis.
**Testes obrigatórios:** cobrir cálculo de chave para quantidades pares/ímpares, progressão dos dois primeiros, empate, bye, check-in e atualização em tempo real.
**Critério de pronto:** para qualquer quantidade aceita de inscritos, a chave termina com um campeão sem perder, duplicar ou classificar incorretamente participantes.

### Módulo 16 — Conduta esportiva e penalidades
**Depende de:** Módulo 3, Módulo 5 e Módulo 16 do backend.
**Escopo:**
- Exibir avisos e penalidades decididos exclusivamente pelo servidor, com motivo, intensidade, momento do incidente e efeito aplicado.
- Diferenciar colisão proposital de contato inevitável usando contexto autoritativo; o cliente nunca decide culpa.
- Alertar bloqueio somente quando o carro permanece por mais de cinco segundos na trajetória relevante e pode se mover; pits, perda total, desconexão e posição segura fora da linha não contam.
- Mostrar histórico pós-corrida e permitir contestação futura sem pausar a corrida.
**Testes obrigatórios:** cobrir apresentação dos motivos, exceções de bloqueio e impossibilidade de o cliente forjar/remover penalidade.
**Critério de pronto:** todos os participantes recebem a mesma decisão autoritativa e nenhuma exceção documentada gera penalidade por bloqueio.
