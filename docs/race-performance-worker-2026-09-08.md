# M2/M3 — desempenho local com 22 carros (08/09/2026)

## Escopo aprovado e estado

O autor autorizou otimizar solo **1 jogador + 21 bots** e local **2 jogadores +
20 bots**, preservando a física, o design e os recursos já existentes. São 22
carros **totais**, não 22 bots além dos humanos.

Esta rodada não inicia o M3c, não implementa um novo protocolo online e não
promove `develop` para `main`. A validação manual destas mudanças continua
pendente. **FPS médio acima de 40 não significa mínimo de 40 em todas as
situações.** A meta de desempenho ainda não foi comprovada.

## O que mudou

- `VehicleBroadphase`: índice espacial conservador de trajetórias para evitar
  testar carros distantes. Preserva a ordem canônica dos pares e atualiza as
  células após cada colisão, inclusive deslocamentos causados por outro carro.
  As hitboxes exatas e o CCD continuam decidindo todos os contatos candidatos.
- `CollisionScratch`: reutilização limitada de vértices temporários do CCD,
  separada por tamanho de polígono. Limpa todos os caches geométricos a cada
  reutilização; copia contatos e normais antes de retornar resultados para que
  uma consulta posterior não os altere. Não muda amostras, equações ou solver.
- `LocalWorkerSimulation` e `local-race.worker.ts`: o mesmo `RaceEngine` e a
  mesma `LocalRaceSession` rodam num Web Worker nas corridas solo/local.
  A física continua a 120 Hz. A recuperação de tempo é dividida em fatias de
  um tick, cedendo execução entre elas para receber comandos e enviar estados.
  `MessageChannel` evita a espera mínima de timers aninhados durante catch-up.
  O limite existente de recuperação de 0,25 s continua aplicado; atraso não é
  ocultado nas medições de tempo simulado versus tempo real.
- `LocalRaceRuntime`: no máximo uma solicitação de estado em trânsito e quatro
  snapshots retidos. Interpola somente a posição/ângulo de desenho, com atraso
  de referência de um quadro a 60 Hz, sem extrapolar a física. Expõe também idade
  do snapshot e tempo da simulação para o diagnóstico não se limitar ao FPS.
- `RaceCanvas`: renderização e captura de controles continuam na thread da
  interface; telemetria React permanece desacoplada. `R`, botão de reinício,
  `Esc`, saída, resultados e cleanup encerram o worker anterior. Abas ocultas
  suspendem a corrida local e limpam o input, sem recuperar todo o tempo da aba.
- Falha antes do primeiro estado permite fallback para o motor síncrono. Falha
  após o início ou worker sem resposta por cinco segundos interrompe a prova
  com aviso de cinco segundos e opção de reiniciar; não reseta silenciosamente
  uma corrida em andamento. O fallback não promete o mesmo desempenho.
- Renderizador: cache de recortes/offsets métricos das zebras e bordas, base
  trigonométrica da câmera, profundidade das faces do carro e caminho vetorial
  do minimapa. Câmeras continuam independentes, pontos e desenhos são os mesmos.
  Não há bitmap proporcional ao circuito inteiro, redução de detalhes, mudança
  de zoom/inclinação, física mais simples ou bots menos capazes.
- Recortes canônicos de muros e grades, incluindo seus offsets métricos,
  também são reutilizados por trecho imutável em vez de recalculados a cada
  quadro. Os caches pertencem ao renderer e usam referências fracas; não
  misturam pistas nem sobrevivem ao encerramento da corrida.
- Descarte conservador de segmentos/polígonos totalmente fora de cada viewport,
  mesmo dentro de chunks visíveis. Mantém traçados inteiros que cruzam a tela,
  bordas grossas, antialiasing e a ordem de desenho. Comparação RGBA com a base
  `9391e7e`: zero diferenças em 192 quadros (24 circuitos, quatro poses por
  circuito, dia/noite, split-screen 1920×1080).

## Compatibilidade com o backend

