# M3b — correção de portabilidade da física 2.0.3

## Autorização e limite da entrega

Em 04/09/2026, o autor confirmou a validação manual básica da Parte 3b e
autorizou explicitamente uma revisão sincronizada de portabilidade nos dois
repositórios. Não foi autorizado novo tuning: potência, freio, aderência,
direção e dano mantêm todos os seus parâmetros. A Parte 3c não foi iniciada.

Esta correção está implementada e validada automaticamente. O autor confirmou
explicitamente o teste manual curto da revisão **2.0.3** em 04/09/2026:
“validações manuais deram certo, tudo aprovado”. A aprovação desta revisão é
separada da versão anterior e não antecipa os novos ajustes de controles/lobby
solicitados em seguida. A Parte 3c permanece pendente.

## Problemas reproduzidos

- A referência 2.0.2 passava em Java 21 e no Node 24 usado para congelá-la,
  mas o motor TypeScript real divergia no Node 22 e nos Chrome/Edge instalados.
- Exemplo no Node 22: cenário de perda de aderência com diferença de posição
  de cerca de 0,109 m, acima dos 0,03 m permitidos. Chrome/Edge também
  excederam os limites, incluindo diferença de RPM acima de 500 em uma amostra.
- A causa foi a diferença de arredondamento das funções transcendentais nativas,
  amplificada pelo modelo não linear. Fixar apenas a versão do Node não corrige
  a execução no navegador. StrictMath isoladamente também não padroniza JavaScript.
- O verificador textual ainda rejeitava arquivos equivalentes com CRLF no Windows.

## Correção e contrato

O kernel **portable-f64-v1** foi implementado em `src/race/portable-math.ts`
e em `com.neverlift.backend.race.physics.PortableMath`. Ambos avaliam as mesmas
operações IEEE-754 binary64, na mesma ordem, sem FMA nem substituição por
funções transcendentais da plataforma:

| Operação | Avaliação canônica |
|---|---|
| sin/cos | Redução por quadrantes com pi/2 dividido em parte alta/baixa; séries recorrentes até graus 21/20. |
| atan2 | Quadrantes e zeros com sinal; redução recíproca e ao redor de 1; série alternada até grau 49. |
| tanh | Identidades com expm1, redução por ln(2) alta/baixa e série exponencial até grau 18; saturação para módulo >= 22. |
| potência | Base não negativa; expoentes inteiros por quadrados sucessivos; demais por log/exp reduzidos. Log usa série ímpar até grau 33. |
| hypot 2D | Norma escalada, mesma ordem de divisão/multiplicação/soma e raiz quadrada. |

É um kernel do jogo, **não uma substituição geral de Math**. sin/cos são usados
com ângulos físicos normalizados e pelo ruído dos bots; a redução simples não
promete precisão para argumentos astronomicamente grandes. Os testes de
precisão cobrem [-64,64] rad, quadrantes, zeros com sinal, saturação de tanh
e potências de cargas/fatores positivos de 2^-15 a 2^15.
No ruído do bot, conservar o relógio em segundos da sessão; não passar epoch
em milissegundos como argumento. Não reorganizar somas ou trocar por funções
nativas por parecerem equivalentes.

O integrador, as colisões, projeções geométricas e decisões de bots usam esse
kernel. O mesmo RaceEngine continua único no frontend. Câmera, layout, input,
assets e regras da corrida não foram redesenhados. Não foram adicionadas
dependências matemáticas ao aplicativo ou ao JAR.

- Constantes, limites dos testes, dimensões, fórmulas de forças e ordem física:
  preservados. Só a identificação do contrato passa de 2.0.2 para **2.0.3**.
- Catálogo **2026.12**, schema de pista **2.0.0** e geometrias dos 24 circuitos:
  preservados. As definições foram regeneradas somente para anunciar 2.0.3.
- Cliente, API, lobby, snapshots, testes e schemas agora exigem 2.0.3 juntos.
  Uma preview 2.0.2 deve ser recusada, nunca misturada silenciosamente.
- Referências físicas/geometria 2.0.2 permanecem históricas, sem sobrescrita.
  Novos arquivos `typescript-reference-2.0.3.json` e
  `typescript-geometry-2.0.3.json` vêm do TypeScript executável, com hashes LF.
- O verificador normaliza somente CRLF/LF. Números, hashes, campos,
  espaços e conteúdo divergente continuam sendo rejeitados.
- O coletor é compartilhado entre o gerador e os testes de navegador; não há
  um motor simplificado de teste que substitua a implementação real.

O novo arredondamento pode mudar trajetórias caóticas em relação a 2.0.2.
O objetivo é que **cliente e servidor da mesma versão** concordem; não prometer
replays bit-idênticos entre versões diferentes.

## Evidências desta rodada

Windows, 04/09/2026. Os números abaixo são execuções locais, não capacidade
garantida do Render nem validação manual de uma corrida online ainda inexistente.

- Frontend: lint e build aprovados; **338 testes em 39 arquivos**, sem falhas.
- Backend: `clean package` aprovado; **110 testes passaram**. Um diagnóstico
  opcional foi desativado (111 contabilizados, 1 skipped); nenhuma aceitação pulada.
