# Contratos compartilhados do Módulo 2 — v2

Esta linha publica o contrato incompatível `2.0.0` da Parte 2d. Ela substitui a
física cinemática da v1 por uma dinâmica determinística de monoposto e torna a
face visível de cada barreira a geometria canônica de colisão.

## Versões ativas

- contrato físico e schema de pista: `2.0.0`;
- catálogo: `2026.6`;
- unidade de mundo: metro; tempo: segundo; ângulo: radiano anti-horário desde `+x`.

`contracts/module-2/v1/` permanece histórico e imutável. Resultados, salas,
recordes e fantasmas não podem misturar versões físicas.

## Artefatos

- `module-2-decisions.json`: decisões fechadas de produto e compatibilidade;
- `physics-model.md`: fórmulas, sinais e ordem canônica do integrador;
- `physics-constants*.json`: schema e calibração compartilhada;
- `vehicle-definition*.json`: dimensões e união de colliders convexos do F1;
- `physics-reference-scenarios*.json`: entradas e faixas de referência;
- `realtime-race-protocol.schema.json`: envelopes planejados do Módulo 3, já
  sem boost/nitro;
- `track-catalog.schema.json`, `catalog.json`, `track-definition.schema.json` e
  `tracks/`: catálogo `2026.6` com faces explícitas de barreira.

## Fonte e geração

O backend é a fonte de geração. Execute:

```powershell
node tools/track-catalog/generate-v2.mjs
node tools/track-catalog/audit-v2.mjs
```

As centerlines, superfícies, zebras, cenários e ambientes de `2026.5` foram
preservados. Para cada lado de cada trecho, o gerador desloca a centerline pela
meia largura local mais a soma das áreas de escape. A polilinha resultante é a
face da barreira voltada à pista; a espessura cresce para fora.

README, decisões, modelo, schemas, constantes, cenários, protocolo e catálogo
devem ser byte-idênticos no frontend e backend. `tracks/*.json` fica somente no
backend, que publica as 24 geometrias pela API; o frontend não embute uma segunda
cópia das pistas em produção.

## Compatibilidade

`GET /api/tracks` e `GET /api/tracks/{id}` publicam esta linha. O cliente deve
enviar `trackCatalogVersion=2026.6` e `physicsContractVersion=2.0.0` ao persistir
resultado ou entrar em sala. Divergência é rejeitada, nunca convertida.
