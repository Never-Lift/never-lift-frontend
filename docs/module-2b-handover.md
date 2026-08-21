# Passagem de bastão — Módulo 2, Parte 2b

Data de fechamento: 21/08/2026
Frontend: commit c893ed8, PR #82
Backend: commit bca1ca6, PR #67
Estado do Módulo 2: **em andamento**. As Partes 2a e 2b estão entregues; a Parte 2c continua pendente.

## Objetivo deste documento

Este é o contexto factual para iniciar a Parte 2c sem reabrir, duplicar ou descaracterizar a Parte 2b. Ele registra o que está em produção na branch de auditoria, os contratos que não podem ser alterados casualmente, as limitações conhecidas e um briefing pronto para um novo prompt.

O jogo continua sendo um projeto novo. O protótipo anterior é apenas referência visual e de sensação; nenhum código dele deve ser copiado.

## O que a Parte 2b entregou

### Catálogo canônico e carregamento

- O backend publica o catálogo congelado **2026.3** com 24 pistas por GET /api/tracks e uma definição métrica completa por GET /api/tracks/{id}.
- O frontend usa a definição recebida pela API; não há uma segunda cópia das geometrias das 24 pistas no frontend de produção.
- A tela /race permite escolher cada pista, mostra país, localidade, comprimento, ambiente e prévia do traçado, e injeta a definição selecionada no RaceEngine.
- A corrida e o POST /api/races/local-result preservam o trackId e a trackCatalogVersion realmente selecionados.
- O cliente rejeita respostas de catálogo incompatíveis ou antigas antes de tentar renderizar a corrida.

As 24 etapas são: Albert Park, Shanghai, Suzuka, Bahrain, Jeddah, Miami, Montreal, Monaco, Barcelona, Spielberg, Silverstone, Spa-Francorchamps, Hungaroring, Zandvoort, Monza, Madrid, Baku, Singapore, Austin, Mexico City, Interlagos, Las Vegas, Lusail e Yas Marina.

### Geometria, limites e proteção

- O contrato de pista é TrackDefinition 1.2.0. Todas as distâncias e larguras permanecem em metros.
- A centerline, racingLine, grid, checkpoints direcionais, linha de largada/chegada, chunks e trackLimits são fornecidos pelo backend.
- Cada trecho e cada lado podem ter uma sequência ordenada de zonas: asphalt, grass e gravel.
- Depois das zonas existe uma barreira física de impacto: concrete-wall, guardrail, tecpro ou tyre-barrier.
- A grade externa opcional é o campo fence: debris-fence. Ela é apenas visual e **não** substitui, desloca ou cria uma segunda colisão além da barreira de impacto.
- Uma zona gravel é visualmente distinta, mas deliberadamente usa a tração de grass da física v1.2. Não alterar essa regra sem uma nova rodada de contrato e calibração física.
- Zonas vazias significam que a barreira fica praticamente junto ao asfalto, algo comum em circuitos urbanos.

### Auditoria ambiental das 24 pistas

- Os antigos perfis genéricos e a faixa global uniforme de escape foram removidos.
- O backend possui um perfil exclusivo por pista em tools/track-catalog/track-environments.mjs. O gerador materializa esses perfis nas 24 definições JSON.
- A pesquisa usa preferencialmente mapas/notas FIA 2025–2026, páginas oficiais dos circuitos, F1 e fornecedores de proteção; cada definição publica suas referências em source.environmentReferences.
- O modelo é conservador e legível para um jogo 2D. Larguras não são um levantamento topográfico centimétrico; ajustes de 10–20% para legibilidade permanecem permitidos pelo guia.
- Miami e Las Vegas usam grade bilateral em toda a volta porque a metragem do fornecedor sustenta essa cobertura. Jeddah, Baku e Lusail usam grade apenas em setores documentados. Ausência no modelo não é uma afirmação de inexistência física no circuito real.
- Madrid continua provisória: o perfil usa pavimento e muros do material oficial disponível, sem inventar grama ou brita. Uma atualização futura exige nova fonte, nova catalogVersion e sincronização entre os repositórios.

### Renderização e navegação

- A pista é renderizada vetorialmente por chunks visíveis; não existe bitmap global proporcional ao circuito.
- A câmera top-down é suavizada em 0,25 s, enquadra o carro em aproximadamente 60% da altura e usa carro com 5,5% da altura da viewport.
- O minimapa é fixo e deriva das mesmas coordenadas da pista; nunca gira com a câmera.
- O modo solo usa dois bots determinísticos. O modo local suporta dois jogadores, com WASD e setas, câmeras próprias e split vertical em telas largas ou horizontal abaixo de razão 1,35.
- A renderização separa os passes em: ambientes laterais, asfalto, grades, barreiras e detalhes. Isso preserva a visibilidade da proteção no limite da pista.
- Mudanças de largura e de material usam geometria longitudinal, sem conectores transversais artificiais. Zonas largas não extrapolam seus limites por caps arredondados.