Nenhum arquivo do backend ou contrato publicado foi alterado. Continua valendo
a física **2.0.3**. O transporte deste worker é exclusivamente interno ao
navegador: não aceita autoridade do cliente numa corrida online e não substitui
o WebSocket. O futuro M3c deve integrar predição/reconciliação de forma explícita,
sem reutilizar automaticamente a sessão local como autoridade online.

## Evidências automatizadas

- `npm run check`: 398 testes em 48 arquivos, lint e build de produção aprovados.
- Referência congelada: 11 cenários / 413 estados, diferenças máximas iguais a
  zero em Node 22, Chrome 152 e Edge 152; não foram regenerados oracles.
- Geometria: 24 circuitos / 648 amostras, incluindo superfície, barreiras e bots,
  idênticos à referência.
- CCD: 512 amostras / 318 contatos, hash
  `8a47702e6a2051c8ed655cd32518fc0a2becc823282d4ea0b2117e2d0ea01e36`.
- Mônaco 2+20, 120 passos de aquecimento + 3.600 passos: estado físico final
  `2bb080541a9d8d80d9ed0869601f0037b1f08fb0a35ccb040676fb2d31a51aa3`,
  preservado também na verificação final do pool por tamanho (6,91 ms por passo
  nesta execução; esse tempo mede CPU, não FPS).
- Testes novos: seleção conservadora de pares em células negativas/limites e
  atualização após impulso; caches sem dados antigos; contatos publicados não
  mutáveis pelo pool; paridade da sessão a 30/60/120 Hz e catch-up fatiado;
  mensagens limitadas; interpolação sem extrapolação; timeout/falha/cleanup;
  pausa de aba; minimapa vetorial e equivalência exata da projeção da câmera.
- `tools/local-worker-browser-smoke.mjs`: React em StrictMode + Vite + Edge real,
  dois controles, reinício por R, saída por Esc e resultado; cinco workers criados
  e cinco encerrados, sem erro de página. Também executa o asset do worker gerado
  pelo build. O teste usa pista sintética, não é validação visual do catálogo.

## Medições de desempenho

Os números abaixo são execuções reais, não estimativas. Hardware/concorrência,
primeira compilação de código, posição dos carros e congestionamento afetam os
resultados. Não rodar benchmarks junto com testes/builds para comparações.

Mônaco, Edge 152, Canvas 1920×1080, dia, 60 segundos, dificuldade normal, humanos
conduzidos pelo mesmo planejador de bots a cada tick para reproduzir carga:

| Caso | FPS médio aproximado | Intervalo p95 | Idade p95 do snapshot | Tempo simulado/real |
|---|---:|---:|---:|---:|
| Base síncrona, 2+20 (com profiler) | 29,0 | 66,7 ms | não se aplica | 94,1% |
| Colisões otimizadas, síncrono, 2+20 (com profiler) | 35,6 | 66,5 ms | não se aplica | 100,0% |
| Worker final fatiado, 1+21 (sem profiler) | 58,8 | 16,8 ms | 20,8 ms | 98,8% |
| Worker final fatiado, 2+20 (sem profiler) | 44,8 | 50,0 ms | 44,9 ms | 100,0% |

A instrumentação da base inclui profiler; portanto, não usar esta tabela para
afirmar uma porcentagem exata de ganho. A queda p95 do local ainda impede
declarar um mínimo sustentado de 40 FPS. O solo também não apresentou razão
simulação/tempo real exatamente igual a 100% nesta execução.

Uma versão intermediária do worker mostrou FPS alto com snapshots atrasados
no solo (p95 ~461 ms); ela foi substituída pelo agendamento fatiado acima.
Uma experiência com cache exclusivamente em WeakMap foi descartada após
regressão de desempenho, sem alterar o estado físico esperado.

### Matriz completa antes do descarte fino de primitivas

08/09/2026, i5-14500 (20 processadores lógicos), Windows 10.0.26200, Edge
headless 152.0.4191.66, 1920×1080/DPR 1, dia, dificuldade normal, 20 segundos
por caso após o semáforo. 48 execuções reais, sem falhas; não são voltas
completas nem teste de hardware universal. O headless pode ter custos gráficos
diferentes do navegador visível. Arquivos originais locais em
`output/performance/matrix-final/` (nome do diretório não significa meta aprovada).
Esta rodada usa o worker fatiado e os caches, **antes** do descarte fino abaixo.

