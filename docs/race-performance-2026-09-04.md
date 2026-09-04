# Desempenho de solo e split-screen — 04/09/2026

## Escopo e estado

O autor solicitou otimizar o grid completo e o modo local, que apresentavam
travamentos inclusive sem bots. A capacidade aprovada continua sendo **22 carros
totais**: um humano e até 21 bots no solo, ou dois humanos e até 20 bots no local.
Esta rodada não implementa o M3c e não altera o status dos módulos já aprovados.
A confirmação manual desta otimização permanece pendente.

## O que mudou

- O renderer prepara os pontos dos chunks, divisões de elevação, listas de cenário
  e geometria dos boxes uma vez por pista. Antes, cada câmera repetia buscas e
  projeções de infraestrutura em cada frame, mesmo longe dos boxes.
- Carros fora da tela não executam o desenho detalhado; continuam na simulação e
  no minimapa. Pits usam culling com margem para paredes, coberturas e altura.
- O local usa qualidade baixa e limite de densidade interna de 1 pixel por pixel
  CSS. Solo com dez ou mais carros usa o mesmo perfil; grids menores usam qualidade
  média e limite de 1,5. Em telas de alta densidade isso evita multiplicar o custo
  do Canvas. Zoom, inclinação, tamanho aparente do carro, HUD React e hitboxes não
  mudam. O perfil reduz partículas decorativas, não pilotos nem geometria física.
- A projeção na pista descarta blocos espacialmente impossíveis, mantendo a ordem
  original dos segmentos e os mesmos desempates. Limites ordenados usam busca
  binária.
- Colisões reutilizam limites, eixos, centros, raios e poses já calculados. Os
  caches acompanham os vértices imutáveis, não mantêm um histórico global crescente
  e não entram em JSON/snapshots. Arrays congelados também são suportados.
- A detecção contínua reaproveita poses apenas dentro da consulta vigente; os
  caches de carro verificam posição e ângulo, inclusive após movimentação in-place.
  Rejeição preliminar usa limites conservadores cobrindo translação e rotação.
- Operações geométricas evitam vetores temporários, preservando a ordem aritmética.

**Preservado:** física `2.0.3`, passo de `1/120 s`, CCD linear/angular, iterações do
solver, impulso/dano, potência, freio, aderência, decisões/dificuldade dos bots,
teclado, catálogo e contratos compartilhados. `RaceEngine.ts` não tem alteração de
conteúdo. Experimentos que modificavam planejamento dos bots ou pulavam CCD foram
descartados; os quatro arquivos experimentais do backend foram restaurados. Esta
entrega é exclusivamente do frontend e não requer novo deploy do backend.

## Medições no navegador

Ferramenta: `tools/race-performance.mjs`, com Edge `152.0.4191.62` headless, Canvas
isolado de 1920×1080 CSS e densidade do dispositivo 2. O modo `--driving` fornece
inputs aos humanos pelo planejador existente para movimentar as câmeras. A física
recebe o delta real de cada frame; não é artificialmente desacelerada para inflar FPS.
As primeiras cinco amostras não entram nos tempos médios. A base é `5427f88`.

| Cenário | Antes | Depois | Tempo simulado / tempo real depois |
|---|---:|---:|---:|
| Mônaco, solo, 22 carros | ~12 FPS | ~39 FPS | ~100% |
| Mônaco, local, 2 humanos, sem bots | ~28 FPS | ~60 FPS | ~100% |
| Spa, solo, 22 carros | não medido nesta comparação | ~42 FPS | ~100% |
| Spa, local, 2 humanos, sem bots | não medido nesta comparação | ~60 FPS | ~100% |

Mônaco foi medido por até 15 s por cenário; Spa, por até 20 s. No trecho pesado de
Mônaco, o percentil 95 do intervalo entre frames ainda foi ~66,7 ms; em Spa, ~33,4
ms. Portanto há melhora substancial, **não garantia de 60 FPS com 22 carros** nem
ausência de picos em acidentes coletivos. A comparação de navegador mede cargas
reais, mas diferentes taxas de frames podem produzir inputs/instantes de colisão
diferentes no piloto de teste. A equivalência física é verificada separadamente,
com sequências fixas e referências congeladas.

Os testes de navegador não incluem toda a interface React nem substituem uma
corrida manual completa. Desempenho depende da máquina, resolução, navegador,
aceleração gráfica e cenário. Render/Vercel não simulam o solo/local depois de a
pista estar carregada: o gargalo investigado ocorre no navegador.

## Regressão e paridade

