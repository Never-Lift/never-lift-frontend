# Módulo 2 — auditoria de proteções e referências de frenagem (`2026.10`)

## Estado

Implementação automatizada concluída; validação manual pendente. Esta revisão
não conclui a Parte 2d nem o Módulo 2. Boxes, arquibancadas e construções não
foram alterados nesta rodada, conforme o recorte aprovado.

## Método e fontes

A revisão confrontou as 24 definições métricas do catálogo com as referências
FIA, dos autódromos e dos promotores já publicadas em
`TrackDefinition.source.environmentReferences`. Os mapas de satélite e as
descrições curva a curva do [Grand Prix Guides](https://grandprixguides.com/)
foram usados como verificação visual secundária de zebras, limites, proteções e
zonas de frenagem. Madrid continua baseado no projeto oficial mais recente e
permanece provisório enquanto não houver uma camada de satélite verificável do
circuito construído.

## Correções compartilhadas

- A face canônica de cada barreira continua sendo simultaneamente visual e
  física. O gerador agora limita a inclinação da transição lateral e também o
  afastamento no lado interno de curvas apertadas. Isso impede laços,
  auto-interseções e mudanças bruscas de largura, principalmente em Tecpro e
  barreiras de pneus.
- A espessura visual deixa de ser uma sequência de retângulos cobertos por
  círculos. Muros inteiros são extrudados como uma faixa contínua com junções
  limitadas, tampas somente nas extremidades reais e espessura sempre para fora
  da pista.
- As grades usam a mesma faixa estabilizada da barreira como base. Malha,
  travessa e postes compartilham os mesmos vértices; não há mais cortes ou
  quinas produzidos por normais recalculadas em cada amostra.
- As zebras continuam autorais por curva e fora do asfalto. O catálogo mantém
  as posições auditadas em `2026.9`; esta rodada não volta a inferir zebras por
  uma regra global.
- A estrutura inferior do cruzamento de Suzuka usa pontas retas. Os semicírculos
  escuros que apareciam no começo e no fim da faixa transparente foram
  removidos, sem mudar a composição isolada nem a opacidade contextual.

## Rettifilo, Monza

A via asfaltada usa a mesma cor e superfície física do circuito, sai tangente à
reta de aproximação do Rettifilo, permanece predominantemente reta enquanto o
circuito contorna a primeira chicane e reconecta depois dela. O acesso publica
`barrierOpenings` entre `440 m` e `590 m` no lado esquerdo. O mesmo intervalo é
removido da colisão e do desenho do traçado principal, portanto o muro não corta
a via. Cinco fileiras alternadas de blocos brancos com chevrons vermelhos
reproduzem o procedimento publicado pela FIA para as curvas 1–2 e a aparência
da referência fotográfica. O corredor tem
`affectsPhysics: true`: as fileiras dificultam a passagem e somente a borda
esquerda/externa usa `concrete-wall`; renderer, frontend e backend derivam esses
colliders da mesma polilinha, sem uma parede interna falsa.

## Placas regressivas de frenagem

`sceneryLayout.brakingMarkers` publica placas brancas com texto preto, em escala
métrica, imediatamente antes da face canônica da proteção externa. O renderer
usa placas de 3 m de largura e 2,1 m de altura para preservar a leitura no
enquadramento 2.5D sem desproporção com o mundo. Cada
sequência termina em `50 m` e regride de 50 em 50. Placas de `250 m` e `300 m`
existem somente em aproximações excepcionalmente rápidas; curvas já abordadas
em baixa velocidade não recebem decoração artificial.

| Circuito | Aproximações publicadas |
|---|---|
| Albert Park | T1/T3 desde 150 m; T11 desde 200 m |
| Shanghai | T1 200 m; T6 150 m; T14 250 m |
| Suzuka | T1/T11 150 m; T16 200 m |
| Bahrain | T1 250 m; T4/T14 200 m; T8 150 m; T10 100 m |
| Jeddah | T1/T27 200 m; T13 150 m |
| Miami | T1/T11 150 m; T17 250 m |
| Montréal | T1/T6 150 m; T10 250 m; T13 200 m |
| Mônaco | Sainte Dévote 100 m; chicane após o túnel 150 m |
| Barcelona | T1 250 m; T4 150 m; T10 200 m |
| Spielberg | T1 150 m; T3/T4 250 m |
| Silverstone | T3/T6 150 m; Stowe 200 m; Vale 150 m |
| Spa-Francorchamps | La Source 150 m; Les Combes/Bus Stop 250 m; Bruxelles 100 m |
| Hungaroring | T1 250 m; T2 150 m; T12 100 m |
| Zandvoort | Tarzan 200 m; T8 100 m; T11 150 m |
| Monza | Rettifilo 300 m; Roggia 250 m; Ascari 200 m; Parabolica 150 m |
| Madrid (provisório) | T1/T14 150 m; T4/T21 200 m |
| Baku | T1 300 m; T3/T15 200 m; T7 150 m |
| Singapore | T1/T7/T16 150 m; T13 100 m |
| Austin | T1 200 m; T11 150 m; T12 250 m; T15 100 m |
| Cidade do México | T1 300 m; T4 200 m; T12 100 m |
| Interlagos | T1/T4 200 m; T10 100 m |
| Las Vegas | T1 300 m; T5/T12 200 m; T14 250 m |
| Lusail | T1 200 m; T6 100 m; T13 150 m |
| Yas Marina | T1/T14 150 m; T6 250 m; T9 200 m |

## Garantias automatizadas

- geração determinística e `--check` do catálogo `2026.10`;
- schema exige placas completas e aberturas de barreira explícitas;
- auditoria verifica IDs, sequência regressiva, lado, elevação, proximidade da
  proteção e cobertura composta por faces mais aberturas declaradas;
- somente Monza possui a abertura `escape-road-access` nesta revisão, e somente
  o Rettifilo possui uma via de escape física com blocos brancos/chevrons
  vermelhos e muro de concreto limitado à borda externa;
- as 24 pistas mantêm ao menos duas zonas materiais de frenagem, com a exceção
  deliberadamente compacta de Mônaco ainda coberta por duas aproximações;
- testes do renderer verificam faixa única de barreira, tampas apenas nas pontas
  reais, placa na camada correta e pontas retas na ponte de Suzuka;
- os artefatos comuns de `contracts/module-2/v2` permanecem byte a byte idênticos
  entre backend e frontend.

## Validação manual pendente

Repassar as 24 pistas no preview, com atenção especial a muros grossos em
chicanes/hairpins, transições entre materiais, começo e fim de grades e leitura
das placas em velocidade. Em Monza, confirmar que o corredor reto do Rettifilo
parte da reta e reconecta depois da chicane, que cada fileira branca/vermelha
colide sem invadir o traçado principal, que não existe muro na borda interna e
que o muro externo não deixa lacunas. Em Suzuka, confirmar que não restou nenhum
semicírculo escuro nas duas extremidades da camada superior transparente.
