# M3c — solavancos durante a classificação online

## Relato e diagnóstico

O autor e um colega testaram Suzuka em máquinas diferentes, com dois humanos
e um bot. Lobby/configurações funcionaram; a classificação apresentou
travamentos que impediram a validação completa. Preview relatada:
`https://never-lift-frontend-6jdp1aao7-matheuseichendorf15s-projects.vercel.app/`.
O PR frontend #140 já estava mesclado em develop ao iniciar esta correção.

Foram reproduzidas duas falhas em `OnlinePrediction`:

1. O cliente removia todos os passos associados a um comando assim que sua
   sequência aparecia no ACK. Porém o servidor confirma **qual comando usou**;
   isso não confirma todos os passos futuros em que o cliente continuou segurando
   a mesma tecla. A restauração descartava parte do movimento previsto.
2. Cada snapshot zerava o acumulador fracionário da física. Além de perder esse
   tempo, o desenho usava apenas posições de passos inteiros a 120 Hz, produzindo
   deslocamentos alternados quando RAF e snapshots chegavam fora de fase.

## Correção

- Cada passo previsto registra seu subpasso físico. `physicsSubstep` delimita
  o tempo já simulado pela autoridade; só os passos posteriores são reaplicados.
  `lastProcessedClientSeq` continua identificando confirmações e protegendo contra
  ACKs antigos. Segurar a mesma tecla não elimina o horizonte físico futuro.
- O tempo fracionário é preservado na reconciliação normal. Reconexão/reinício
  físico limpam histórico e residual; servidor adiantado prevalece.
- A apresentação do próprio carro inclui o residual inferior a 1/120 s, por
  velocidade linear e angular. Essa projeção é somente visual, não entra na
  física, no protocolo, nos checkpoints nem no HUD autoritativo.
- A correção visual continua com limiar de 0,10 m e duração de 100 ms.
- `RaceEngine`, fórmulas 2.0.3, câmera, minimapa, pistas e solo/local não foram
  editados nesta rodada. Nenhuma mudança backend/contrato foi necessária para
  corrigir essas falhas do cliente.

## Medição reproduzível

`tools/online-race-browser-smoke.mjs --profile` mede custo de recepção/predição,
desenho e deslocamento. `--baseline` carrega somente `OnlinePrediction.ts` do
commit anterior `d343cbb` através do Vite de teste, sem alterar o checkout.

Comparação: dois contextos Chrome headless 1440×900, backend Java local com H2
em memória, Suzuka real, dois humanos + um bot, atraso artificial de 80 ms em
cada sentido (160 ms de ida e volta adicionais). Aceleração por seis segundos.
Amostras são capturadas antes do teste separado de desconexão/reconexão.

| Métrica | Antes, clientes 1 / 2 | Depois, clientes 1 / 2 |
|---|---|---|
| Deslocamento / (velocidade × delta), percentil 5 | 0,502 / 0,480 | 0,998 / 0,998 |
| Mesmo índice, percentil 95 | 1,547 / 1,520 | 1,000 / 1,000 |
| Recepção/reconciliação, p95 | 1,2 / 1,2 ms | 0,6 / 0,6 ms |
| Desenho, p95 | 4,8 / 5,1 ms | 5,6 / 5,6 ms |
| Intervalo de quadro informado ao runtime, mediana | 16,7 / 16,7 ms | 16,7 / 16,7 ms |
| Tempo simulado / tempo de entrega observado | 100,15% / 99,99% | 100,35% / 100,40% |

O índice de deslocamento usa apenas amostras sem dano, velocidade > 5 m/s e
delta entre 5 e 40 ms; 323/325 amostras antes, 312/315 depois. Próximo de 1
significa deslocamento coerente com a velocidade. Esse filtro isola solavancos
entre quadros regulares; não prova ausência de quadros lentos ou colisões.
O tempo do runtime é limitado a 100 ms, portanto sua distribuição não representa
o máximo de duração real de uma pausa. Houve picos de desenho, inclusive 151 ms
em um quadro da execução corrigida. Não declarar FPS mínimo ou eliminar todos
os travamentos com base neste teste curto.

O servidor **local** acompanhou o tempo real. Essas medições não estabelecem
capacidade/latência do Render nem diagnosticam a conexão das duas máquinas do
autor. O código não acessa o Neon e não altera as contas reais.

Artefatos locais ignorados pelo Git:
`output/online-3c/browser-profile-suzuka-before.json` e
`output/online-3c/browser-profile-suzuka-after.json`.

```powershell
$env:ONLINE_SMOKE_TRACK = 'suzuka'
$env:ONLINE_SMOKE_DELAY_MS = '80'
# Requer backend H2 isolado em 127.0.0.1:8081.
node tools/online-race-browser-smoke.mjs --profile --baseline
node tools/online-race-browser-smoke.mjs --profile
npm run check
```

## Validação e pendências

- Regressões reproduzem perda de horizonte e perda de tempo fracionário no
  código antigo. Incluem projeção visual sem alterar física, confirmação de
  tecla seguida por soltura/freio, dano autoritativo e reset após reconexão.
- Comparação com motor canônico sob snapshots atrasados e jitter em 30/60/120/144
  FPS, abrangendo acelerador, esterço, soltura e freio.
- Smoke Chrome em Suzuka passou em autenticação, ticket, WebSocket, classificação
  isolada, movimento autoritativo, reconexão e confirmação de Esc; zero pageerrors.
- Gate completo `npm run check`: **465 testes/55 arquivos, lint, TypeScript e
  build aprovados**. O aviso de bundle > 500 kB permanece; não é medida de FPS.
- Publicação em branch `codex/module-3c-prediction-cadence`, baseada em develop
  `40cf10f`; PR separado para develop, sem promoção à main.
- Repetir o teste de Suzuka na nova preview com as mesmas duas máquinas antes de
  retomar duas voltas de quali, corrida até o pódio e demais gates do M3c.
- A validação manual integrada permanece pendente. O Módulo 3 não está concluído.
