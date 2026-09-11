# M2 — cadência visual e comandos locais (10/09/2026)

> Atualização de 11/09: novo relato manual mostrou travadas sem bots na preview
> com esta correção. A revisão em `race-corner-stutter-2026-09-11.md` substitui
> o uso de worker para até dois carros por execução direta; mantém os ajustes
> de input e o worker para grids maiores. Este relatório conserva as evidências
> históricas, não representa aprovação manual da fluidez.

## Motivo e escopo

O autor relatou saltos do cenário nas curvas, inclusive sem bots, atraso crescente
de comandos com o grid cheio e perda de toques nas setas. A gravação enviada tem
47 segundos, 1920×980, e mostra Spa em tela dividida com vários carros. Quadros
foram extraídos localmente para identificar o cenário; o vídeo não é publicado.

Esta correção é somente do frontend solo/local. Não altera `RaceEngine`, fórmulas,
constantes físicas 2.0.3, colisores, traçados, desenho dos carros, resolução,
inclinação, zoom ou regras de movimento da câmera. Não implementa o M3c.

## Causas encontradas e mudanças

1. **Comandos dependentes da resposta visual:** `advanceFrame` descartava o input
   quando já havia pedido de snapshot em andamento. Além disso, um keydown/keyup
   entre dois RAFs desaparecia antes da leitura. `KeyboardControls` agora notifica
   cada mudança real; `LocalRaceRuntime.setInputs` envia apenas mudanças, sem
   aguardar snapshot, enquanto o RAF continua atualizando a adaptação de ré.
2. **Toques recebidos juntos:** o worker mantém transições por piloto em
   `LocalInputBuffer`. Cada transição é oferecida à simulação por pelo menos um
   passo de 120 Hz. Não há repetição automática de keydown nem fila de estados
   idênticos. Os dois jogadores são consumidos em paralelo. A fila tem limite
   explícito, sem descarte silencioso; pausa limpa todos os estados.
3. **Dois relógios visuais variáveis:** o snapshot era datado com o horário após
   o cálculo, e o render era amostrado com `performance.now()` dentro do callback.
   Custo variável de física/render poderia parecer variação de deslocamento.
   Agora o timestamp da pose exclui o custo de cálculo e o render usa o relógio
   estável fornecido pelo RAF. As duas viewports recebem a mesma amostra.
4. **Cadência do transporte:** pedidos de snapshot são renovados ao receber a
   resposta, sem esperar o próximo RAF; permanece no máximo um pedido pendente,
   com publicação limitada a 120/s. A janela conserva até oito snapshots. O atraso
   visual foi calibrado de 50 para 33,33 ms; a tentativa de 25 ms mostrou um
   underrun no local sem bots e não foi adotada como valor final. Não há
   extrapolação de posição nem alteração da física para esconder atraso.
5. **Repouso confundido com ré:** a sonda observou velocidades residuais por volta
   de ±0,02–0,03 m/s alternando o sinal do teclado. O adaptador agora ignora
   deslocamento longitudinal inferior a 0,1 m/s ao decidir inverter o esterço.
   Ré efetiva continua compensada, e nenhuma constante física foi alterada.
6. **Falha inicial do worker:** o fallback recebe novamente o estado das teclas
   pressionadas; não o suprime incorretamente como uma mensagem duplicada.

## Verificação

`npm run check`: **425 testes / 51 arquivos**, lint e build aprovados. O build
mantém o aviso preexistente de bundle principal acima de 500 kB.

Paridade read-only com a referência física 2.0.3: **11 cenários / 413 estados**,
zero falhas e diferença máxima zero em todos os campos comparados; nenhuma
referência foi regenerada e nenhum arquivo do backend foi modificado.

### Cadência em Spa — comparação real

Edge 152.0.4191.66 headless, Canvas 1920×1080, DPR 1, 30 segundos por caso após
o semáforo, execuções sequenciais sem rodar builds/testes simultâneos. Base
`e39b51e`. A pilotagem automática é apenas do harness, não entra no jogo.

| Configuração | FPS médio após | Desvio médio antes → depois | p95 do desvio antes → depois | Underruns em movimento após |
|---|---:|---:|---:|---:|
| Solo, sem bots | 59,93 | 0,784% → 0,105% | 1,945% → 0,297% | 0 |
| Local, sem bots | 59,87 | 1,411% → 0,039% | 4,310% → 0,149% | 0 |
| Solo, 1+21 | 59,70 | 5,224% → 2,531% | 15,292% → 13,224% | 0 |
| Local, 2+20 | 59,63 | 5,103% → 2,485% | 15,765% → 13,341% | 0 |

Nenhum desses casos teve pose retida enquanto o carro se movia nas amostras
elegíveis. O tempo simulado/real ficou próximo de 100%; não houve câmera lenta
para produzir FPS melhor. Ainda ocorreram frames isolados mais longos (até
49,9 ms no local sem bots), portanto não se declara ausência absoluta de pausas
do navegador nem FPS mínimo universal.

Os maiores desvios do grid cheio não desapareceram com a correção de clocks.
Para distingui-los de jitter, o harness `--motion-oracle` executou o motor
inalterado sem Canvas, worker ou relógio de parede: Spa local 2+20 apresentou
**2,463% de desvio médio e 13,081% de p95**, praticamente o mesmo patamar físico
observado após a correção visual. Existem deslocamentos do próprio solver em
contato entre carros, inclusive abaixo do limiar de dano. Não se alterou o solver
nem se introduziu suavização para esconder esses deslocamentos. Uma eventual
revisão deles exige auditoria física e paridade dos dois repositórios.

