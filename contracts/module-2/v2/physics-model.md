# Modelo físico canônico 2.0.3

## Portabilidade numérica — revisão aprovada 2.0.3

As fórmulas, coeficientes, ordem das etapas e tolerâncias abaixo permanecem
inalterados em relação a 2.0.2. Na física, geometria de colisão e decisões de bots,
`sin`, `cos`, `atan2`, `tanh`, potências não inteiras e norma bidimensional
usam o kernel `portable-f64-v1`, com a mesma ordem de operações IEEE-754 em
`src/race/portable-math.ts` e `PortableMath.java`. Não usar o `Math` nativo
para essas operações nem trocar por `StrictMath` isoladamente.

Isso não é tuning e não autoriza ampliar tolerâncias. O kernel é restrito ao
domínio físico documentado; não é uma biblioteca matemática geral. Câmera e
efeitos visuais continuam livres para usar as funções nativas. Especificação,
limites e testes em [module-3b-portability.md](../../../docs/module-3b-portability.md).

Este documento faz parte do contrato executável. Implementações TypeScript e
Java devem preservar fórmulas, sinais, ordem de cálculo e passo fixo. Pequenas
diferenças numéricas só são aceitas dentro das tolerâncias dos cenários.

## Convenções

- mundo: `+x` para a direita, `+y` para cima;
- ângulo `ψ`: anti-horário desde `+x`;
- referencial do carro: longitudinal `u` para frente e lateral `v` para a
  esquerda;
- esterço positivo vira as rodas para a esquerda;
- yaw positivo é anti-horário;
- unidade: metro, segundo, radiano, quilograma, newton e watt;
- estado persistente usa números finitos em dupla precisão; o wire format é
  JSON number.

## Estado mínimo

`x, y, velocityX, velocityY, angle, yawRate, steeringAngle, appliedThrottle,
appliedBrake, frontWheelAngularSpeed, rearWheelAngularSpeed, gear, engineRpm,
gearShiftTimeRemaining` e dano. A aceleração longitudinal do subpasso anterior
(`longitudinalAcceleration`) também é preservada e transmitida: o passo 6 já
depende desse valor para transferência de carga. Não é uma nova força nem uma
alteração da ordem de integração. `u` e `v` são derivados a cada subpasso:

```text
u =  cos(ψ) * velocityX + sin(ψ) * velocityY
v = -sin(ψ) * velocityX + cos(ψ) * velocityY
```

## Ordem canônica de um passo

1. Limitar `throttle`, `brake` a `[0,1]` e `steer` a `[-1,1]`.
2. Atualizar `appliedThrottle`, `appliedBrake` e o ângulo de esterço pelas
   rampas `moveTowards`, sem ultrapassar o alvo. As duas constantes de esterço
   são expressas diretamente em radianos por segundo; não existe uma segunda
   conversão ou assistência dependente de velocidade.
3. Atualizar troca automática e `gearShiftTimeRemaining`. Durante troca, torque
   motriz é zero. O acoplamento simplificado é algébrico: atualizar RPM a partir
   do módulo da velocidade angular do eixo traseiro, relação e final drive, com
   piso em marcha lenta, mas sem esconder inércia de motor, embreagem ou filtro.
   A troca para cima exige simultaneamente RPM bruta do eixo maior ou igual a
   `upshiftRpm` e RPM calculada pela velocidade longitudinal maior ou igual a
   `upshiftRpm / (1 + automaticUpshiftWheelSlipAllowance)`. Assim, patinagem
   continua física e pode atingir o corte, mas não promove marchas muito cedo;
   reduções usam a RPM da velocidade longitudinal contra `downshiftRpm`.
   Torque disponível é `min(maxTorqueNm, maxPowerWatts /
   engineAngularSpeed)`; não existe curva de torque escondida. No corte, isto é,
   quando a RPM bruta acoplada é maior ou igual a `redlineRpm`, o torque motriz é
   zero; a RPM publicada no estado fica limitada entre `idleRpm` e `redlineRpm`,
   sem impor limite rígido à velocidade linear do carro. Ré engata somente abaixo de
   `reverseEngageSpeedMetersPerSecond` quando freio supera
   `reverseInputThreshold` e acelerador está abaixo do mesmo limiar.
