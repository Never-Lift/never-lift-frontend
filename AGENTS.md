# AGENTS.md

## O que é este projeto
Jogo de corrida 2D multiplayer (top-down, estilo drift). Existe um protótipo anterior do mesmo autor — **este é um jogo novo, não uma versão dele.** O protótipo serve só como referência visual e de sensação de jogo, nunca como código a reaproveitar diretamente. Este repositório é o **frontend**; o backend vive num repositório separado — o contrato entre os dois está documentado abaixo e em `docs/`.

## Arquitetura (resumo — detalhe completo em `docs/plano-implementacao-frontend.md`)
- Dois planos: REST (conta, social, campeonato, recordes) e tempo real (WebSocket, um socket por sala — o motor de corrida).
- O **servidor é a única autoridade** sobre a corrida: roda a física, decide colisão, valida progresso. Este cliente envia só `input` (intenção), nunca posição, e usa predição + reconciliação + interpolação pra esconder a latência.
- Stack deste repositório: TypeScript + React + Vite + Tailwind + shadcn/ui. O backend (repositório separado) usa Java 21 + Spring Boot.
- A física existe em duas implementações — esta, em TypeScript, pra predição local e online, e a do backend, em Java, autoritativa — que precisam ter exatamente as mesmas constantes. Qualquer divergência de sensação entre os dois lados é bug, não ajuste de tuning.

## Protocolo de tempo real (contrato com o backend — não alterar sem avisar o outro lado)
Envelope: `{ "type": "...", "payload": {...} }`.
- Cliente → Servidor: `join_room`, `select_loadout`, `ready`, `input { throttle, brake, steer, nitro, clientSeq, clientTimestamp }`.
- Servidor → Cliente: `room_state`, `countdown`, `state_snapshot`, `race_event`, `race_result`, `error`.

Detalhe completo de cada payload: `docs/plano-implementacao-frontend.md`, seção 3.

## Documentação
- `docs/plano-implementacao-frontend.md` — plano deste repositório, módulo a módulo.
- `docs/plano-implementacao-backend.md` — plano do repositório backend, incluído aqui só como referência da API/WebSocket que este cliente consome. Não implementar nada daqui.

## Stack e convenções deste repositório
- TypeScript (strict) + Vite + React.
- Tailwind CSS + shadcn/ui pra "casca" do app (formulário, diálogo, tabela, toast) — não usar dentro do `<canvas>` da corrida.
- Identificadores de código sempre em **inglês**, mesmo com a documentação em português.

## Regras de arquitetura
- O estado da corrida (tempo real) vive **fora** do ciclo de render do React — um store dedicado (ex. Zustand), lido diretamente pelo loop de `requestAnimationFrame` do Canvas. Nunca colocar posição de carro em `useState` re-renderizado a 20-30x/segundo.
- O mesmo `RaceEngine` do Módulo 2 é reaproveitado como motor de predição no Módulo 3 — não duplicar a física numa segunda implementação.
- Nunca desenhar um carro remoto direto na posição recebida no `state_snapshot` — sempre interpolar entre os dois snapshots mais recentes.

## Regra fixa: testes
Nenhum módulo é considerado pronto sem testes automatizados rigorosos (Vitest + Testing Library; o Módulo 3 exige também um teste com dois clientes simulados via mock de WebSocket) cobrindo suas regras, além do critério funcional descrito no plano.

## Ao terminar um módulo
1. Testes automatizados passando.
2. Critério de pronto do módulo (ver `docs/plano-implementacao-frontend.md`) validado manualmente.
3. Atualizar a tabela de status abaixo.
4. Commit isolado, mensagem referenciando o número do módulo.

## Status dos módulos (frontend)
Antes de começar um módulo, confira se as dependências dele já estão marcadas como prontas — se não estiverem, pare e avise em vez de assumir.

| Módulo | Status |
|---|---|
| 0 — Fundação e deploy | não iniciado |
| 1 — Usuários e autenticação | não iniciado |
| 2 — Motor de corrida local | não iniciado |
| 3 — Motor autoritativo online | não iniciado |
| 4 — Ambiente e modo caos | não iniciado |
| 5 — Corrida completa (dano/nitro/pits/HUD) | não iniciado |
| 6 — Campeonatos | não iniciado |
| 7 — Social (amigos/notificações) | não iniciado |
| 8 — Perfil, recordes e histórico | não iniciado |
| 9 — Polimento e i18n | não iniciado |

> Status do backend (referência, não sincronizado automaticamente): ver `AGENTS.md` do repositório backend.
