# Parte 2d — proposta aprovada do contrato físico 2.0.0

## Estado e limite desta etapa

Esta proposta foi aprovada em 25/08/2026 e define a substituição da física arcade do contrato `1.3.0` por uma dinâmica acessível de monoposto inspirada na Fórmula 1 de 2026. Ela também remove definitivamente boost/nitro do produto.

O desenho deste documento foi publicado como contrato executável em `contracts/module-2/v2/`, junto de constantes, schemas, geometrias, motor TypeScript e cenários. A implementação automatizada está concluída; a validação manual e a calibração final permanecem pendentes. O `v1` continua apenas como histórico imutável.

A mudança pertence à **Parte 2d do Módulo 2** e precisa terminar antes do Módulo 3, porque o motor Java autoritativo deverá reproduzir as mesmas fórmulas e os mesmos cenários determinísticos.

## Decisões de produto fechadas

- Direção: simulação acessível de F1 em 2D (`simcade`), fisicamente coerente e exigente, sem pretender reproduzir um simulador de engenharia completo.
- Um único monoposto inspirado na geração 2026, com a mesma física e o mesmo desempenho para todos; somente pintura e cosméticos diferenciam participantes.
- Tração traseira, câmbio automático de oito marchas, sem controle de tração e sem ABS.
- Não existe modo Normal/Drift nem acerto de condução selecionável.
- Controles digitais recebem rampas determinísticas de atuação e retorno para permitir modulação no teclado; isso não pode impedir patinagem, travamento ou perda de controle.
- Boost/nitro foi removido integralmente. `Shift` fica sem função, não gera input e não aparece no HUD, protocolo, configurações ou testes.
- Dano continua simples e cumulativo, sem deformação estrutural detalhada, mas sua intensidade passa a derivar de impulso/variação de velocidade do contato.
- Temperatura, pressão e desgaste de pneus, combustível variável, temperatura dos freios, câmbio manual, suspensão independente, gerenciamento detalhado de bateria/ERS e aerodinâmica ativa ficam fora desta parte.
- O vácuo planejado para o Módulo 5 permanece como redução moderada de arrasto calculada sobre o modelo aerodinâmico v2.

## Referência e metas mensuráveis

O monoposto continua original e não copia um carro ou equipe. A geração 2026 serve como referência física:

- largura máxima de `1,90 m`, entre-eixos máximo de `3,40 m`, direção somente no eixo dianteiro e tração somente no eixo traseiro;
- massa de calibração de `770 kg`, publicada na folha de constantes do runtime v2;
- velocidade normalmente observável próxima de `335 km/h`, podendo se aproximar de `350 km/h` depois de uma saída de curva e reta suficientes;
- velocidade final resultante do equilíbrio entre potência e arrasto, nunca de um corte rígido;
- frenagem validada por curvas completas de velocidade, tempo e distância. A referência inicial de Miami 2026 é `320 → 78 km/h` em `3,66 s` e `165 m`, com pico informado de `4 g`;
- aceleração validada em `0–100`, `0–200` e `0–300 km/h`, mas as faixas só serão congeladas após pesquisa de telemetria primária; não existe um único tempo oficial universal que justifique inventar esses números agora;
- esterço e raio mínimo precisam permitir a hairpin de Mônaco em velocidade plausível sem criar autoridade artificial em alta velocidade.

Fontes primárias de referência:

- [Regulamento técnico FIA 2026, edição 20](https://www.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_c_technical_-_iss_20_-_2026-08-05.pdf)
- [Visão geral técnica FIA da geração 2026](https://www.fia.com/news/new-era-competition-fia-showcases-future-focused-formula-1-regulations-2026-and-beyond)
- [Brembo — frenagem do GP de Miami de 2026](https://www.brembo.com/en/motorsport/formula1/2026/facts-miami-2026)
- [FIA — velocidades máximas do GP do Japão de 2026](https://www.fia.com/sites/default/files/2026_03_jpn_f1_r0_timing_racemaximumspeeds_v01.pdf)

## Modelo dinâmico canônico

O contrato 2.0 deverá especificar fórmulas e ordem de cálculo, não apenas constantes. A base é um corpo rígido 2D de três graus de liberdade com modelo de bicicleta dinâmico, forças de pneu não lineares e aderência combinada.

Estado físico mínimo:

- posição e velocidade do centro de massa em coordenadas de mundo;
- orientação, velocidade angular e inércia de yaw;
- velocidade longitudinal e lateral derivadas no referencial do carro;
- ângulo físico das rodas dianteiras;
- acelerador/freio efetivamente aplicados depois das rampas digitais;
- velocidade angular dos eixos/rodas dianteiros e traseiros para representar travamento e patinagem;
- marcha automática, RPM do motor e estado de transição da troca;
- estado de dano e superfície sob cada eixo quando necessário.

Forças e regras obrigatórias:

1. Ângulos de deriva dianteiro e traseiro calculados a partir de velocidade, yaw, geometria e esterço.
2. Forças laterais saturantes com sensibilidade à carga; aderência não pode crescer sem limite.
3. Slip longitudinal e lateral dividem o mesmo orçamento por uma elipse de aderência.
4. Excesso de acelerador em curva pode saturar o eixo traseiro e produzir sobresterço de potência ou rodada.
5. Entrada rápida demais pode saturar primeiro a frente e abrir a trajetória, ou saturar a traseira conforme transferência de carga e comandos; rodada não é um evento roteirizado obrigatório.
6. Frenagem excessiva pode travar pneus porque não existe ABS; aceleração excessiva pode patinar as rodas traseiras porque não existe controle de tração.
7. Transferência longitudinal de carga altera a capacidade de acelerar, frear e virar. Transferência lateral pode ser aproximada por eixo sem simular quatro suspensões independentes.
8. Arrasto e downforce variam aproximadamente com o quadrado da velocidade, com balanço aerodinâmico dianteiro/traseiro e sensibilidade realista à carga dos pneus.
9. Potência e força trativa variam com RPM/marcha/velocidade; o câmbio automático usa oito relações e trocas determinísticas.
10. Asfalto, zebra, grama, brita e pit lane têm atrito e resistência próprios. Limite de velocidade dos pits é regra de prova, não teto físico da superfície.
11. Integração usa passo fixo de `1/120 s`, independente do FPS, congelado após comparação com `1/60 s`. CCD é obrigatório.

Entradas normalizadas continuam sendo `throttle`, `brake` e `steer`. Rampas de teclado pertencem ao contrato determinístico para que local, predição e servidor tenham o mesmo resultado; elas não são controle de tração nem ABS.

## Colisão e geometria física

### Monoposto

- Remover `collisionRadiusMeters` e qualquer collider circular único.
- Publicar uma definição métrica do veículo com comprimento, largura, entre-eixos, centro de massa, inércia e uma união de polígonos convexos orientados.
- Os polígonos cobrem asa dianteira, bico, rodas, monocoque/sidepods e traseira; nenhuma parte sólida visível pode atravessar outro carro ou muro.
- Renderer e colisão consomem a mesma escala e origem local. A diferença máxima admitida entre silhueta sólida e collider é de `2–5 cm`, verificada por overlay de diagnóstico.
- A geometria composta evita uma forma côncava única instável e continua representando fielmente o envelope visual.

### Barreiras

- O contrato de pista v2 publica, por trecho, a polilinha canônica da face da barreira voltada à pista, sua espessura, material, camada e chunks.
- Renderer e os dois motores físicos usam essa mesma face; a espessura cresce para fora e não cria margem invisível dentro do asfalto.
- O schema de pista passa para `2.0.0` e o catálogo para `2026.6` quando essas faces forem geradas para as 24 pistas. O catálogo `2026.5` permanece intacto como histórico.
- Mônaco recebe cenários explícitos de folga visual, hairpin e contato oblíquo para impedir colisão antecipada.

### Solver

- Broadphase espacial por chunks e bounds dos colliders.
- Detecção contínua/swept para impedir tunneling em alta velocidade.
- Narrowphase por eixos separadores/manifold, com normal, profundidade e pontos reais de contato.
- Impulsos normal e tangencial aplicados no ponto de contato, incluindo torque, inércia angular, restituição baixa e atrito por material.
- Solver iterativo e ordem determinística para múltiplos contatos; correção de penetração não pode causar enrosco, jitter ou ganho de energia.
- Dano usa impulso, energia ou `delta-v` do contato depois da resolução; o limiar não depende somente da velocidade absoluta do carro.

## Protocolo v2 e persistência

O protocolo do Módulo 3 nasce diretamente sem nitro; não existe compatibilidade transitória porque o WebSocket ainda não foi implementado:

- `join_room { roomCode, trackCatalogVersion, physicsContractVersion }`;
- `input { throttle, brake, steer, clientSeq, clientTimestamp }`;
- `state_snapshot` remove `nitroRemaining` e inclui `physicsState { yawRate, steeringAngle, appliedThrottle, appliedBrake, frontWheelAngularSpeed, rearWheelAngularSpeed, gear, engineRpm, gearShiftTimeRemaining }`, além de posição, velocidade, ângulo, dano, volta, ghost e pits;
- propriedades desconhecidas devem ser rejeitadas nos schemas de mensagens.

`POST /api/races/local-result`, salas, resultados, recordes e fantasmas precisam persistir `physicsContractVersion`. Tempos de contratos físicos incompatíveis não podem ser comparados como se fossem da mesma categoria.

## Linha de contrato publicada

`contracts/module-2/v1/` é publicado e imutável. A Parte 2d publicou a linha paralela:

```text
contracts/module-2/v2/
  README.md
  module-2-decisions.json
  physics-model.md
  physics-constants.schema.json
  physics-constants.json
  vehicle-definition.schema.json
  vehicle-definition.json
  physics-reference-scenarios.schema.json
  physics-reference-scenarios.json
  realtime-race-protocol.schema.json
  track-catalog.schema.json
  catalog.json
  track-definition.schema.json
  tracks/
    <track-id>.json
```

Constantes desconhecidas não entram como `null` ou valores arbitrários no JSON executável. Constantes, schemas, runtime TypeScript e testes foram ativados no mesmo conjunto de mudanças; o backend empacota uma cópia byte a byte idêntica antes de iniciar seu motor Java no Módulo 3.

## Testes e critérios da Parte 2d

Testes contratuais obrigatórios:

- curva de aceleração e passagem por `100/200/300 km/h`;
- coast-down, velocidade terminal e ausência de hard cap;
- frenagem reta em várias velocidades, distribuição de frenagem e travamento;
- curva de raio constante abaixo, no limite e acima do limite;
- saída de frente, sobresterço de potência, lift-off e trail braking;
- simetria de curva para esquerda/direita e transição entre todas as superfícies;
- impacto frontal central, traseiro, lateral, oblíquo e fora do centro;
- contato no bico/asa/roda sem atravessamento;
- raspão de muro sem enrosco, impacto que produz yaw e CCD sem tunneling;
- folga visual sem falso positivo em barreiras, incluindo casos de Mônaco;
- determinismo do passo físico e equivalência do resultado com renderização a 30/60/120 FPS;
- cenários TypeScript congelados e reproduzidos pelo Java dentro das tolerâncias publicadas.

Bots precisam ganhar planejamento de velocidade por curvatura, ponto de frenagem, tangência, aplicação progressiva de acelerador e recuperação; aumentar dificuldade melhora execução sem conceder mais aderência, potência ou freio.

Critério manual mínimo:

- completar um circuito de baixa e um de alta velocidade, com pelo menos uma pista urbana;
- exigir frenagem e tangência reais: acelerar continuamente não pode concluir uma volta competitiva;
- provocar e recuperar perda dianteira/traseira de forma explicável pelos comandos;
- validar contatos carro–carro e carro–muro de diferentes ângulos sem sobreposição, colisão invisível ou enrosco;
- confirmar que `Shift` não executa nem envia qualquer ação.

Os testes automatizados foram implementados, mas somente depois de todos passarem no estado final e da validação manual acima a Parte 2d pode ser marcada pronta e o Módulo 3 pode começar.