- `npm run check` aprovado: 365 testes em 41 arquivos, lint e build. O build mantém
  o aviso já existente de bundle JavaScript acima de 500 kB; não é falha de compilação.
- Comparação exata de geometria, superfície, barreiras e comandos de bots nas 24
  pistas: 648 amostras contra o oracle `typescript-geometry-2.0.3.json` já publicado.
- Comparação com o oracle físico `2.0.3` compartilhado com Java: 11 cenários e 413
  estados em Node 24.19.0 e Edge, sem regenerar resultados esperados; zero diferenças
  em todas as grandezas comparadas nas duas execuções.
- Benchmark de passos fixos compara hashes dos estados finais antes/depois,
  incluindo posição, velocidade, ângulo, dano e estado veicular interno.
  Em Albert Park, 22 carros após 1.920 passos (120 de aquecimento + 1.800 medidos)
  produziram o mesmo SHA-256 nas duas versões:
  `677552b765dbb84c4187a80b8bcd5a257c7694fcbb20176577a27cff4281600a`.
- Novos testes: cache sem poluir snapshots, arrays congelados, mudanças de pose e
  pivô, união de limites sem mutação, projeção indexada contra busca completa,
  ausência de reprojeção de boxes por frame, culling de oponentes, perfis gráficos
  e preservação de escala/split-screen em alta densidade.

## Complemento: dois humanos + vinte bots no local

Após a primeira entrega, o autor pediu avaliar explicitamente o local com bots
e autorizou otimizações. **Os números de local da tabela anterior eram sem bots**;
não comprovavam desempenho com grid completo. Os novos testes usam dois humanos
e vinte bots reais, e não vinte e dois participantes classificados como humanos.

### Ajustes adicionais preservados

- Cache geométrico com estrutura estável, independentemente da primeira consulta.
- Reaproveitamento da geometria de corpos rígidos enquanto posição e ângulo forem
  exatamente os mesmos, invalidando-a após qualquer correção de contato.
- Rejeição de poses espacialmente separadas antes da etapa detalhada do CCD,
  mantendo todos os tempos de amostragem, tolerâncias e ordem dos contatos.
- Desenho das faces do carro sem criar um novo vetor de pontos para cada face.
  Projeção contínua, escala, cores e ordem de desenho são preservadas.
- Testes específicos de 2+20, duas câmeras/minimapas nas duas orientações de
  split-screen e equivalência exata da projeção em 722 combinações de ângulo/escala.

Um cache baseado somente em WeakMap piorou o custo e foi descartado. A filtragem
adicional por subintervalo angular também foi descartada: o ganho medido não
justificou aumentar a complexidade do CCD. Não houve redução de frequência da
física, de bots, de hitboxes ou de qualidade das colisões.

### Medição prolongada

Edge `152.0.4191.62` headless, DPR 2, sem profiler e sem outros benchmarks paralelos.
Para esta comparação, `--fixed-driving` fornece comandos aos dois humanos em
cada passo de 1/120 s usando o planejador existente. Assim, os comandos não mudam
com o FPS do render. Isso é apenas um piloto de teste e não altera o jogo.
O Canvas é isolado, sem HUD React; estes resultados **não substituem validação
manual nem garantem o mesmo FPS na preview**.

| Cenário local 2+20 | Duração real | FPS médio aproximado | Intervalo p95 | Tempo simulado / real |
|---|---:|---:|---:|---:|
| Mônaco, dia, 1920×1080, base `a0ad98d` | 60 s | 6,2 | 383 ms | 83,1% |
| Mônaco, dia, 1920×1080, com ajustes adicionais | 60 s | 7,7 | 333 ms | 88,4% |
| Spa, dia, 1920×1080, com ajustes adicionais | 60 s | 34,6 | 66,8 ms | 98,8% |
| Spa, noite, 1024×900, divisão horizontal | 45 s | 20,7 | 116,9 ms | 98,4% |

No final dos testes de Spa ainda havia 22 carros em movimento de dia e 20 à noite;
a medição não foi feita somente após todos os bots ficarem imobilizados. Ainda
existem picos expressivos. Em Mônaco, o custo médio da física por frame permaneceu
muito maior que o do desenho: aproximadamente 112 ms contra 13 ms. O número de
passos por frame cresce quando o navegador tenta recuperar o atraso.

**Conclusão:** a combinação é suportada funcionalmente, mas seu bom desempenho
generalizado **não está aprovado**. Os ajustes ajudam, porém não resolvem os
congestionamentos de 22 carros em Mônaco. Não afirmar que basta reduzir efeitos ou
trocar Render/Vercel: solo/local é simulado no navegador. O próximo trabalho é uma
revisão mais profunda do custo das colisões compostas, sempre preservando ou
revalidando explicitamente a paridade com Java. M3c e aprovação manual continuam
fora desta entrega.

