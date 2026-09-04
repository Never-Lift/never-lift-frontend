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
