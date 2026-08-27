# Contratos compartilhados do Módulo 2 — v2

Esta linha publica o contrato incompatível `2.0.0` da Parte 2d. Ela substitui a
física cinemática da v1 por uma dinâmica determinística de monoposto e torna a
face visível de cada barreira a geometria canônica de colisão.

## Versões ativas

- contrato físico e schema de pista: `2.0.0`;
- catálogo: `2026.9`;
- unidade de mundo: metro; tempo: segundo; ângulo: radiano anti-horário desde `+x`.

`contracts/module-2/v1/` permanece histórico e imutável. Resultados, salas,
recordes e fantasmas não podem misturar versões físicas.

## Artefatos

- `module-2-decisions.json`: decisões fechadas de produto e compatibilidade;
- `physics-model.md`: fórmulas, sinais e ordem canônica do integrador;
- `physics-constants*.json`: schema e calibração compartilhada, incluindo o
  planejador determinístico dos bots; dificuldade altera decisões, nunca física;
- `vehicle-definition*.json`: dimensões e união de colliders convexos do F1;
- `physics-reference-scenarios*.json`: entradas e faixas de referência;
- `realtime-race-protocol.schema.json`: envelopes planejados do Módulo 3, já
  sem boost/nitro;
- `track-catalog.schema.json`, `catalog.json`, `track-definition.schema.json` e
  `tracks/`: catálogo `2026.9` com faces explícitas e contínuas de barreira,
  perfis visuais de boxes, arquibancadas e edifícios nas 24 pistas, largadas
  auditadas, camadas de elevação para cruzamentos reais e vias especiais de
  escape explicitamente separadas da física.

## Fonte e geração

O backend é a fonte de geração. Execute:

```powershell
node tools/track-catalog/generate-v2.mjs
node tools/track-catalog/audit-v2.mjs
```

As centerlines, superfícies e ambientes de `2026.5` foram preservados. O
catálogo `2026.7` posicionou as zebras fora do asfalto, suavizou proteções,
detalhou os caminhos de pit e removeu landmarks provisórios. O `2026.8` fechou
interrupções de zebra somente quando a curvatura é contínua, distribui cercas
conforme público/circuito de rua e publica arquitetura, paleta e estruturas
representativas de cada autódromo. O `2026.9` substitui as zebras genéricas por
perfis autorais por curva, publica faixa externa pintada, medidas de pits,
edifícios e cercas e impede, por auditoria geométrica, estruturas sobre asfalto,
barreiras ou outras estruturas. O Rettifilo de Monza substitui círculos
provisórios por um corredor asfaltado e fileiras alternadas de blocos puramente
visuais. A polilinha resultante continua sendo
simultaneamente a face visível e física da barreira; a espessura cresce para
fora.

README, decisões, modelo, schemas, constantes, cenários, protocolo e catálogo
devem ser byte-idênticos no frontend e backend. `tracks/*.json` fica somente no
backend, que publica as 24 geometrias pela API; o frontend não embute uma segunda
cópia das pistas em produção.

## Compatibilidade

`GET /api/tracks` e `GET /api/tracks/{id}` publicam esta linha. O cliente deve
enviar `trackCatalogVersion=2026.9` e `physicsContractVersion=2.0.0` ao persistir
resultado ou entrar em sala. Divergência é rejeitada, nunca convertida.