### Regressão deste complemento

- `npm run check`: **371 testes em 42 arquivos**, lint e build aprovados.
- Referência de geometria: novamente 24 circuitos e 648 amostras exatas.
- Referência física publicada: novamente 11 cenários/413 estados, com diferença
  zero em Node 24.19.0 e Edge 152.0.4191.62; nenhum oracle foi regenerado.
- 512 colisões sintéticas (318 com contato) produziram o mesmo hash na base
  `a0ad98d` e na versão final:
  `8a47702e6a2051c8ed655cd32518fc0a2becc823282d4ea0b2117e2d0ea01e36`.
- Mônaco local 2+20, após 3.720 passos fixos com comandos por passo, manteve
  exatamente o estado final da base:
  `2bb080541a9d8d80d9ed0869601f0037b1f08fb0a35ccb040676fb2d31a51aa3`.
- Captura de Spa noturno em split-screen horizontal inspecionada: duas câmeras,
  carros, faróis e minimapas presentes. Isso não aprova fluidez nem substitui o
  teste manual completo.

## Como reproduzir

Com os repositórios frontend/backend lado a lado e dependências instaladas:

```powershell
npm run check
node tools/race-performance.mjs --geometry-parity
$env:PERF_BASE_REF = '5427f88'
npm run benchmark:race -- --baseline
npm run benchmark:race
$env:PERF_TRACK = 'monaco'
$env:PERF_DPR = '2'
$env:PERF_FRAMES = '1800'
node tools/race-performance.mjs --baseline --browser --driving
node tools/race-performance.mjs --browser --driving
```

O benchmark CPU usa 120 passos de aquecimento e 600 medidos, três execuções por
caso (1/2/5/10/22 carros). `PERF_STEPS`, `PERF_RUNS` e `PERF_COUNTS` permitem variar
a carga. O navegador limita cada caso a `PERF_MAX_SECONDS` (15 por padrão), usa
`PERF_MODES=solo,local` e depende do Playwright já instalado em
`../never-lift-backend/tools/physics-parity/node_modules`. Caminhos alternativos:
`PERF_CATALOG_ROOT`, `PERF_PLAYWRIGHT_MODULE` e `PERF_GEOMETRY_REFERENCE`.
`--profile` mostra as funções mais amostradas; `PERF_SCREENSHOT_DIR` guarda capturas.
Esses benchmarks são diagnósticos opcionais, não gates de tempo sensíveis ao
hardware no CI. Nenhum deles publica dados ou altera catálogo/oracles.

Para reproduzir especificamente o local completo:

```powershell
$env:PERF_MODES = 'local'
$env:PERF_CARS = '22'
$env:PERF_TRACK = 'monaco'
$env:PERF_DPR = '2'
$env:PERF_FRAMES = '10000'
$env:PERF_MAX_SECONDS = '60'
$env:PERF_BASE_REF = 'a0ad98d'
node tools/race-performance.mjs --baseline --browser --fixed-driving
node tools/race-performance.mjs --browser --fixed-driving
```

`PERF_WIDTH`, `PERF_HEIGHT` e `PERF_TIME_OF_DAY` selecionam resolução CSS e horário.
O benchmark aplica o perfil gráfico da versão medida também na comparação de
base; não compara artificialmente uma base em alta densidade com a versão atual
em baixa quando as duas já usam o mesmo perfil. `--ccd-samples` gera 512 cenários
reproduzíveis de colisão para comparar hashes entre revisões; `--fixed-driving`
também pode ser usado no benchmark CPU com `PERF_MODES=local` e `PERF_COUNTS=22`.

## Validação manual solicitada

1. Na preview, correr em Mônaco e Spa com 22 carros totais no solo, passando pela
   largada e pelas primeiras curvas; observar resposta aos comandos e acidentes.
2. Repetir no local com dois jogadores sem bots e, depois, com grid maior.
3. Conferir boxes, muros, zebras, carros e minimapas ao girar as câmeras, incluindo
   as bordas da tela. Em Suzuka, verificar também a passagem inferior/superior.
4. Conferir noite/faróis, tela cheia, reinício por `R`, saída por `Esc` e colisões.
5. Informar resolução/escala da tela, navegador, pista e quantidade de carros caso
   ainda haja travamentos. Picos restantes não devem ser confundidos com módulo
   inteiro revalidado nem ocultados pelo relatório.