| Circuito (ID) | Solo 1+21 FPS médio | Local 2+20 FPS médio | Local intervalo p95 (ms) |
|---|---:|---:|---:|
| albert-park | 58,9 | 43,9 | 33,4 |
| austin | 52,4 | 32,4 | 50,0 |
| bahrain | 54,3 | 39,4 | 50,0 |
| baku | 58,9 | 40,4 | 33,4 |
| barcelona | 59,8 | 48,1 | 33,4 |
| hungaroring | 53,0 | 37,4 | 50,0 |
| interlagos | 54,9 | 38,4 | 49,9 |
| jeddah | 51,7 | 33,7 | 50,1 |
| las-vegas | 57,8 | 46,1 | 33,4 |
| lusail | 45,9 | 37,5 | 50,0 |
| madrid | 45,9 | 31,1 | 50,1 |
| mexico-city | 60,0 | 44,8 | 33,4 |
| miami | 48,0 | 28,7 | 50,1 |
| monaco | 56,0 | 29,6 | 50,1 |
| montreal | 55,3 | 36,6 | 50,0 |
| monza | 55,9 | 37,8 | 50,0 |
| shanghai | 52,1 | 32,8 | 50,0 |
| silverstone | 59,8 | 37,5 | 33,4 |
| singapore | 50,8 | 34,1 | 50,0 |
| spa-francorchamps | 46,1 | 27,3 | 50,1 |
| spielberg | 58,9 | 41,3 | 33,4 |
| suzuka | 59,7 | 41,8 | 33,4 |
| yas-marina | 59,3 | 43,0 | 33,4 |
| zandvoort | 54,3 | 36,1 | 50,0 |

Não substituir o resultado desfavorável de Mônaco pelo teste de 60 segundos:
posição, congestionamento e janela de medição diferem. Alguns bots já estavam
parados/danificados ao fim da janela (o relatório bruto registra `movingCars`);
não interpretar esses casos como prova de 22 carros em movimento contínuo.

### Verificação gráfica e ajustes incrementais

`tools/race-browser-environment.mjs` confirmou no navegador de testes uma
NVIDIA T400 4 GB, ANGLE/Direct3D11 e aceleração de Canvas/composição/rasterização
habilitada. Não atribuir a matriz baixa a software rendering sem evidência.

Após o descarte fino, a repetição de 20 segundos nos casos pesados registrou:

| Circuito | Solo 1+21 FPS médio | Local 2+20 FPS médio | Local intervalo p95 (ms) |
|---|---:|---:|---:|
| Austin | 53,0 | 33,8 | 50,0 |
| Miami | 53,0 | 29,1 | 50,1 |
| Mônaco | 56,2 | 26,4 | 66,7 |
| Spa | 47,2 | 28,8 | 50,1 |

Resultados locais: `output/performance/matrix-culling/`. Ainda não incluem o
cache adicional dos recortes de muros/grades. A piora de Mônaco impede declarar
ganho universal; congestionamentos e cenas variam entre as execuções.
Um experimento de Canvas opaco, somente no benchmark, resultou em 29,5 FPS no
local de Mônaco e não foi habilitado no aplicativo. O experimento sem blur de
sombras também ficou restrito ao benchmark: não demonstrou benefício nem foi
usado como critério de aprovação. **Sombras continuam preservadas no jogo.**

### Última rodada com os caches de muros/grades — carga concorrente identificada

Execução de 30 segundos por caso, mesmas configurações gráficas. Arquivo local:
`output/performance/final-cache-validation.jsonl`.

| Circuito | Modo | Carros totais | FPS médio | Intervalo p95 | Simulado/real |
|---|---|---:|---:|---:|---:|
| Mônaco | solo | 22 | 48,8 | 33,4 ms | 87,5% |
| Mônaco | local | 22 | 16,3 | 83,4 ms | 80,6% |
| Mônaco | local sem bots | 2 | 59,6 | 16,8 ms | 100,1% |
| Spa | local | 22 | 18,6 | 83,4 ms | 96,2% |