- Java/TypeScript: **11 cenários, 413 estados**; **648 amostras nas 24 pistas**
  para geometria, superfícies, colliders e decisões dos bots. Tolerâncias originais.
- Os testes de integração HTTP/WebSocket continuam executando dois clientes reais,
  inputs, snapshots autoritativos, versão incompatível e rejeição de posição do cliente.
- **7 testes** do verificador: runtime do gerador, LF/CRLF, detecção de números/hashes
  alterados, limites métricos e rejeição de dados ausentes ou não finitos.

| Runtime | Resultado dos 413 estados contra a referência Node 24 |
|---|---|
| Java 21.0.10 | Paridade aprovada dentro das tolerâncias contratuais. |
| Node 22.14.0 | Todos os campos numéricos comparados com diferença zero. |
| Chrome 152.0.7977.76 | Diferença zero; estado de dano idêntico. |
| Edge 152.0.4191.62 | Diferença zero; estado de dano idêntico. |
| Chromium 151.0.7922.34 | Diferença zero; estado de dano idêntico. |
| WebKit 26.5 via Playwright | Diferença zero; estado de dano idêntico. |

Referência produzida com **Node 24.19.0**. WebKit de teste não equivale a uma
validação de Safari/iPhone real. Firefox 153 foi baixado isoladamente, mas não
iniciou neste Windows (`spawn UNKNOWN`); não é declarado aprovado.
O comando permite repetir essa checagem em outra máquina sem alterar referências.

Probe de uma sala com 22 carros (21 bots), quatro subpassos por tick:
**média 13,456 ms; p95 15,644 ms**, orçamento de 33,333 ms; 11.161 contatos.
São 120 ticks de aquecimento e 120 medidos em Albert Park. Isso não comprova
múltiplas salas nem capacidade da infraestrutura de produção.

## Como reproduzir

Frontend e backend devem estar nos commits correspondentes desta revisão.
Executar `npm ci` no frontend. Usar Java 21 e Node 24.x nos geradores;
não gerar uma referência diferente apenas para obter um teste verde.

No backend:

```sh
./mvnw --batch-mode clean package
node --test tools/physics-parity/reference-support.test.mjs tools/physics-parity/compare-reference.test.mjs
node tools/physics-parity/generate-reference.mjs ../never-lift-frontend --check
node tools/physics-parity/generate-geometry-reference.mjs ../never-lift-frontend --check
node tools/track-catalog/generate-v2.mjs --check
node tools/track-catalog/audit-v2.mjs --mirror ../never-lift-frontend/contracts/module-2/v2
node tools/physics-parity/verify-runtime-reference.mjs ../never-lift-frontend
npm ci --prefix tools/physics-parity
node tools/physics-parity/node_modules/playwright/cli.js install chromium firefox webkit
node tools/physics-parity/verify-browser-reference.mjs --frontend ../never-lift-frontend --browsers chromium,firefox,webkit
```

O último comando usa perfis descartáveis e uma página vazia local que importa
o motor real; não usa conta, API de produção nem perfil pessoal. Para Chrome/Edge
instalados: `--browsers chrome,msedge`. No Node 22, executar somente o verificador
read-only `verify-runtime-reference.mjs`, não os geradores canônicos.

No frontend: `npm run check`.

Se o Java HttpClient falhar ao criar o socket de teste devido ao diretório
temporário do Windows, pode-se usar localmente
`-DargLine=-Djdk.net.unixdomain.tmpdir=<caminho-absoluto-do-backend>/target`.
Isso é ajuste do runner local, não mudança no servidor de produção.

## Validação manual curta antes da 3c — concluída em 04/09/2026

1. Após mesclar os dois PRs em **develop**, publicar backend e preview frontend
   correspondentes a **2.0.3**. Não promover para main nesta etapa.
2. Em solo/local, usar uma pista rápida e uma travada (ex.: Spa e Mônaco):
   acelerar, frear, fazer curvas, provocar perda de aderência e um contato leve
   com muro/outro carro. Confirmar condução utilizável, dano coerente e ausência
   de teleporte, travamento ou mudança inesperada de sensação. Conferir também
   a ré. Não é preciso refazer toda a inspeção visual dos 24 circuitos.
3. Em dois navegadores, entrar na mesma sala, confirmar pronto e iniciar a
   sessão técnica. Não deve haver incompatibilidade de versão ou reconexão
   infinita; cancelar/sair deve continuar funcionando.
4. Informar o resultado. Com essa confirmação e checks dos PRs aprovados,
   a base técnica fica liberada para implementar **M3c**. Corrida online
   jogável, quali, checkpoints e predição/reconciliação ainda são trabalho da 3c.

## Referências técnicas

A investigação consultou as garantias de
[StrictMath no Java 21](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/StrictMath.html).
As identidades de série usadas no kernel são matemáticas elementares,
documentadas no [NIST DLMF — seno/cosseno](https://dlmf.nist.gov/4.19) e
[NIST DLMF — séries de logaritmos](https://dlmf.nist.gov/4.6).
A implementação e seus resultados são específicos deste projeto; as fontes
não certificam automaticamente o kernel. Os navegadores de teste seguem a
[documentação oficial do Playwright](https://playwright.dev/docs/browsers).
