# M2 — colisões em grids densos (14/09/2026)

## Validação recebida e escopo

O autor confirmou a correção anterior em **Spa solo sem bots e local com dois
pilotos sem bots**. Solo 1+21 e local 2+20 ainda apresentam pausas nas curvas e
congestionamentos. Essa aprovação não cobre outras pistas nem o grid completo.
A gravação foi examinada localmente: há um pelotão em contato na primeira curva.
O vídeo não foi publicado nem convertido em uma suposta medição de FPS.

Base: `972bd9f` em `develop`, que contém a PR #138. Esta rodada preserva o caminho
direto até dois carros e o worker de três a 22. Não altera câmera, desenho,
resolução, input, bots, frequência de 120 Hz, parâmetros físicos 2.0.3, dano,
iterações do solver ou número máximo de impactos processados por passo.
Nenhum contrato compartilhado ou arquivo do backend foi modificado.

## Diagnóstico

Foi criado `tools/race-collision-profile.mjs`, um harness offline do motor real,
com contagem/custo de consultas carro–carro, carro–barreira, CCD e solver. O
piloto humano usa o controlador de bot somente no harness, para repetir a carga.
Não consulta Render/Neon, não usa o shell React e não mede FPS de apresentação.

Em 30 segundos simulados de Spa solo 1+21, com instrumentação e profiler:

- Carro–carro: 228.721 consultas, 44.390 resoluções positivas e 16,58 s de custo
  inclusivo — aproximadamente **88% do custo total medido**.
- CCD: 240.823 consultas; solver: 174.119 chamadas. São custos internos ao
  anterior, não parcelas que possam ser somadas a ele.
- Barreiras: 79.200 consultas de movimento e 58.565 de sobreposição, sem impacto
  nesse percurso. Desativar apenas barreiras no diagnóstico não retirou a carga.
- Sem contatos carro–carro, o passo caiu de 5,22 para 0,22 ms médios na sonda
  instrumentada. A ablação também muda trajetórias: serve para localizar custo,
  **não é correção aceitável nem estimativa de FPS do jogo**.

O custo concentra-se em contatos persistentes de carros muito próximos. Não há
evidência nesta reprodução de que a causa principal seja rede ou banco.

## Alterações equivalentes

1. **Contato angular já existente:** consultar a pose atual antes de construir e
   ordenar candidatos futuros. Havendo contato agora, o primeiro instante já é
   zero. A consolidação mantém a ordem canônica; o caminho de movimento linear
   continua com suas regras anteriores, inclusive separação de contatos.
2. **Filtragem conservadora das peças:** não testar peças fora dos limites
   completos do outro carro; reutilizar os limites das demais peças na consulta.
   As peças que podem tocar continuam no mesmo teste exato e na mesma ordem.
3. **Memória privada reutilizável:** dois corpos do solver e seus buffers de
   geometria são reaproveitados entre consultas síncronas. Consultas aninhadas
   ficam isoladas; `finally` restaura o escopo mesmo se um provedor lançar erro.
   Os caches dependentes da pose são invalidados, sem expor esses buffers.
4. **Limites de corpos parados:** retirar um cache redundante por identidade do
   collider. Velocidade zero não garante que o buffer mantenha a mesma posição
   na próxima consulta. O cache de polígonos já é invalidado com os vértices e
   continua reutilizado para muros realmente imutáveis.

Não foram removidas colisões, simplificadas hitboxes ou alteradas regras de
ultrapassagem/dano para produzir números melhores.

## Regressões automatizadas adicionadas

- Comparação dos contatos filtrados com busca exaustiva peça–peça em 64 poses,
  incluindo rotações, separações e ordem invertida das peças.
- Contatos angulares em tempo zero mesmo com movimento futuro de separação.
- Consulta aninhada no provedor, exceção e nova corrida sem contaminar os buffers.
- Collider parado cujo buffer muda de posição: resultado igual ao de uma cópia
  nova, sem reutilizar os limites da posição anterior.

## Evidências obtidas e ponto de retomada

