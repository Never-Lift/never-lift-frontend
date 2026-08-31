# Módulo 2 — auditoria de fidelidade visual das 24 pistas (`2026.9`)

## Estado

Implementação automatizada concluída; validação manual integrada pendente. Esta revisão não marca a Parte 2d nem o Módulo 2 como prontos e não libera o início do Módulo 3.

## Objetivo e limites

Esta rodada refina a infraestrutura necessária para a leitura das 24 pistas: zebras, boxes, pit lane, construções principais, arquibancadas, cercas, barreiras, áreas laterais e cruzamentos em níveis diferentes. Ela preserva o contrato físico `2.0.0`, a unidade métrica, as centerlines e o catálogo histórico `v1`.

O trabalho não adiciona cenário temático completo, publicidade real, vegetação detalhada ou funcionamento de parada nos boxes. Esses itens permanecem nas fases indicadas no guia de design. Estruturas são ilustrações originais do Never Lift e não reproduções de arquitetura ou marcas comerciais em nível fotográfico.

## Método e hierarquia de fontes

1. Mapas de circuito, desenhos de pit lane, notas de prova e mapas de emergência da FIA são a referência técnica principal.
2. Mapas e guias dos próprios circuitos ou promotores complementam larguras, edifícios, arquibancadas e organização do público.
3. Materiais técnicos de fornecedores e organizadores ajudam a conferir cercas e proteções.
4. [Grand Prix Guides](https://grandprixguides.com/) é usado somente como referência visual secundária por satélite para conferir posição relativa de pista, boxes, arquibancadas, grama, brita e asfalto externo. Cada `TrackDefinition.source.environmentReferences` registra o link direto do respectivo circuito e a data da consulta (`2026-08-27`).

Nenhuma geometria, imagem, chave de mapa ou ativo de terceiro é incorporado ao jogo. As coordenadas finais continuam sendo os dados métricos autorais e reproduzíveis do contrato.

Para o México, a revisão conserva o último estado técnico verificável de 2025. Para Madrid, que ainda não possui documentação FIA equivalente de uma prova concluída, foi usada a geometria mais recente do projeto oficial Madring. Esses limites ficam explícitos na proveniência e exigem nova auditoria se as configurações oficiais mudarem.

## Alterações aplicadas

- As zebras deixaram de depender de uma escolha global das curvas mais fortes. As 24 pistas agora usam âncoras explícitas por curva numerada, com lado, trecho de ápice/saída, largura, cadência, paleta e pintura externa próprias.
- Lacunas só são unidas quando representam uma pequena emenda contínua de até `1,5 m`; não se inventa pintura longa entre curvas diferentes.
- Boxes, pit lanes, garagens, pit walls e coberturas usam dimensões em metros e intervalos próprios por circuito.
- A geração rejeita pit lane atravessando o asfalto principal ou qualquer face de barreira durante o trecho de garagens.
- Construções e arquibancadas usam posição e dimensões autorais explícitas. O gerador não as desloca silenciosamente para “encontrar espaço”.
- A geração rejeita estruturas sobre asfalto, barreiras ou outras estruturas. As cercas de proteção de público são derivadas da posição final das arquibancadas.
- Circuitos urbanos definidos como totalmente cercados mantêm proteção contínua; autódromos e circuitos híbridos recebem cercas somente nos trechos que justificam proteção de público.
- Em Mônaco, margens grosseiras que invadiam o braço vizinho foram estreitadas, mantendo as barreiras próximas características do circuito urbano.
- Em Xangai, a margem interna da curva 1 foi ajustada para preservar o corredor real dos boxes sem cruzar a barreira da curva adjacente.
- Em Suzuka, a camada elevada inteira é composta uma única vez com opacidade contextual; os círculos acumulados da implementação anterior deixam de aparecer sobre asfalto, grama ou brita.
- Em Monza, os cinco círculos provisórios foram removidos. `sceneryLayout.escapeRoads` publica a via asfaltada de escape do Rettifilo e cinco fileiras alternadas de blocos vermelho/branco que formam o slalom. A camada declara `affectsPhysics: false`, não altera `trackLimits`, `barrierGeometry`, chunks físicos, checkpoints ou o `RaceEngine`.
- O renderer desenha o pavimento da via depois do ambiente e antes do asfalto principal; os blocos aparecem depois dos detalhes da pista e antes dos veículos. O culling é feito por segmento e por viewport, inclusive em split-screen.

## Foco revisado por circuito

| Circuito | Foco desta revisão | Referências publicadas |
|---|---|---:|
| Albert Park | boxes temporários, reta principal, arquibancadas Jones/main e transições entre grama e asfalto externo | 6 |
| Xangai | complexo de boxes, arquibancada principal/lotus e separação entre pit lane e curva 1 | 6 |
| Suzuka | boxes, arquibancadas, zebras por curva e cruzamento inferior/superior sem artefatos | 8 |
| Bahrain | arquitetura de boxes no deserto, arquibancadas e escapes de asfalto/brita | 8 |
| Jeddah | corredor urbano, boxes e cercas contínuas | 8 |
| Miami | estruturas temporárias, estádio, escapes asfaltados e cercas contínuas | 8 |
| Montreal | paddock, arquibancadas e alternância entre barreiras próximas e áreas laterais | 8 |
| Mônaco | largura urbana compacta, barreiras próximas, boxes e prevenção de invasão entre braços | 7 |
| Barcelona | pit complex permanente, reta principal, arquibancadas e escapes mistos | 7 |
| Spielberg | pit building, arquibancadas e faixas de brita/asfalto nos limites de pista | 5 |
| Silverstone | Wing, reta internacional, arquibancadas e grandes áreas de escape | 7 |
| Spa-Francorchamps | boxes, estruturas de Raidillon e transições extensas entre grama, brita e asfalto | 7 |
| Hungaroring | reta/boxes, arquibancadas e escapes compactos do autódromo | 5 |
| Zandvoort | boxes compactos, arquibancada Tarzan, brita e perfil estreito | 5 |
| Monza | pit complex, zebras, escapes e via visual em slalom do Rettifilo | 6 |
| Madrid | implantação mais recente do projeto oficial, IFEMA e infraestrutura provisória | 5 |
| Baku | corredor urbano estreito, boxes, barreiras e cercas contínuas | 5 |
| Singapura | pit building, Super Pit Grandstand e proteção urbana contínua | 5 |
| Austin | pit complex, arquibancadas de T1 e limites amplos do autódromo | 4 |
| Cidade do México | configuração técnica verificável de 2025, pit complex e Foro Sol | 3 |
| Interlagos | pit lane à esquerda, arquibancadas e trechos mistos de barreira/grama | 5 |
| Las Vegas | pit building, estruturas urbanas e cercas contínuas | 7 |
| Lusail | boxes/coberturas, arquibancadas e cercas parciais de público | 7 |
| Yas Marina | pit complex, arquibancadas, áreas asfaltadas e ambiente de marina | 4 |

## Contrato e compatibilidade

- `schemaVersion`: `2.0.0`;
- `catalogVersion`: `2026.9`;
- `physicsContractVersion`: `2.0.0`;
- `sceneryLayout.escapeRoads`: coleção obrigatória, vazia onde não existe uma via especial publicada;
- uma via possui `id`, tipo, camada de elevação, largura, caminho métrico e fileiras de obstáculos, sempre com `affectsPhysics=false` nesta versão;
- backend e frontend rejeitam tipo, paleta, dimensão, coordenada, camada ou identidade duplicada incompatível;
- o frontend não embute as 24 definições: somente os artefatos compartilhados ficam no repositório, e as pistas completas são entregues pela API.

## Validações automatizadas

- geração determinística e `--check` do catálogo `2026.9`;
- auditoria das 24 pistas, incluindo cobertura contínua de barreiras, elevação, zebras, medidas de pits, cercas, estruturas e ausência de sobreposição;
- validação específica de entrada/saída, divergência do traçado e alternância das aberturas da via de escape de Monza;
- importação Java e respostas REST do catálogo;
- compatibilidade do payload no frontend;
- ordem de renderização, culling, camada de elevação e alternância visual dos blocos;
- comparação determinística provando que adicionar `escapeRoads` não muda o estado nem o resultado do `RaceEngine`.

## Validação manual pendente

Antes de concluir esta revisão, conferir no preview as 24 pistas, com atenção especial a:

- zebras nos ápices e saídas corretos, sem pintura atravessando retas;
- boxes, arquibancadas e prédios sem invadir pista, barreira ou outra estrutura;
- cercas coerentes com circuitos urbanos e áreas de público;
- passagem por baixo de Suzuka sem círculos ou opacidade aplicada ao terreno inferior;
- via de escape do Rettifilo legível, pavimento bem conectado e fileiras alternadas sem ocultar o carro;
- estabilidade visual e culling em tela única e split-screen.