Durante esta rodada, uma consulta somente de processos identificou outro Edge
que não pertencia ao benchmark. Numa janela de dois segundos, um renderer dele
consumiu aproximadamente 1,08 segundo de CPU e seu processo gráfico 0,48 segundo,
concorrendo com a execução automatizada. Nenhuma página foi inspecionada e
nenhum aplicativo do autor foi encerrado. Essa carga também existia durante
o experimento diagnóstico de sombras da tarde; seu resultado não isola o
custo do blur. Não atribuir toda a queda à concorrência nem ao novo cache:
**repetir A/B controlado antes de concluir ganho/regressão ou aprovar 40 FPS**.
Também não esconder a desaceleração da simulação por trás do FPS do Canvas.

### Repetição controlada de 09/09/2026

Após interromper outros testes e cargas conhecidas, a suíte foi repetida no Edge
152 por 30 segundos em cada caso. Nenhuma corrida, vídeo ou benchmark adicional
foi iniciado pelo processo de validação durante as medições. Os resultados brutos
ficam em `output/performance/controlled-2026-09-09.jsonl` (arquivo local ignorado
pelo Git).

| Circuito | Condição | FPS médio aproximado | Intervalo p95 | Simulado/real |
|---|---|---:|---:|---:|
| Mônaco | solo 1+21, dia, 1920x1080 | 58,0 | 16,8 ms | 93,1% |
| Mônaco | local 2+20, dia, divisão vertical | 24,7 | 83,3 ms | 94,0% |
| Spa | local 2+20, noite, divisão horizontal 1080x1920 | 32,5 | 50,1 ms | 100,1% |
| Mônaco | local 2+0, dia, divisão vertical | 59,3 | 16,8 ms | 100,0% |

O caso-controle 2+0 demonstra que o split-screen isolado continua fluido neste
hardware. O grid completo, especialmente em congestionamento, permanece abaixo
de 40 FPS no modo local; portanto, esta rodada **não encerra nem garante** a meta
universal de 40 FPS. O solo de Mônaco desenhou próximo de 60 FPS, mas também não
pode ser aprovado como tempo real enquanto a razão simulada permanecer em 93,1%.
O patch segue publicável em rascunho por preservar física e imagem e por melhorar
a arquitetura, mantendo essa pendência explícita para a próxima rodada.

### Segunda revisão de colisões de 09/09/2026

O perfil prolongado mostrou que o custo restante em congestionamentos vinha
principalmente da reconstrução das 22 peças convexas de cada monoposto e de
objetos temporários do CCD. A revisão adicional:

- reescreve somente os buffers privados de poses já pertencentes à consulta de
  colisão, sem publicar geometria mutável para o renderer ou snapshots;
- conserva convexidade e raio sob transformações rígidas e invalida limites,
  eixos e centros dependentes da pose;
- reutiliza os invólucros do arena temporário e as opções imutáveis de resposta;
- evita objetos de projeção, mapas intermediários e pares `{ collider, bounds }`
  descartáveis no SAT/CCD;
- compartilha a projeção já calculada antes da integração entre o planejador do
  bot e a consulta de superfície, sem alterar comandos ou materiais;
- preserva o segundo passe de barreiras para todo carro que tocou um muro ou
  outro carro. Um experimento que considerava apenas contatos carro-carro parecia
  mais rápido, mas divergiu no teste prolongado e foi removido antes da publicação.

Em Mônaco local 2+20, com 120 passos de aquecimento e 3.600 medidos, o custo de
CPU caiu de 6,91 ms por passo na evidência anterior para 4,43 ms por passo nesta
execução. O estado final permaneceu exatamente
`2bb080541a9d8d80d9ed0869601f0037b1f08fb0a35ccb040676fb2d31a51aa3`.
Em cinco execuções mais curtas de 1.200 passos, a mediana foi 2,92 ms por passo.
Esses tempos são diagnósticos locais e não constituem um gate dependente de
hardware.