4. Transformar velocidade mundial em `u,v`. Para cálculo de slip, usar
   `slipReferenceSpeed = max(abs(u), minimumSlipSpeedMetersPerSecond)`.
5. Calcular carga aerodinâmica e arrasto com a velocidade do ar ao quadrado.
6. Calcular transferência longitudinal pelo valor da aceleração longitudinal do
   passo anterior. Carga normal de cada eixo é limitada somente a zero; não há
   clamp oculto de aceleração nem piso percentual de carga.
7. Calcular velocidade de contato dos eixos:

```text
frontLong = u
frontLat  = v + frontAxleDistanceFromCom * yawRate
rearLong  = u
rearLat   = v - rearAxleDistanceFromCom * yawRate
frontSlipAngle = atan2(frontLat, slipReferenceSpeed) - steeringAngle
rearSlipAngle  = atan2(rearLat, slipReferenceSpeed)
slipRatio = (wheelAngularSpeed * wheelRadius - axleLong) /
            slipReferenceSpeed
```

8. Obter força pura longitudinal e lateral com `tanh(stiffness * slip / peak)`,
   multiplicada pela aderência disponível. Aplicar sensibilidade à carga:

```text
staticAxleLoad = weight * oppositeAxleDistanceFromCom / wheelbase
grip = referenceMu * surfaceFriction * normalLoad *
       pow(normalLoad / staticAxleLoad, loadSensitivityExponent - 1)
```

9. Compartilhar aderência pela elipse combinada Euclidiana. Se
   `(Fx/gripLong)^2 + (Fy/gripLat)^2 > 1`, multiplicar ambas as forças pelo
   inverso da raiz. Girar forças dianteiras pelo esterço.
10. Somar tração traseira, frenagem por eixo, resistência ao rolamento, arrasto,
    forças de pneu e resistência da superfície. Freio se opõe à rotação/avanço e
    pode travar as rodas; acelerador pode patinar o eixo traseiro.
11. Calcular força lateral total e momento de yaw:

```text
yawMoment = frontAxleDistanceFromCom * frontFyBody
          - rearAxleDistanceFromCom * rearFyBody
```

   Não existe força lateral ou damping de yaw adicional fora das forças de pneu;
   resistência longitudinal só zera quando a velocidade absoluta está abaixo de
   `numericSpeedEpsilonMetersPerSecond`.
12. Integração semi-implícita: atualizar velocidades linear/angular, depois
    posição/ângulo. Normalizar ângulo em `[-π, π]`.
13. Atualizar velocidades angulares dos eixos pelo torque líquido e a inércia
    equivalente publicada, depois de as forças de pneu do passo terem sido
    calculadas:

```text
frontBrakeTorque = appliedBrake * maximumBrakeForceNewtons *
                   frontBrakeBias * wheelRadius
rearBrakeTorque  = appliedBrake * maximumBrakeForceNewtons *
                   (1 - frontBrakeBias) * wheelRadius
frontTorque = -frontFx * wheelRadius
              - signForBrake(frontOmega, u) * frontBrakeTorque
rearTorque  = driveTorqueAtWheels - rearFx * wheelRadius
              - signForBrake(rearOmega, u) * rearBrakeTorque
frontOmega += frontTorque / frontAxleRotationalInertiaKgM2 * dt
rearOmega  += rearTorque  / rearAxleRotationalInertiaKgM2  * dt
```

    As inércias publicadas não são números independentes. Devem satisfazer, sem
    arredondamento intermediário:

```text
frontAxleRotationalInertiaKgM2 =
  2 * frontWheelAssemblyMassKg * wheelRadiusMeters^2 *
      wheelAssemblyInertiaFactor
rearAxleRotationalInertiaKgM2 =
  2 * rearWheelAssemblyMassKg * wheelRadiusMeters^2 *
      wheelAssemblyInertiaFactor + rearDrivelineRotationalInertiaKgM2
```

    `signForBrake(omega,u)` usa o sinal de `omega` quando sua magnitude excede
    `numericSpeedEpsilonMetersPerSecond / wheelRadius`; senão usa o sinal de `u`;
    se ambos forem zero, retorna zero. Se um torque exclusivamente de frenagem
    cruzar `omega` por zero no passo, fixar a roda em zero em vez de inverter sua
    rotação. Não existe relaxação exponencial, target-slip artificial ou damping
    escondido de roda.
