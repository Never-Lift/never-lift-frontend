# M2 — travadas nas curvas sem bots (11/09/2026)

## Relato e ponto de partida

O autor enviou uma nova gravação de aproximadamente 49 segundos, com Spa no
modo solo sem bots, e autorizou desfazer otimizações e aceitar menos FPS se isso
fosse necessário para recuperar a fluidez. Informou Chrome e monitor de 60 Hz.
A preview informada corresponde ao commit `36e2c6e`, merge da PR #137; portanto,
o relato já inclui a correção anterior de input/cadência, não uma versão antiga.

A gravação foi examinada localmente, inclusive nas últimas curvas. Há imagens
repetidas, mas captura/compressão também podem repetir quadros: não converter
essa contagem em FPS do jogo nem tratá-la como prova isolada da causa. Vídeo e
imagens extraídas não foram publicados.

## Investigação e correção adotada

A revisão anterior colocou todas as corridas locais no worker, mesmo com apenas
um carro. Quando a entrega de snapshots atrasa, a posição visual pode ficar
limitada à última amostra enquanto a câmera continua sua suavização por RAF.
Isso é uma fragilidade real do caminho assíncrono, mas a reprodução headless
regular desta rodada não capturou o mesmo congelamento do vídeo. A causa exata
no perfil de navegador do autor ainda depende da comparação manual.

`RaceCanvas` agora escolhe a estratégia na criação da corrida:

| Total de carros, incluindo bots | Estratégia |
|---|---|
| 1 ou 2 | `LocalRaceRuntime` direto, sem worker nem buffer de snapshots |
| 3 a 22 | Worker existente, com input independente e snapshots interpolados |

Assim, solo sem bots, solo com um bot e local sem bots não dependem mais da
entrega de mensagens para avançar. Física e apresentação usam o mesmo ciclo de
RAF. O motor continua com passos fixos de **120 Hz**, interpolação entre passos,
`LocalRaceSession` para largada e `LocalInputBuffer` para preservar toques curtos.
A estratégia não muda no meio da prova, nem reconstrói carros após a largada.

Não se alteraram `RaceEngine`, fórmulas/constantes 2.0.3, colisões, bots, desenho
dos circuitos/carros, qualidade gráfica, zoom, inclinação ou regras da câmera.
O buffer de 33,33 ms continua no caminho worker. Não foi introduzido limite
artificial de FPS, extrapolação ou câmera lenta para melhorar a estatística.
Nenhum contrato compartilhado ou arquivo do backend foi modificado.

**Alternativa rejeitada:** executar também o grid completo no thread principal.
Em Mônaco local 2+20, uma medição de 60 segundos apresentou intervalo médio de
78,83 ms (aproximadamente 12,7 FPS), p95 de 300,5 ms e apenas 91,14% de tempo
simulado/real. O custo de colisões congestionadas bloquearia desenho e teclado.
Por isso o rollback é seletivo, preservando o worker para três ou mais carros.

## Verificações

- `npm run check`: **427 testes em 51 arquivos**, lint e build aprovados.
  Permanece o aviso preexistente de bundle principal acima de 500 kB.
- Dois novos testes de `RaceCanvas` simulam um navegador que aceita um worker,
  mas não entrega nenhuma mensagem: solo/local sem bots continuam avançando e
  respondendo aos dois pilotos, sem esperar o timeout de inicialização.
- Referência física 2.0.3, somente leitura: **11 cenários / 413 estados**, zero
  falhas e diferença máxima zero. Nenhuma referência foi regenerada.
- Smoke React local: aceleração dos dois pilotos, reinício por R, saída por Esc,
  finalização e descarte do runtime; três inicializações e três encerramentos,
  sem erros de página. O worker compilado de produção também foi executado.

### Medições prolongadas

Canvas 1920×1080, DPR 1, dia, execuções sequenciais de 85 segundos, sem builds
ou outras sondas simultâneas. São medições headless do motor/renderer reais,
com pilotagem automatizada apenas no harness; não são uma volta manual no perfil
Chrome do autor. No caso direto, o harness avança `RaceEngine`; a integração
`RaceCanvas`/`LocalRaceSession` é coberta separadamente pelos testes de componente,
teclado e smoke. As medições ampliam a janela anterior de 30 segundos.

| Caso em Spa | Intervalo médio | p95 | Maior intervalo | Simulado/real |
|---|---:|---:|---:|---:|
| Edge solo sem bots, worker anterior | 16,70 ms | 16,80 ms | 133,10 ms | 100,01% |
| Edge solo sem bots, direto | 16,67 ms | 16,80 ms | 26,30 ms | 99,99% |
| Chrome local sem bots, direto | 16,67 ms | 16,80 ms | 23,00 ms | 99,99% |