A referência continuou exata em 24 circuitos/648 amostras e em 512 sweeps CCD
(318 contatos), com hash
`8a47702e6a2051c8ed655cd32518fc0a2becc823282d4ea0b2117e2d0ea01e36`.
O modelo visual também deixou de recriar, para cada carro e quadro, os mesmos
vetores imutáveis de cockpit, pintura, volante, suspensão e sombra. O traçado e
a ordem de pintura não mudaram. Uma tentativa de agrupar faces em um único fill
foi rejeitada antes da publicação porque alterava antialiasing/oclusão; ela não
faz parte da branch.

### Validação final equivalente de 09/09/2026

Depois da revisão de colisões e da remoção de alocações visuais, foram executados
novamente casos reais no Edge 152. O arquivo bruto local ignorado pelo Git é
`output/performance/final-equivalent-2026-09-09.jsonl`.

| Circuito | Condição | FPS médio aproximado | Intervalo p95 | Renderer médio | Simulado/real |
|---|---|---:|---:|---:|---:|
| Mônaco | solo 1+21, dia, 1920x1080 | 57,6 | 16,9 ms | 3,52 ms | 100,1% |
| Mônaco | local 2+20, dia, divisão vertical | 31,5 | 50,0 ms | 7,88 ms | 100,1% |
| Spa | local 2+20, noite, divisão horizontal 1080x1920 | 30,7 | 50,1 ms | 8,40 ms | 100,0% |
| Mônaco | local 2+0, dia, divisão vertical | 59,7 | 16,8 ms | 4,85 ms | 100,1% |

Em todos os casos a física acompanhou o relógio real. O controle 2+0 confirma que
o split-screen e o ambiente do navegador não impõem sozinhos o teto próximo de
30 FPS. O custo restante aparece com muitos monopostos visíveis e com a física
do grid completo, duplicando o desenho detalhado no modo local. O solo sustenta
quase 60 FPS; Mônaco e Spa locais continuam abaixo de 40 FPS.

`npm run check` aprovou 398 testes/48 arquivos, lint e build. O smoke do worker
no Edge aprovou cinco ciclos de criação/encerramento, reinício, saída e resultado.
A comparação visual repetida em Mônaco, Austin, Suzuka e Spa, dia/noite e quatro
quadros por caso, manteve **zero canais diferentes** da base `9391e7e`.

Assim, esta entrega melhora e estabiliza a arquitetura sem alterar pixels nem
física, mas **não satisfaz a meta universal de 40 FPS no local com 2+20**. Para
buscar esse último patamar será necessário um passo arquitetural maior no
renderer, como uma migração mais ampla para WebGL, ou aceitar cache/LOD com
equivalência perceptiva em vez de igualdade RGBA. Nenhuma dessas concessões foi
aplicada silenciosamente nesta rodada.

### Experimento de renderização paralela descartado

Foi prototipada uma segunda etapa com `OffscreenCanvas` e um worker exclusivo
para o renderer. No Edge, em Mônaco local 2+20, dia e 1920x1080, o resultado
caiu para aproximadamente **19,1 FPS**, com intervalo p95 de **150 ms** e apenas
**91,8%** de tempo simulado/real. A serialização dos 22 estados visuais e a
concorrência entre os workers de física e desenho custaram mais do que o trabalho
retirado da thread principal.

O experimento foi rejeitado e removido integralmente antes da publicação. Não há
`OffscreenCanvas`, protocolo ou worker de renderização no código entregue.
Portanto, “separar os viewports em outro worker” deixa de ser uma recomendação
para esta arquitetura Canvas 2D. O cache com equivalência perceptiva testado em
seguida está descrito abaixo; WebGL e a manutenção do visual RGBA exato continuam
como alternativas, não como mudanças aplicadas.

### Cache perceptivo dos monopostos remotos

Para grids densos em qualidade baixa, os monopostos que não são o foco da câmera
passam a reutilizar sprites transparentes em alta resolução. O carro focal de
cada viewport continua no painter vetorial contínuo. O cache:

- usa poses em intervalos de dois graus, o que limita o deslocamento máximo da
  extremidade de um carro remoto a aproximadamente um pixel na escala aprovada;
- rasteriza em 2× e reduz na composição final, preservando bordas e detalhes;
- separa corpo e sombra. A sombra é compartilhada entre cores e danos e mantém
  seu deslocamento angular contínuo, evitando multiplicar combinações no cache;
- preserva cor e cada estado de dano em entradas distintas;
- é LRU e limitado a 16 milhões de pixels de backing store, cerca de 61 MiB RGBA;
- só entra com pelo menos dez carros e nunca altera física, colisão, pista,
  câmera, minimapa, HUD ou a escala do carro.

O benchmark ganhou uma chave A/B (`PERF_DISABLE_VEHICLE_SPRITES=1`) e a auditoria
de imagem passou a informar erro absoluto/RMS, mantendo falha por qualquer pixel
diferente no modo exato e permitindo auditoria explícita com
`PERF_PERCEPTUAL_AUDIT=1`.

A primeira matriz do cache percorreu os 24 circuitos, com 1+21 e 2+20, durante
oito segundos por caso e os 22 carros em movimento. As 48 execuções ficaram
entre **42,0 e 59,5 FPS** de média e não tiveram falhas. Depois, corpo e sombra
foram separados para eliminar a troca excessiva observada no pior caso:

| Circuito | Condição final refinada | FPS médio aproximado | Intervalo p95 | Simulado/real |
|---|---|---:|---:|---:|
| Las Vegas | local 2+20, dia, 1920x1080, 20 s | 57,9 | 16,9 ms | 100,2% |
| Mônaco | local 2+20, dia, 1920x1080, 60 s | 59,6 | 16,8 ms | 100,0% |
| Spa | local 2+20, noite, horizontal 1080x1920, 30 s | 58,3 | 16,8 ms | 100,0% |

Na auditoria de quatro pistas em dia/noite, o erro absoluto médio ficou abaixo
de **0,35 nível de canal em 255**. As capturas foram inspecionadas em resolução
original sem diferença perceptível; igualdade RGBA não é alegada para os carros
remotos. O carro focal permanece no caminho vetorial exato. Esses resultados são
evidência no hardware de teste, não garantia de FPS mínimo em todo equipamento ou
em cada frame; a validação manual do autor ainda é necessária.

O gate final aprovou `npm run check` com **403 testes/49 arquivos**, lint e build,
além do smoke real do Edge (cinco workers criados e encerrados), 24 circuitos/648
amostras de geometria e 512 sweeps CCD/318 contatos com o hash de referência
`8a47702e6a2051c8ed655cd32518fc0a2becc823282d4ea0b2117e2d0ea01e36`.

### Correção da cadência visual nas curvas — 09/09/2026

A validação manual posterior da otimização encontrou pequenas travadas visuais
durante curvas, inclusive com um único carro, embora o FPS permanecesse alto.
O problema não estava na física: o buffer de interpolação tinha exatamente um
quadro de 60 Hz (16,7 ms), enquanto a idade normal dos snapshots do worker
ficava ligeiramente acima desse limite. O renderer alcançava o snapshot mais
novo, mantinha a câmera parada por um quadro e saltava quando a próxima mensagem
chegava. A troca de direção tornava esse defeito muito mais perceptível.

A correção:

- mantém três quadros de 60 Hz (50 ms) e até seis snapshots para absorver a
  variação normal entre `requestAnimationFrame` e o worker;
- interpola também o vetor de movimento usado exclusivamente pela orientação
  visual da câmera, em vez de trocar sua direção a cada mensagem;
- quando o worker divide uma recuperação em vários passos, marca o snapshot com
  o instante realmente simulado, descontando o tempo ainda pendente. A entrega
  continua responsiva mesmo com 22 carros, sem publicar um estado intermediário
  como se ele já estivesse no relógio atual;
- acrescenta diagnóstico de esvaziamento do buffer ao benchmark e regressões
  automatizadas para snapshots a 30 Hz entregues um quadro atrasados.