14. Resolver colisões em ordem determinística: broadphase por chunks, CCD,
    manifold SAT, impulsos normal/tangencial no ponto de contato, iterações e
    correção de penetração. A face de `barrierGeometry` é o limite físico.
15. Derivar dano do `delta-v` normal efetivo após o contato. Nunca usar somente
    velocidade absoluta.

## Dano e perda total

A revisão `2.0.2` corrige a medida do impacto, sem recalibrar resistência ou
direção. Para cada chamada do solver de contatos, acumular **vetorialmente**
somente os impulsos normais realmente aplicados em todos os patches/iterações:

```text
normalImpulseVector = sum(normal[i] * appliedNormalImpulse[i])
firstNormalDeltaV  = length(normalImpulseVector) * first.inverseMass
secondNormalDeltaV = length(normalImpulseVector) * second.inverseMass
```

O dano usa esses valores, não `length(velocityAfter - velocityBefore)`, que
inclui atrito tangencial. Não somar módulos por iteração nem usar velocidade
absoluta, correção de posição ou velocidade angular como dano. Atrito, torque e
restituição continuam atuando normalmente na resposta física; a mudança apenas
impede que frenagem tangencial de um raspão infle sua severidade. Contatos
distintos resolvidos em chamadas subsequentes continuam cumulativos.

A calibração de resistência/direção preservada de `2.0.1` ignora contatos abaixo de `5 m/s` de `delta-v`, classifica
dano de direção a partir de `5 m/s`, dano de motor a partir de `10 m/s`, dano
combinado a partir de `18 m/s` e perda total direta a partir de `30 m/s`. Cada
impacto relevante reduz a vida em `delta-v * 1,5`; impactos distintos continuam
cumulativos. O desvio persistente usa somente `0,005` do comando máximo de
esterço, para permanecer discreto em trechos curtos e acumular uma correção
perceptível principalmente em retas longas.

Dano de motor multiplica separadamente o teto de torque por
`engineTorqueMultiplier` e o teto de potência por `enginePowerMultiplier` antes
do `min` do powertrain. Em perda total, os comandos convergem a zero pelas mesmas
rampas, o arrasto aerodinâmico recebe `totalLossDragMultiplier` e soma-se uma
resistência mecânica vetorial `-velocity *
totalLossLinearDragNewtonSecondsPerMeter`. Esse termo explícito representa rodas
ou conjunto mecânico avariado e substitui qualquer desaceleração especial
escondida.

O lado do dano de direção é pseudoaleatório, determinístico e persistente. Para
paridade, calcular um hash inteiro sobre o identificador UTF-16 do veículo com
semente `17` e recorrência `hash = hash * 31 + codeUnit`, usando overflow assinado
de 32 bits. Somar `impactCount + roundHalfUp(deltaV * 10)`; par escolhe `-1` e
ímpar escolhe `+1`. Uma nova batida leve recalcula o lado; sem nova batida, ele
não muda.

## Entrada digital

`moveTowards(current, target, rate * dt)` é usado para acelerador, freio e
esterço. Ao trocar esquerda por direita, a mesma função cruza zero naturalmente.
Nenhuma rampa consulta FPS, relógio de parede ou tipo de dispositivo.

## Planejador determinístico dos bots

Bots escolhem somente `throttle`, `brake` e `steer`. Depois dessa decisão, eles
entram no mesmo integrador, pneus, superfícies, colisores, dano e progressão dos
humanos; dificuldade nunca multiplica potência, aderência, freio, massa ou dano.
Todas as constantes da decisão ficam em `bots.planner`, enquanto `bots.easy`,
`bots.normal` e `bots.hard` alteram apenas ritmo, margem, ruído, antecipação e
recuperação.

Para `speed = length(velocity)` e a projeção atual na racing line:

```text
steeringLookAhead =
  steeringLookAheadBaseMeters
  + speed * steeringLookAheadSpeedSeconds
  + max(0,
        steeringLookAheadReactionReferenceSeconds
        - difficulty.steeringLookAheadPenaltySeconds)
    * steeringLookAheadReactionGainMetersPerSecond

target = racingLine(projectionDistance + steeringLookAhead)
headingError = signedAngleDelta(vehicleAngle, heading(target - position))

vehicleIdSeed = sum of every UTF-16 code unit in vehicleId
noise = sin(simulationTime * steeringNoiseFrequencyRadiansPerSecond
            + vehicleIdSeed)
        * difficulty.steeringNoise

brakingLookAhead =
  brakingLookAheadBaseMeters
  + speed * (brakingLookAheadSpeedSeconds
             + difficulty.recoveryMultiplier
               * brakingLookAheadRecoveryGainSeconds)
```

Começando no alvo de esterço, amostrar `brakingPreviewSampleCount` pontos
igualmente espaçados até `brakingLookAhead` e usar o menor
`targetSpeedFactor`. Então:

```text
targetSpeed = terminalSpeed
              * pow(minimumTargetSpeedFactor,
                    racingLineSpeedFactorExponent)
              * difficulty.paceMultiplier
              * terminalSpeedTargetMultiplier
safeTargetSpeed = targetSpeed / difficulty.brakingSafetyMultiplier
recovering = surface is grass or gravel
needsBraking = speed > safeTargetSpeed
               or abs(headingError) > brakeHeadingErrorThresholdRadians
maximumBrake = maximumBrakeBase
               + difficulty.recoveryMultiplier * maximumBrakeRecoveryGain

throttle = needsBraking
  ? (recovering ? brakingRecoveryThrottle : brakingTrackThrottle)
  : difficulty.paceMultiplier
    * (recovering ? recoveryThrottleMultiplier : trackThrottleMultiplier)
brake = needsBraking
  ? clamp(brakeDemandBase
          + max(0, speed - safeTargetSpeed)
            / brakeDemandSpeedScaleMetersPerSecond,
          0,
          maximumBrake)
  : 0
steer = clamp(headingError / steeringFullScaleHeadingErrorRadians + noise,
              -1,
              1)
```

`maximumBrakeBase + maximumBrakeRecoveryGain` deve ser menor ou igual a `1`.
O planejador é reavaliado em cada passo fixo;
`steeringLookAheadPenaltySeconds` reduz somente a antecipação decisória dos
níveis lentos nessa fórmula, sem introduzir atraso temporal ou vantagem na
física. Não existem parâmetros publicados sem efeito.

## Orquestração determinística da corrida

Os valores em `race` também fazem parte do contrato executável. A duração limite
é `max(minimumRaceDurationSeconds, trackLength /
raceDurationReferenceSpeedMetersPerSecond * laps)`. A projeção global aceita a
margem `progressProjectionMarginMeters`; a projeção local usa
`localProjectionWindowMeters`, amplia a busca por
`localProjectionRecoveryMarginMeters` quando necessário e considera distâncias
equivalentes dentro de `projectionDistanceToleranceMeters`. A grade espacial das
barreiras usa células de `barrierBroadphaseCellMeters`.

A área de pit estende `pitLaneHalfWidthMeters` para cada lado da linha canônica.
A largada acende `startLightCount` estágios, separados por
`startLightStageSeconds`, e aguarda `lightsOutDelaySeconds` antes de liberar a
corrida. Esses valores governam humanos e bots igualmente e não consultam FPS ou
relógio de parede.

## Aerodinâmica

```text
dynamicPressure = 0.5 * airDensity * speedSquared
drag = dynamicPressure * dragAreaM2
downforce = dynamicPressure * liftAreaM2
```

Downforce é dividida pelo balanço dianteiro. Arrasto sempre se opõe à velocidade
mundial. O contrato não contém corte rígido de velocidade.

## Colisões