Registros brutos locais: `output/performance/input-cadence-verified.jsonl`.
Rodadas anteriores com 25 ms ou segunda amostragem depois do renderer foram
exploratórias e não são a comparação final acima.

### Teclado e verificações complementares

Sonda de teclado com comandos reais enviados pelo Playwright ao Edge, através
do `RaceCanvas` e worker, observados no passo fixo: **120 toques curtos, nenhuma
perda e nenhuma soltura presa**. A medição final inclui a espera de despacho do
evento no navegador, mas não mede o hardware do teclado ou o monitor.

| Configuração | Toques verificados | Latência média até a física | p95 | Máximo |
|---|---:|---:|---:|---:|
| Solo, sem bots | 20 | 4,59 ms | 8,50 ms | 8,50 ms |
| Local, sem bots | 40 | 4,48 ms | 8,70 ms | 8,90 ms |
| Solo, 1+21 | 20 | 3,97 ms | 9,70 ms | 9,70 ms |
| Local, 2+20 | 40 | 5,51 ms | 10,90 ms | 12,20 ms |

Registros: `output/performance/input-browser-probe.json` e
`output/performance/input-probe-<modo>-<carros>.json`.

Na retomada, o teste complementar de aceleração+direção, freio+direção e soltura
completa **também passou nas quatro configurações e para todos os pilotos humanos**.
O bloqueio anterior do sistema de aprovações foi resolvido. A rodada repetiu os
120 toques curtos, novamente sem perdas ou erros de página: latência média entre
4,13 e 5,42 ms por configuração, máximo de 12,50 ms. Os tempos da tabela acima
continuam sendo da primeira rodada, não foram misturados com a repetição.
Registro da nova execução: `output/performance/input-browser-combined-probe.json`.

Verificações adicionais de 30 segundos, também sequenciais:

| Circuito/configuração | FPS médio | Intervalo p95 | Maior intervalo isolado | Underruns em movimento |
|---|---:|---:|---:|---:|
| Mônaco solo sem bots | 59,90 | 16,8 ms | 50,0 ms | 0 |
| Mônaco local sem bots | 59,87 | 16,8 ms | 50,2 ms | 0 |
| Mônaco local 2+20 | 59,87 | 16,8 ms | 33,3 ms | 0 |
| Spa local 2+20 noturna | 59,16 | 16,8 ms | 66,8 ms | 0 |

Não houve pose retida nas amostras elegíveis; tempo simulado/real próximo de
100%. Esses números não constituem garantia de cada frame acima de 40 FPS.
Arquivo: `output/performance/input-cadence-crosschecks.jsonl`.

Smoke React/Worker aprovado: cinco criações e cinco encerramentos, aceleração
dos dois pilotos, R, Esc, finalização e execução do worker do bundle. Nenhum
`pageerror`. O servidor Vite de teste emitiu avisos de conexão do HMR local;
isso não é o WebSocket online do jogo e não impediu a execução do worker de
produção. Nenhum teste acessou Render/Neon ou exigiu mudança no backend.

Os testes automatizados cobrem bordas de tecla durante snapshot pendente e antes
da primeira resposta, toque curto, setas/WASD/IJKL, repetição, consumo simultâneo,
frações de tick, pausa/blur, fallback, relógio visual com jitter, catch-up e
paridade com a sessão original em 30/60/120 Hz.

Ferramentas reproduzíveis, fora do bundle de produção:

- `node tools/local-input-browser-probe.mjs`: página real `RaceCanvas`, teclado
  do Edge e módulo Worker. Observa o comando na entrada do passo físico, não apenas
  o recebimento da mensagem. Compara os comandos já adaptados para ré, verifica
  soltura e erros de página. Não acessa API de produção.
- `node tools/local-worker-browser-smoke.mjs`: ciclo de vida React/Worker,
  aceleração dos dois pilotos, reinício, Esc, finalização e worker de produção.
- `node tools/race-performance.mjs --browser --fixed-driving --worker`: pilotagem
  automatizada com motor real e pistas locais. `--baseline` carrega os fontes
  commitados pelo Git sem mudar o checkout. Fixar `PERF_BASE_REF=e39b51e` para
  reproduzir o antes. Usar `PERF_TRACK`, `PERF_MODES`, `PERF_CARS`,
  `PERF_MAX_SECONDS=30`, `PERF_FRAMES=10000` e `PERF_REPORT` para separar rodadas.

O probe de movimento mede a posição realmente enviada ao renderer. A métrica
de desvio relativo compara deslocamento com velocidade×tempo em amostras acima
de 10 m/s; não é um detector perfeito de travada, pois colisões/correções físicas
também podem alterar o deslocamento. Não interpretar seu máximo isoladamente.

## Validação do autor e limites

A confirmação manual desta correção ainda é necessária. Repetir Spa e Mônaco:
solo sem bots, local sem bots, solo 1+21 e local 2+20; fazer curvas rápidas e lentas,
toques curtos/repetidos nas setas e nos outros presets, aceleração+esterço, freio,
ré, R, Esc e troca de aba. Não é preciso revalidar o design completo das pistas.

Não declarar ausência universal de bugs, garantia de FPS mínimo em qualquer PC,
nem 100% de entrega de sinais que o próprio teclado/SO não tenha emitido.
As medições não incluem atraso físico do teclado, scanout do monitor ou rede.
Perda total e penalidade de largada continuam limitando controles pelas regras
do jogo; não são perda de eventos.