### Suzuka e cruzamentos em níveis

- Suzuka usa elevationLayer explícito: camada 0 para o piso inferior e camada 1 para a passagem elevada.
- O renderer desenha as camadas em ordem; a elevada, incluindo pista, proteção e carros, fica visualmente acima da inferior.
- A projeção geométrica usa o progresso anterior do carro para escolher a ramificação correta perto do cruzamento.
- Carros em camadas distintas não colidem. A transição de camada é dividida no mesmo midpoint tanto pela geometria quanto pelo renderer.
- Não foi criado um modelo 3D de ponte, sombra estrutural ou altura física em metros; trata-se de uma separação top-down visual e de colisão.

### Físicas e fluxos que a 2b preserva

- RaceEngine determinístico em passo fixo de 1/60 s, independente do requestAnimationFrame.
- Interpolação visual entre ticks; posições de corrida não ficam em React state.
- Modo Normal/Drift é definido antes da prova e vale igualmente para humanos e bots.
- Modelos F1, Supercarro e Drift, bem como cores, são visuais; não alteram a física.
- Colisão entre carros, barreiras, dano cumulativo, bots, controles, telemetria e resultado local continuam sendo os da Parte 2a.
- A atualização de ambientes não reabriu as constantes físicas compartilhadas nem o contrato de dano.

## Mapa de arquivos importantes

### Frontend

- src/pages/RacePage.tsx — preparação, seleção de pista e início local.
- src/lib/api.ts — leitura e validação do catálogo/TrackDefinition.
- src/race/RaceEngine.ts — simulação, superfície, colisão e trackLayer do carro.
- src/race/TrackGeometry.ts — projeção, ambientes, barreiras e desambiguação de cruzamentos.
- src/race/RaceRenderer.ts — chunks, passes visuais, superfícies, grades, barreiras e camadas de elevação.
- src/components/race/RaceCanvas.tsx — ciclo de Canvas e ligação com a corrida local.
- src/race/camera.ts — câmera e divisão de viewport.

### Backend

