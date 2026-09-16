# M3c — comandos em trânsito e isolamento do banco

## Contexto e limites

Continuação do PR frontend #141, já mesclado em develop. O autor enviou uma
gravação de 39,6 s de Suzuka, dois humanos e um bot, relatando solavancos ainda
graves. Esta revisão parte de frontend `53c2b2c` e backend `ed4134e`.

O vídeo foi inspecionado localmente em Chrome, sem upload. Uma primeira extração
por `seeked` podia capturar o quadro anterior; o utilitário agora espera
`requestVideoFrameCallback`. Quadros isolados não provam congelamentos de segundos.
A amostragem do mundo a 15 Hz entre 4–36 s não encontrou intervalo quase imóvel
superior a 400 ms; isso não mede FPS do jogo nem descarta solavancos menores.

Não foi medido o Render/Neon de produção durante a gravação. As causas abaixo
foram reproduzidas por testes, mas não demonstram que todo sintoma remoto foi
eliminado. M3c e a validação integrada final continuam pendentes.

## Frontend: confirmação precisa de comandos

O PR #141 preservou duração futura de teclas mantidas e tempo fracionário da
física. Porém usar somente `physicsSubstep` para descartar passos ainda apagava
um comando novo cujo pacote não havia chegado ao servidor. Regressão reproduzida:
esterço previsto de 0,1 voltava a zero ao receber snapshot mais novo com ACK -1.

A reconciliação agora combina sequência e relógio:

- Passos com sequência ainda não confirmada são preservados e reaplicados sobre
  o snapshot, mesmo que seu instante local anterior já tenha sido ultrapassado.
- Duração futura prevista não é encurtada a cada ACK. Quando a autoridade já
  confirmou um comando posterior, controles antigos nesse horizonte são
  substituídos pelo comando confirmado conhecido, sem repetir o acelerador
  antigo depois de confirmar o freio, por exemplo.
- Passos reaplicados são datados consecutivamente após o snapshot. Histórico de
  passos e comandos permanece limitado; reset/reconexão limpam estado antigo.
- Mantidos passo de 120 Hz, residual fracionário, correção visual acima de
  0,10 m em 100 ms e limite de especulação na ausência de snapshots de 250 ms.

Uma variante intermediária que removia a duração dos controles antigos piorou
a uniformidade no navegador e foi descartada. Não basta passar no teste de tecla:
o teste de movimento também precisa continuar aceitável.

`OnlineRaceRuntime` agora expõe diagnósticos limitados de chegada (idade do último
snapshot, maior intervalo e contagem), sem guardar tráfego, credenciais ou nomes.
São intervalos de entrega, **não ping/RTT nem FPS**. O painel avisa atraso pelo
toast existente de 5 s, com X e limitação de repetição; comandos continuam sendo
enviados. Contagem parada, quali terminada e socket desconectado não geram esse
aviso como se fossem atraso de entrega. Não há extrapolação ilimitada.

## Backend: dados em memória sem transação JDBC

`RoomManager.get()` e `listPublic()` estavam anotados com `@Transactional`, embora
consultem somente salas em memória. `get()` participa do tratamento de cada
input e de cada publicação. O teste usa o proxy Spring real, não uma instância
isolada da classe: 100 consultas e uma listagem abriram **101 transações** antes
da correção. Depois: **zero transações, zero aquisições JDBC e zero statements**.

As duas anotações foram removidas. Cadastro/autenticação, criação com consultas
necessárias e persistência transacional de resultados continuam intactos. Não há
migration, mudança de credenciais, apagamento de dados ou troca de plano do Neon.
Um teste suspende o pool H2 e comprova que as consultas da sala continuam
respondendo. Isso elimina a dependência indevida; não quantifica o tráfego que
efetivamente ocorreu no Neon da gravação.

Outro erro foi reproduzido no teste integrado: saída do último humano deixando
bots causava NPE ao procurar o nome do host nulo. A busca agora retorna ausência
de participante para UUID nulo, sem tratar bots como contas humanas.

## Evidências e reprodução

- Regressões de comando ainda em trânsito em 30/60/120/144 FPS, ACK posterior ao
  freio, tecla mantida, limites, reconexão e regressões físicas existentes.
- Regressões de silêncio de snapshots, retomada e envio de comandos durante a
  pausa; aviso descartável sem repetição contínua.
- Teste offline Java em Suzuka, dois humanos e um bot: médias de tick por bloco
  de 0,09–0,63 ms nesta máquina. Não representa CPU compartilhada do Render.
- Smoke Chrome real com backend H2 isolado, Suzuka, dois humanos e um bot,
  80 ms artificiais por sentido, 4 s acelerando, frenagem e doze pulsos de
  direção. Autenticação, lobby, quali isolada, input, reconexão e Esc passaram.
- Na revisão final medida: mediana de RAF 16,7 ms nos dois clientes; p5/p95 da
  razão deslocamento/(velocidade × dt) aproximadamente 0,997–1,010 e 0,997–1,007.
  Essa razão considera quadros móveis sem dano e dt de 5–40 ms. Não esconde a
  existência de picos: maior RAF foi 83,4 ms; recepção/replay p95 de 6,3 ms.
  Relógio do servidor local avançou em aproximadamente 100% do tempo real.
- Saídas de diagnóstico em `output/online-3c/` e `output/online-video-2026-09-15/`
  são locais/ignoradas pelo Git. O vídeo do usuário não integra o commit.

```powershell
npm run check
# Backend H2 isolado em :8081, nunca o Neon:
$env:ONLINE_SMOKE_TRACK='suzuka'
$env:ONLINE_SMOKE_DELAY_MS='80'
node tools/online-race-browser-smoke.mjs --profile --maneuvers
# Comparar apenas a predição anterior sem alterar checkout:
$env:ONLINE_SMOKE_BASELINE_REF='da12b39'
node tools/online-race-browser-smoke.mjs --profile --maneuvers --baseline
```

## Publicação e teste do autor

### Gate final e ponto de retomada

- Frontend: `npm run check` aprovado, **474 testes / 55 arquivos**, lint e build.
- Backend: **134 testes**, zero falhas/erros, um diagnóstico opcional ignorado.
  Inclui WebSocket com pool suspenso e saída do último humano com bots.
- O repackage inicialmente foi bloqueado pelo JAR aberto no servidor H2 de
  diagnóstico. Após nova autorização do autor, a identidade do processo foi
  verificada, somente esse servidor foi encerrado e o pacote foi gerado com
  sucesso. O bloqueio temporário de aprovação não foi contornado.
- Branches de entrega: `codex/module-3c-online-stall` nos dois repositórios,
  baseadas no develop atualizado. Não promover main nem declarar validação
  manual concluída; publicação em PRs separados para develop.

PRs separados para **develop**, sem merge automático e sem promover main.
Publicar o backend corrigido no Render e usar a preview frontend correspondente.
Repetir Suzuka com os mesmos dois jogadores e um bot: reta, frenagem, pulsos de
direção, curvas prolongadas, saída/reentrada e reconexão. Observar se aparece o
aviso de atualizações atrasadas. Só depois retomar quali/corrida completa/pódio.

Esta rodada não altera `RaceEngine`, física 2.0.3, câmera, minimapa, pistas,
colisores, bots, solo/local, valores de design ou protocolo compartilhado.