O maior intervalo do caso anterior ocorreu no início, não nas curvas finais;
não apresentá-lo como reprodução comprovada do sintoma. Nenhum dos três casos
reteve posição em movimento nas amostras elegíveis. O novo caminho ficou próximo
de 60 FPS médios; isso não prova ausência universal de pausas em todos os PCs.

Versões: Edge `152.0.4191.66`, Chrome `152.0.7977.83`. Máquina Windows com tela
1920×1080 a 60 Hz e NVIDIA T400; não extrapolar para outros equipamentos.

### Teclas — página real no Chrome

**120 toques curtos, zero perdas**, soltura sem tecla presa e combinações de
acelerar+virar e frear+virar aprovadas para todos os pilotos humanos.

| Configuração | Toques | Média até o passo físico | p95 | Máximo |
|---|---:|---:|---:|---:|
| Solo sem bots, direto | 20 | 8,05 ms | 16,10 ms | 16,10 ms |
| Local sem bots, direto | 40 | 8,36 ms | 16,40 ms | 16,50 ms |
| Solo 1+21, worker | 20 | 6,33 ms | 11,90 ms | 11,90 ms |
| Local 2+20, worker | 40 | 4,69 ms | 8,40 ms | 9,80 ms |

Zero erros de página. Os casos diretos não receberam snapshots; os casos com
22 carros receberam snapshots, confirmando a seleção de estratégia. Uma rodada
independente no Edge também passou nos 120 toques e combinações.

O modo direto pode esperar o próximo RAF antes do passo físico, mas elimina a
espera visual adicional de 33,33 ms por snapshots. Não confundir a latência
medida até a física com latência completa tecla→monitor: hardware do teclado,
composição e atualização do monitor não são medidos por esta sonda.

## Ferramentas e reprodução

- `tools/local-input-browser-probe.mjs` aceita `PROBE_BROWSER=chrome` ou `msedge`;
  `INPUT_PROBE_REPORT` escolhe o arquivo do relatório. A sonda observa tanto a
  execução direta quanto o worker na entrada do passo fixo.
- `tools/local-worker-browser-smoke.mjs` conta runtimes ativos, não apenas
  workers construídos; também verifica o asset worker real gerado pelo build.
- `tools/race-performance.mjs` aceita `PERF_TIMELINE` para registrar posição,
  velocidade, estado da câmera, tempos e diagnóstico por quadro. A coleta
  detalhada é opcional e nunca entra no bundle do jogo. Usar um único caso por
  arquivo de timeline, pois uma nova execução substitui esse arquivo.

Exemplo PowerShell para a medição direta prolongada:

```powershell
$env:PERF_BROWSER = 'chrome'
$env:PERF_TRACK = 'spa-francorchamps'
$env:PERF_MODES = 'local'
$env:PERF_CARS = '2'
$env:PERF_MAX_SECONDS = '85'
$env:PERF_FRAMES = '10000'
$env:PERF_REPORT = 'output/performance/corners-recheck.jsonl'
$env:PERF_TIMELINE = 'output/performance/corners-recheck-timeline.json'
node tools/race-performance.mjs --browser --fixed-driving
```

Adicionar `--worker` para comparar o caminho assíncrono. O harness não escolhe
automaticamente a estratégia de `RaceCanvas`. Artefatos locais desta rodada:
`corners-sep11.jsonl`, `corners-sep11-chrome.jsonl`,
`corners-sep11-direct-grid.jsonl`, `corners-input-chrome-sep11.json` e
`corners-input-sep11.json`, todos em `output/performance/` (ignorado no Git).
Nenhum desses testes consultou Render/Neon ou exigiu deploy do backend.

## Validação manual pendente e limites

Na nova preview, repetir primeiro **Spa solo sem bots**, incluindo as duas curvas
finais mostradas no vídeo. Depois repetir **local com dois pilotos sem bots**.
Conferir curvas rápidas/lentas, aceleração+esterço, freio, toques curtos nas setas,
R, Esc e retorno de outra aba. A meta prioritária é retirar as pequenas travadas
e preservar os comandos, não apenas exibir uma boa média de FPS.

Depois verificar solo 1+21 e local 2+20 como regressão: o caminho worker desses
grids não foi corrigido novamente nesta rodada. Não declarar o problema de
fluidez de todas as configurações resolvido, nem garantir 40 FPS mínimos.
Persistindo o sintoma sem bots, coletar o perfil Performance do Chrome durante
a reprodução para separar custo de composição/render de transporte/simulação.

Módulos já concluídos mantêm seu status. Esta correção permanece com validação
manual pendente, não inicia M3c e não promove `develop` para `main`.