- tools/track-catalog/track-environments.mjs — perfis auditados e fontes das 24 pistas.
- tools/track-catalog/generate.mjs — aplicação dos perfis e validação do catálogo.
- tools/track-catalog/audit-turns.mjs — auxílio heurístico para localizar curvas; não é fonte de verdade.
- contracts/module-2/v1/tracks/*.json — geometrias canônicas geradas.
- src/main/java/com/neverlift/backend/track/TrackCatalogImporter.java — importação/validação do catálogo.

### Contratos e direção

- contracts/module-2/v1/track-definition.schema.json
- contracts/module-2/v1/catalog.json
- contracts/module-2/v1/physics-constants.json
- docs/contracts/module-2-shared-contracts.md
- docs/game-design-guide.md
- docs/frontend-implementation-plan.md

Os arquivos de contrato e de documentação compartilhados precisam permanecer semanticamente idênticos entre frontend e backend.

## Cobertura e validação já executadas

- Frontend: npm run check aprovado, com 89 testes, lint e build.
- Backend: suíte Maven aprovada, com 31 testes.
- Gerador: 24 pistas validadas para o catálogo 2026.3, hash 33393b3da22af98058530fdc8fa53dda76bc6b82d51b865fe1e53d1214593a55.
- Browser: seleção, carregamento, largada e Canvas validados contra a API local nas 24 pistas; sem erros ou avisos no console.
- Atlas responsivo: 24/24 mapas renderizados, conferido em viewports de 736 px e 360 px.
- CI dos PRs: frontend (qualidade, fluxo de branch e Vercel) e backend (Maven e fluxo de branch) aprovados.

Testes de regressão relevantes no frontend:

- src/lib/track-api-compatibility.test.ts
- src/race/TrackSurfaceContract.test.ts
- src/race/RaceRenderer.surface.test.ts
- src/race/RaceEngine.test.ts
- src/race/TrackGeometry.test.ts

## O que ainda NÃO deve ser considerado entregue

A Parte 2b não implementa:

- sequência de semáforo;
- bloqueio de acelerador por 5 s para largada queimada;
- presets visuais de dia, entardecer e noite;
- cone de luz do carro e escurecimento controlado da pista à noite;
- partículas temáticas de ambiente;
- clima dinâmico, chuva, spray, poças, vento ou modo caos;
- multiplayer, WebSocket, autoridade do servidor, predição online ou reconciliação;
- nitro funcional, vácuo, pits, reparo, fantasma ou HUD completo de dano.

Clima/caos e as regras compartilhadas online pertencem aos módulos posteriores. Alertas visuais completos de dano, nitro e pits pertencem ao Módulo 5.

## Guardrails obrigatórios para a Parte 2c

1. Não duplicar TrackDefinition, geometria, física ou catálogo no frontend.
2. Não alterar schema, catalogVersion, constantes físicas, limites ambientais ou fontes da auditoria sem uma razão explícita e sincronização com o backend.
3. Não tratar a grade como colisão.
4. Não reintroduzir bitmap global, desenho fora de chunks visíveis ou estado de carro no ciclo de render do React.
5. Não quebrar split-screen, minimapa fixo, culling, elevação de Suzuka ou a ordem de passes do renderer.
6. Não antecipar clima/caos do Módulo 4, multiplayer do Módulo 3 ou nitro/pits/HUD completo do Módulo 5.
7. Preservar a direção do guia: Canvas 2D, efeitos limitados/reutilizáveis, sem filtros pesados de tela inteira e sem reflexos reais em tempo real.

## Escopo recomendado para a Parte 2c

Implementar somente no modo local:

1. Largada por semáforo, em vez de uma simples contagem regressiva.
2. Detecção de largada queimada e bloqueio de acelerador por 5 s, determinístico e independente de FPS.
3. Presets visuais fixos por corrida: dia, entardecer e noite; não há ciclo de horário durante a prova.
4. Para noite, cone de luz dinâmico à frente de cada carro e escurecimento controlado do restante da pista, sem blur pesado de tela inteira.
5. Ambiente visual estático e partículas leves/limitadas compatíveis com qualidade gráfica, sem mexer no catálogo geométrico auditado.
6. Controles e testes que comprovem que os efeitos nunca afetam física, colisão, trackLayer, câmera, minimapa ou culling.

## Critérios de aceite sugeridos para a Parte 2c

Automatizados:

- semáforo progride na ordem correta e impede aceleração antes da liberação;
- largada antecipada bloqueia somente o acelerador por 5 s, com o mesmo resultado em 30, 60 e 120 FPS;
- preset visual não altera posição, velocidade, superfície, dano, checkpoints ou resultado da corrida;
- camada noturna e luz são recortadas por viewport/chunk e não vazam entre viewports do split-screen;
- orçamento de partículas permanece limitado por nível de qualidade;
- regressão de Suzuka, minimapa, câmera, culling, superfícies, barreiras e grades continua verde.

Manuais:

- largar normalmente e cometer uma largada queimada em Solo e em dois jogadores locais;
- testar dia, entardecer e noite em pista curta, longa, urbana e aberta;
- testar a noite em split-screen vertical e horizontal;
- confirmar legibilidade de pista, muro, grade, carro e minimapa sem apagar o ambiente;
- percorrer novamente Suzuka e uma pista de grandes escapes, garantindo que iluminação/partículas não escondem superfícies ou cruzamentos.

## Prompt-base para iniciar a Parte 2c

> Continue o Módulo 2 no frontend a partir da Parte 2b já concluída. Antes de editar, leia AGENTS.md, docs/module-2b-handover.md, docs/frontend-implementation-plan.md, docs/game-design-guide.md e os contratos em contracts/module-2/v1.
>
> Implemente exclusivamente a Parte 2c do modo local: semáforo de largada, punição determinística de 5 s no acelerador para largada queimada, presets visuais fixos de dia/entardecer/noite, cone de luz por carro e escurecimento noturno controlado, além de ambiente/partículas estáticos e limitados. Preserve o RaceEngine, o catálogo 2026.3, TrackDefinition 1.2.0, os limites auditados, culling, minimapa, split-screen, física fixa de 1/60 s e as camadas de Suzuka.
>
> Não implemente multiplayer, clima/caos, nitro, pits, vácuo, fantasma, HUD completo de dano, mudança de schema ou qualquer cópia local das 24 pistas. Não use filtros pesados de tela inteira, reflexos em tempo real ou partículas ilimitadas.
>
> Adicione testes automatizados para largada, falsa largada, FPS, presets, noite, split-screen e regressões de renderização. Valide manualmente os modos Solo/local, uma pista curta, longa, urbana, de grandes escapes e Suzuka. Atualize documentação/status, faça commit isolado do Módulo 2 e não marque o Módulo 2 inteiro como pronto até o critério completo ser validado.