Os quatro novos testes passaram junto da auditoria de colisão e rigid body:
**41 testes em dois arquivos**. Os hashes físicos de todos os 22 carros ficaram
idênticos ao commit-base em **60 amostras de um segundo por circuito**, Spa e
Mônaco (7.200 passos por execução). Não se regeneraram referências.

Sonda CPU sem instrumentação, solo 1+21, 60 segundos simulados:

| Circuito | Passo médio antes → depois | p95 antes → depois |
|---|---:|---:|
| Spa | 4,83 → 3,03 ms | 11,02 → 6,14 ms |
| Mônaco | 14,87 → 11,30 ms | 27,75 → 22,10 ms |

Esses números não são FPS. Em Mônaco houve uma pausa isolada de 905 ms na
execução anterior, não atribuída especificamente ao código; não usar essa
diferença de máximos como promessa de ganho. Artefatos:
`dense-{spa-francorchamps,monaco}-{before,after}-final.json`.

Chrome 152.0.7977.83 headless, canvas 1920×1080, dia, **local 2+20**, motor,
worker e renderer reais, pilotagem automatizada somente no harness. Execuções
sequenciais, sem outro benchmark/build simultâneo:

| Medida | Spa antes → depois (75 s) | Mônaco antes → depois (60 s) |
|---|---:|---:|
| Intervalo médio do quadro | 18,17 → 18,24 ms | 20,99 → 21,26 ms |
| Simulado/real | 99,98 → 100,09% | 94,59 → 100,03% |
| Idade média do snapshot | 37,33 → 27,73 ms | 119,44 → 39,83 ms |
| Idade p95 do snapshot | 60,97 → 41,23 ms | 275,67 → 98,60 ms |
| Falta de amostra para interpolar em movimento | 352 → 173 | 1.637 → 408 |
| Quadros com posição retida nas amostras elegíveis | 22 → 10 | 44 → 1 |

Há redução relevante do atraso da simulação, **não aumento comprovado de FPS**,
e ainda há falta de snapshots. Não afirmar que todas as travadas desapareceram.
A comparação de Spa ocorreu antes do último ajuste de invalidação de limites
de corpos parados; a repetição final está abaixo. Mônaco e os hashes de
60 segundos incluem esse ajuste. Artefatos:
`dense-spa-comparison-sep14.jsonl`, `dense-monaco-comparison-sep14.jsonl`.

Repetição no código final, mesmo Chrome/canvas, 60 segundos por caso:

| Caso | Intervalo médio / p95 | Simulado/real | Idade p95 snapshot | Quadros retidos |
|---|---:|---:|---:|---:|
| Spa local 2+20 | 18,71 / 33,30 ms | 100,06% | 38,77 ms | 3 |
| Spa solo 1+21 | 17,40 / 16,90 ms | 100,03% | 38,03 ms | 3 |
| Mônaco solo 1+21 | 17,21 / 16,80 ms | **88,89%** | **275,67 ms** | **193** |

**Mônaco solo 1+21 não passou no critério de fluidez.** O desenho próximo de
58 FPS não compensa a simulação atrasada e as posições retidas. Foram 2.125
faltas de amostra de interpolação em movimento. Não extrapolar o resultado de
Mônaco local para solo: o conjunto de humanos/bots e os congestionamentos da
pilotagem automatizada são diferentes. Esta é uma entrega parcial em rascunho,
não a resolução completa do relato. Próximo diagnóstico: custo por passo do
pelotão persistente de Mônaco solo, com comparação física idêntica, sem reduzir
iterações/contatos ou aumentar o atraso de input para esconder a sobrecarga.

A repetição de Mônaco solo no commit anterior também falhou: **84,64%**
simulado/real, 185,91 ms de idade média de snapshot e 415 quadros retidos,
contra 88,89%, 149,67 ms e 193 no código final. A comparação evidencia melhora
parcial, não resolução. As duas execuções cobrem 60 segundos reais, mas chegam
a tempos físicos diferentes devido à sobrecarga; a equivalência de trajetória
é comprovada separadamente pelos hashes a tempos físicos iguais. Artefato:
`dense-monaco-solo-baseline-sep14.jsonl`.