O monoposto é a união dos polígonos convexos de `vehicle-definition.json`.
Barreiras usam a polilinha da face voltada à pista e sua espessura só para o lado
externo. O narrowphase produz normal, profundidade e ponto(s) de contato. Impulso
no ponto altera velocidade linear e yaw; o atrito tangencial é limitado pelo
impulso normal. Colisão carro-carro usa `carRestitution` e
`carTangentialFriction`. Colisão com barreira consulta obrigatoriamente
`barrierMaterials[material]`; concreto, guardrail, Tecpro e pneus têm
restituição e atrito próprios e não podem cair silenciosamente num valor global.
Em contatos simultâneos com materiais diferentes, cada manifold usa a calibração
do próprio collider antes das iterações do solver.
Cada manifold 2D preserva no máximo `maximumContactPoints=2`, os extremos do
segmento de contato; peças convexas distintas continuam produzindo manifolds
distintos quando seus contatos não coincidem.
CCD varre os colliders entre estado anterior e candidato para impedir tunneling.
Translação usa swept SAT exato. Quando existe rotação, o intervalo é dividido
de modo que a soma dos arcos máximos dos envelopes não exceda
`ccdMaximumAngularArcStepMeters`; cada intervalo possui
`ceil(intervalArc / (ccdMaximumAngularArcStepMeters /
ccdAngularPoseSamplesPerMaximumArcStep))` amostras uniformes na pose real, além
dos candidatos do swept SAT linear. Comparações temporais usam
`ccdTimeEpsilonSeconds`, enquanto a decisão de ativar a varredura rotacional usa
`ccdAngularMotionEpsilonRadians`. Entre dois probes primários, o algoritmo testa
também a pose real do ponto médio quando os envelopes conservadores ainda podem
se cruzar; isso reduz tunneling transitório sem transformar o envelope em contato.
Cada candidato é confirmado na pose realmente rotacionada e o primeiro intervalo ocupado é refinado por
`ccdTimeRefinementIterations`. Um manifold da pose congelada nunca pode, sozinho,
produzir contato invisível.

Objetos e contatos são ordenados por identificador, índice de shape, índice de
segmento e ponto. O solver nunca depende da ordem de iteração de hash maps.
Manifolds de shapes compostos sobrepostos no mesmo corpo são consolidados quando
seus pontos estão até `contactMergeDistanceMeters` e o produto escalar de suas
normais é pelo menos `manifoldNormalMergeCosine`, impedindo aplicar o mesmo
impulso mais de uma vez sem apagar contatos de direções materialmente distintas.
No solver, contatos coplanares e co-normais podem formar um único patch apenas
quando suas velocidades normais locais diferem no máximo
`contactPatchNormalVelocityMergeMetersPerSecond`; contatos afastados com uma
extremidade fechando e outra separando continuam independentes.

## Origem dos valores e estado da calibração

Os limites de referência de `1,90 m` de largura e `3,40 m` de entre-eixos, a
arquitetura de direção dianteira/tração traseira e a referência de massa próxima
de `770 kg` vêm do regulamento técnico FIA 2026 citado na proposta aprovada. O
monoposto original do jogo preserva a silhueta visual já aprovada de `5,60 ×
2,00 m`; seu entre-eixos de `3,248 m` é derivado dos centros métricos das rodas
dessa mesma silhueta. Collider e renderer compartilham esse envelope, portanto a
largura visual não é apresentada como dimensão regulatória oficial. O passo de
`1/120 s` é uma decisão determinística derivada do requisito de CCD e de paridade
em 30/60/120 FPS.

Potência útil de `735 kW`, relações, inércia, `dragAreaM2`, `liftAreaM2`, rigidez
dos pneus, rampas digitais e coeficientes de superfície são **calibração inicial
do jogo**, não números regulatórios. Eles devem ser alterados somente em nova
versão do contrato, sempre juntos nos dois motores. A frenagem é verificada pelo
cenário `miami-reference-braking`, baseado na referência Brembo de `320 → 78
km/h`, `3,66 s` e `165 m`; velocidade terminal é verificada contra a faixa FIA
citada na proposta, sem hard cap. No redline de 15.000 rpm, as oito relações
publicadas correspondem aproximadamente a `105/140/175/210/245/280/315/350
km/h`; isso é auditado a partir da fórmula, e não implementado como limites de
velocidade. `calibrationStatus` só passa de `initial` para
`validated` depois de os cenários automáticos e a validação manual fecharem.

Fontes primárias e datas estão registradas em
`docs/contracts/module-2-physics-v2-proposal.md`; este arquivo não transforma
uma meta de validação em dado oficial do veículo.
