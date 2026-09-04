# Parte 3b — motor físico autoritativo Java

## Escopo e alinhamentos aprovados

- `RaceEngine` pertence a uma sala; somente a thread de simulação altera carros.
- Loop externo de 30 Hz, quatro subpassos canônicos de 1/120 s; publicação
  independente a cada 50 ms (20 Hz). Três ticks de 30 Hz seriam 10 Hz, não 20 Hz.
- O runtime consome as 24 geometrias v2 do catálogo `2026.12`. O v1 é histórico
  e não foi alterado. Pista, catálogo e física ficam fixados ao iniciar a sessão.
- Input é limitado a throttle/brake `[0,1]` e steer `[-1,1]`, guardado no
  recebimento e reutilizado por 200 ms. Depois disso, o alvo fica neutro e as
  rampas já contratadas suavizam o retorno. `clientTimestamp` não controla o
  relógio físico. Sequências antigas não substituem comandos novos.
- O cliente deve renovar sua intenção a 30 Hz, mesmo mantendo a tecla apertada.
- `physicsContractVersion` fica no payload do envelope, junto aos demais dados.
  Incompatibilidade gera `race_event { type: version_mismatch, trackId,
  trackCatalogVersion, physicsContractVersion }`, seguido de fechamento 1008.

## Revisão física 2.0.2 autorizada

A auditoria identificou que o TypeScript usava a variação total de velocidade,
incluindo o impulso tangencial, para calcular dano. Isso contrariava a regra de
delta-v normal efetivo. Foi corrigido no frontend antes do congelamento dos
novos cenários e reproduzido no Java: norma da soma vetorial dos impulsos
normais, dividida pela massa. A resposta de velocidade/torque e os limiares de
resistência/direção de 2.0.1 permanecem iguais; não houve novo tuning de pneus,
aero, motor ou freios.

As duas aplicações devem ser promovidas juntas para 2.0.2. Uma preview antiga
com 2.0.1 será rejeitada corretamente pelo backend 2.0.2.

## Implementação

- `VehicleIntegrator`: etapas 1–13, estado persistente completo, pneus,
  transferência de carga, câmbio automático e controle sem ABS/boost.
- `CollisionGeometry`, `ContinuousCollision`, `CollisionSolver` e
  `VehicleCollisions`: etapa 14, SAT composto, manifold, CCD linear/rotativo,
  impulso no contato, atrito, torque e correção de penetração. A etapa 15 aplica
  dano cumulativo a partir dos contatos ordenados.
- `TrackGeometry`: faces internas publicadas, barreiras de garagens, broadphase
  por chunks/células, superfícies e separação por nível de elevação em Suzuka.
- `BotPlanner`: escolhe somente inputs; todos os coeficientes de decisão vêm
  de `bots` no contrato. A dificuldade não entra no integrador físico.
- `RoomRaceRuntime`: executores por sala, snapshot imutável publicado após o
  tick, limpeza ao cancelar/encerrar ou quando não restar humano. I/O de socket
  fica fora da thread de física. Falhas param a simulação e não geram resultado.

## Snapshot implementado na 3b

`state_snapshot.payload` contém `tick`, `serverTime` (epoch em ms), `trackId`,
`trackCatalogVersion`, `physicsContractVersion` e `cars` ordenados por ID.
Cada carro contém posição, velocidade, ângulo, velocidade escalar e:

- `physicsState`: yawRate, steeringAngle, appliedThrottle, appliedBrake,
  frontWheelAngularSpeed, rearWheelAngularSpeed, gear, engineRpm,
  gearShiftTimeRemaining e longitudinalAcceleration.
- `damageState`: kind, health, engineDamaged, steeringDamaged, steeringPull,
  totalLoss, impactCount e lastImpactSpeed. Os contadores preservam a sequência
  determinística do dano de direção.
- `trackDistanceMeters` e `trackLayer`: contexto da projeção geométrica,
  indispensável para distinguir níveis e segmentos vizinhos.
- `lastProcessedClientSeq`: sequência aplicada; `-1` antes do primeiro comando
  ou para bots. Permite confirmação futura de inputs na reconciliação da 3c.

`lap`, `isGhost` e `inPit` continuam definidos no schema para a 3c, mas não são
fabricados pela 3b. Checkpoints, volta, classificação isolada, semáforo, largada,
fantasmas, serviço de pit, resultados e reconciliação/predição online não estão
implementados nesta parte. A entrada em `qualifying` da 3a apenas ativa uma
sessão técnica de física para os clientes de teste, com staging no grid publicado;
não constitui a classificação jogável da 3c.

## Verificação reproduzível

Java 21 e Maven; Node somente para regenerar/verificar os dados de referência:

```sh
./mvnw --batch-mode clean test
node tools/physics-parity/generate-reference.mjs ../never-lift-frontend --check
node tools/physics-parity/generate-geometry-reference.mjs ../never-lift-frontend --check
node tools/track-catalog/generate-v2.mjs --check
node tools/track-catalog/audit-v2.mjs --mirror ../never-lift-frontend/contracts/module-2/v2
```

Os arquivos em `src/test/resources/physics` são saídas do TypeScript real,
com hashes SHA-256 dos fontes; não são números gerados pelo Java para se
autovalidar. Não regenerar referências para esconder divergências. Foram
congelados com Node 24.18.0/V8 13.6 e comparados em Java 21.0.7 no Windows.
Funções transcendentais usam StrictMath; potência usa Math.pow e a norma
bidimensional segue a avaliação escalada do runtime TypeScript. As tolerâncias
publicadas não foram ampliadas. A CI deve repetir a paridade em Linux.

`VehicleIntegratorTest` reproduz os 11 cenários, inclusive Miami, perda de
aderência e barreira oblíqua. `TrackGeometryParityTest` compara 648 amostras
das 24 pistas (geometria, superfície, barreiras e decisões nas três dificuldades).
`CollisionTest` verifica CCD, contato real, torque, atrito versus dano e ordem.
`RaceEngineTest` verifica 15 etapas/quatro subpassos, input retido, 22 carros,
mesma física para bots, imutabilidade e independência da ordem de entrada.
`AuthoritativeRaceIntegrationTest` executa dois clientes headless reais por
HTTP/WebSocket, sem UI ou física no cliente, e compara os mesmos ticks.

O diagnóstico opcional `MathParityDiagnosticTest` não é critério de aceitação;
somente roda com `-Dphysics.parity.diagnostics=true` após gerar suas sondas.
As suítes de aceitação não dependem dele e nunca são puladas.

## Estado da entrega

Implementação em validação final. Não promover a Parte 3b a pronta nem abrir a
Parte 3c até concluir a suíte completa e a comprovação dos dois clientes.
Nenhuma validação visual/manual da 3c foi antecipada.