Não comparar contagens brutas de janelas de 60 e 75 segundos como se fossem
iguais. Artefato local: `dense-browser-final-sep14.jsonl`. Esses são cenários
automatizados de estresse, não a conclusão de uma volta manual nem a garantia
de que os demais circuitos ou equipamentos terão o mesmo resultado.

### Verificação final

- `npm run check`: **431 testes / 51 arquivos**, lint e build aprovados.
  Permanece o aviso preexistente de bundle principal acima de 500 kB.
- Referência 2.0.3, somente leitura: **11 cenários / 413 estados**, zero falhas
  e diferenças máximas zero em Node 22.14.0, Chrome 152.0.7977.83 e Edge
  153.0.4234.32. O verificador de navegador foi iniciado com Node 24.19.0.
- CCD final: **512 casos / 318 contatos**, mesmo hash do commit `972bd9f`:
  `8a47702e6a2051c8ed655cd32518fc0a2becc823282d4ea0b2117e2d0ea01e36`.
- Teclado real no Chrome: **120 toques curtos, zero perdas**, combinando
  aceleração/esterço e freio/esterço, com soltura completa para cada humano.
  Solo sem bots: média/p95 8,74/16,40 ms até o passo físico; local sem bots:
  11,93/20,20 ms; solo 1+21: 9,27/15,00 ms; local 2+20: 8,98/15,00 ms.
  Não são medições tecla–monitor nem garantia de latência máxima em toda curva.
  Relatório local: `dense-input-sep14.json`.
- Smoke React/Edge: três runtimes iniciados e encerrados, finalização,
  reinício por R, saída por Esc e worker compilado emitindo snapshot aprovados;
  zero erros de página. O servidor de desenvolvimento registrou avisos de
  conexão HMR local bloqueada pelo navegador; isso não é o WebSocket do jogo
  nem falha do worker de produção testado.

Uma tentativa anterior foi bloqueada pelo ambiente de autorização, antes dos
testes. A nova tentativa autorizada concluiu a suíte; esse bloqueio não é
pendência do produto. Nenhum teste de aceitação usa ablação ou referências
regeneradas para esconder diferenças.

Branch: `codex/race-dense-collision-performance`, destinada a PR em rascunho
para `develop`, acompanhando a issue #60. Não promover para `main`; aprovação
manual do grid completo e M3c continuam pendentes.

## Comandos de reprodução

```powershell
$env:COLLISION_BASE_REF = '972bd9f'
$env:COLLISION_TRACK = 'spa-francorchamps'
$env:COLLISION_MODE = 'solo'
$env:COLLISION_CARS = '22'
$env:COLLISION_STEPS = '3600'
$env:COLLISION_REPORT = 'output/performance/collision-before.json'
node tools/race-collision-profile.mjs --instrument --profile
Remove-Item Env:COLLISION_BASE_REF
$env:COLLISION_REPORT = 'output/performance/collision-after.json'
node tools/race-collision-profile.mjs --instrument --profile
```

Omitir `--instrument --profile` para medir o motor sem essas sondas. O relatório
contém hashes SHA-256 do estado físico de todos os carros a cada segundo.
`COLLISION_ABLATION=no-cars|no-walls|none` existe **apenas no bundle diagnóstico**;
os testes de aceitação usam `full` (padrão). Comparar hashes somente entre runs
com a mesma configuração completa, não com ablações. Resultados e perfis locais
ficam em `output/performance/`, ignorado no Git.

## Validação manual desta rodada

Repetir Spa solo 1+21 e local 2+20, principalmente a primeira curva com o pelotão
junto. Repetir em Mônaco e fazer uma regressão breve solo/local sem bots.
Observar continuidade do cenário, resposta a acelerar+virar, toques curtos,
colisões, R e Esc. A correção **não está aprovada manualmente para 22 carros**.
Não declarar fluidez universal nem mínimo garantido de 40 FPS. M3c permanece
pendente; nenhuma promoção para `main` faz parte desta rodada.
