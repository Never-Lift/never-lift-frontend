# AGENTS.md

## O que é este projeto
Jogo de corrida 2D multiplayer top-down, com condução arcade controlada e um único carro de F1. Existe um protótipo anterior do mesmo autor — **este é um jogo novo, não uma versão dele.** O protótipo serve só como referência visual e de sensação de jogo, nunca como código a reaproveitar diretamente. Este repositório é o **frontend**; o backend vive num repositório separado — o contrato entre os dois está documentado abaixo e em `docs/`.

## Arquitetura (resumo — detalhe completo em `docs/frontend-implementation-plan.md`)
- Dois planos: REST (conta, social, campeonato, recordes) e tempo real (WebSocket, um socket por sala — o motor de corrida).
- O **servidor é a única autoridade** sobre a corrida: roda a física, decide colisão, valida progresso. Este cliente envia só `input` (intenção), nunca posição, e usa predição + reconciliação + interpolação pra esconder a latência.
- Stack deste repositório: TypeScript + React + Vite + Tailwind + shadcn/ui. O backend (repositório separado) usa Java 21 + Spring Boot.
- A física existe em duas implementações — esta, em TypeScript, pra predição local e online, e a do backend, em Java, autoritativa — que precisam ter exatamente as mesmas constantes. Qualquer divergência de sensação entre os dois lados é bug, não ajuste de tuning.

## Protocolo de tempo real (contrato com o backend — não alterar sem avisar o outro lado)
Envelope: `{ "type": "...", "payload": {...} }`.
- Cliente → Servidor: `join_room { roomCode, trackCatalogVersion }`, `select_loadout`, `ready`, `input { throttle, brake, steer, nitro, clientSeq, clientTimestamp }`.
- Servidor → Cliente: `room_state`, `countdown`, `state_snapshot`, `race_event`, `race_result`, `error`.

Detalhe completo de cada payload: `docs/frontend-implementation-plan.md`, seção 3.

## Documentação
- `docs/frontend-implementation-plan.md` — plano deste repositório, módulo a módulo.
- `docs/backend-implementation-plan.md` — plano do repositório backend, incluído aqui só como referência da API/WebSocket que este cliente consome. Não implementar nada daqui.
- `docs/game-design-guide.md` — fonte oficial das decisões visuais, de câmera, escala, telas e fase de implementação. Ler antes de qualquer trabalho de interface ou corrida.
- `docs/contracts/module-2-shared-contracts.md` e `contracts/module-2/v1/` — contratos versionados de pistas, catálogo e física que o Módulo 2 deve consumir sem reinterpretar.

## Stack e convenções deste repositório
- TypeScript (strict) + Vite + React.
- Tailwind CSS + shadcn/ui pra "casca" do app (formulário, diálogo, tabela, toast) — não usar dentro do `<canvas>` da corrida.
- Identificadores de código sempre em **inglês**, mesmo com a documentação em português.

## Regras de arquitetura
- O estado da corrida (tempo real) vive **fora** do ciclo de render do React — um store dedicado (ex. Zustand), lido diretamente pelo loop de `requestAnimationFrame` do Canvas. Nunca colocar posição de carro em `useState` re-renderizado a 20-30x/segundo.
- O mesmo `RaceEngine` do Módulo 2 é reaproveitado como motor de predição no Módulo 3 — não duplicar a física numa segunda implementação.
- Nunca desenhar um carro remoto direto na posição recebida no `state_snapshot` — sempre interpolar entre os dois snapshots mais recentes.
- Física, pistas, checkpoints e snapshots usam a unidade compartilhada **1 unidade de mundo = 1 metro**. Pixels são somente uma projeção da câmera e nunca podem entrar nas regras físicas.
- Circuitos extensos não são bitmaps únicos: renderizar por trechos e descartar desenho fora da área visível.
- O frontend consome as 24 geometrias pela API do backend. Schemas, manifesto e constantes em `contracts/module-2/v1/` devem continuar idênticos nos dois repositórios.

## Regra fixa: design e fase
- `docs/game-design-guide.md` define a direção aprovada; não reinterpretar estilo, câmera ou composição em cada módulo.
- Decisão documentada não significa implementação imediata. Itens marcados como pós-MVP só entram no módulo indicado e não podem aumentar o escopo dos Módulos 0–9.
- A fundação visual global foi implementada em rodada própria antes do Módulo 2. Preserve os tokens de `src/index.css`, as fontes Barlow empacotadas localmente, o componente `Brand` e o shell responsivo; modernizações futuras exigem regressão automatizada, mas não reabrem o escopo funcional dos Módulos 0 e 1 nem mudam seu status de pronto.
- Valores marcados como **calibração** devem ser medidos no protótipo; ajustes precisam permanecer dentro da direção e dos limites documentados.

## Regra fixa: testes
Nenhum módulo é considerado pronto sem testes automatizados rigorosos (Vitest + Testing Library; o Módulo 3 exige também um teste com dois clientes simulados via mock de WebSocket) cobrindo suas regras, além do critério funcional descrito no plano.

## Ao terminar um módulo
1. Testes automatizados passando.
2. Critério de pronto do módulo (ver `docs/frontend-implementation-plan.md`) validado manualmente.
3. Atualizar a tabela de status abaixo.
4. Commit isolado, mensagem referenciando o número do módulo.

Promoções `develop → main` devem preservar a ancestralidade com merge commit. Se alguém usar squash, sincronizar `main` de volta em `develop` antes de iniciar o módulo seguinte.

## Status dos módulos (frontend)
Antes de começar um módulo, confira se as dependências dele já estão marcadas como prontas — se não estiverem, pare e avise em vez de assumir.

| Módulo | Status |
|---|---|
| 0 — Fundação e deploy | pronto |
| 1 — Usuários e autenticação | pronto |
| 2 — Motor de corrida local | em andamento — Partes 2a/2b/2c e catálogo `2026.5` validados manualmente em 24/08/2026; simplificação #90 para F1 único e condução única aprovada no planejamento, com implementação funcional pendente |
| 3 — Motor autoritativo online | não iniciado |
| 4 — Ambiente e modo caos | não iniciado |
| 5 — Corrida completa (dano/nitro/pits/HUD) | não iniciado |
| 6 — Campeonatos | não iniciado |
| 7 — Social (amigos/notificações) | não iniciado |
| 8 — Perfil, recordes e histórico | não iniciado |
| 9 — Polimento e i18n | não iniciado |
| 10 — Progressão, personalização e medalhas | não iniciado (pós-MVP) |
| 11 — Contrarrelógio e fantasmas | não iniciado (pós-MVP) |
| 12 — Controles personalizáveis | não iniciado (pós-MVP) |
| 13 — Modo espectador para amigos | não iniciado (pós-MVP) |
| 14 — Equipes e placar coletivo | não iniciado (pós-MVP) |
| 15 — Torneios oficiais automáticos | não iniciado (pós-MVP) |
| 16 — Conduta esportiva e penalidades | não iniciado (pós-MVP) |

> Status do backend (referência, não sincronizado automaticamente): ver `AGENTS.md` do repositório backend.