Não foram alterados passo fixo, fórmulas, controles, colisões, dano, pistas,
câmera aprovada ou tuning. O atraso existe somente na apresentação Canvas e é
limitado a 50 ms; comandos e autoridade física continuam no worker em 120 Hz.

O gate aprovou 405 testes em 49 arquivos, lint e build. O smoke no Edge aprovou
cinco ciclos de criação/encerramento e o worker do bundle. Em Mônaco local 2+20,
20 segundos, a medição final registrou aproximadamente 58,4 FPS e 100,2% de
tempo simulado/real. Os quatro esvaziamentos diagnosticados coincidiram com uma
pausa isolada do Edge de até 149,6 ms, não com a cadência normal das curvas.
A confirmação visual no navegador do autor permanece obrigatória.

## Ponto de retomada

- Código e documentação na branch `codex/race-performance-worker`; suíte completa,
  smoke do worker, auditoria visual e medições finais foram repetidos. Física,
  CCD e geometria permanecem exatos; carros remotos usam equivalência perceptiva.
- A matriz incluiu 1+21 e 2+20 nos 24 circuitos. A repetição final prolongada
  cobriu os três casos críticos, noite e divisão horizontal, todos próximos de
  58–60 FPS e 100% de tempo simulado/real. Resta a validação manual no navegador
  e hardware do autor antes de declarar a meta aprovada fora do ambiente medido.
- O autor autorizou publicar código, métricas e pendências na issue #60 e em PR
  **em rascunho** para `develop`. Não há autorização para mesclar nem promover
  esta rodada para `main`.
- Nenhuma mudança no backend é necessária para este patch equivalente; se
  um próximo passo alterar a matemática ou o contrato, exigir revisão de
  paridade sincronizada antes de publicar.

## Como reproduzir e ampliar

```powershell
npm run check
node tools/local-worker-browser-smoke.mjs
node tools/race-performance.mjs --ccd-samples
node tools/race-performance.mjs --geometry-parity
$env:PERF_MODES = 'solo,local'
$env:PERF_CARS = '22'
$env:PERF_TRACK = 'monaco'
$env:PERF_FRAMES = '10000'
$env:PERF_MAX_SECONDS = '60'
node tools/race-performance.mjs --browser --fixed-driving --worker
```

Para as 24 pistas, `node tools/race-performance-matrix.mjs` executa casos
sequenciais de 20 segundos para solo e local, gravando JSONL e identificação de
hardware em `output/performance/matrix/`. `PERF_TRACKS` restringe circuitos,
`PERF_MAX_SECONDS` altera a duração e `PERF_MATRIX_DIR` separa rodadas. A opção
`PERF_REPORT` do benchmark individual também guarda os resultados. Todos esses
arquivos são locais/ignorados pelo Git; o relatório publicado deve identificar
quais casos realmente foram medidos e nunca preencher os demais com números
simulados. Esses testes curtos não equivalem a completar cada circuito.

Os verificadores de referência ficam no backend; o de navegador requer Node
24.x. Usar os verificadores de runtime/navegador, nunca regenerar referências
para esconder divergências.

## Validação manual ainda necessária

1. Mônaco e Spa: solo 1+21 e local 2+20, da largada ao congestionamento das curvas;
   testar também local sem bots e dificuldade alta. Observar comandos e fluidez
   real dos carros, não só contador de FPS.
2. Aceleração, freio, ré e esterço dos dois jogadores, contatos carro-carro/muro,
   dano, checkpoints, voltas e chegada.
3. Dia/noite, Suzuka por baixo/por cima, zebras/bordas, minimapas, boxes e carros;
   redimensionar a janela para dividir horizontalmente também.
4. Alternar aba, voltar, reiniciar repetidamente por R/botão e sair por Esc/botão;
   a prova anterior não deve continuar consumindo CPU em segundo plano.

Se o mínimo de 40 continuar obrigatório em todos os instantes, a entrega não
pode ser marcada como desempenho aprovado só por ter média acima desse valor.
Qualquer proposta adicional de reduzir detalhes, limite de carros ou fidelidade
física exige nova decisão do autor; esta rodada não toma essa liberdade.
