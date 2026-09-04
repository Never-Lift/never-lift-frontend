# Módulo 3 — registro de decisões online

Este documento consolida as 80 decisões tomadas na rodada de definição do
Módulo 3. Ele é um registro de produto e arquitetura aprovado para orientar a
implementação; não significa que o Módulo 3 esteja implementado ou pronto.

## Decisões aprovadas

1. **Frequência física:** servidor a 30 ticks/s, quatro subpassos de 1/120 s por tick e snapshots a aproximadamente 20 Hz.
2. **Composição da sala:** até 22 carros no total, misturando humanos e bots.
3. **Tamanho do grid:** configurável de 2 a 22; preenchimento por bots opcional.
4. **Entrada em salas:** código privado e lista pública de salas.
5. **Prontidão:** o host não marca pronto e inicia somente quando todos os demais humanos estiverem prontos; bots contam como prontos.
6. **Saída do host:** transferência automática para outro jogador elegível.
7. **Desconexão durante a corrida:** janela aproximada de 30 s, com bot temporário no mesmo carro.
   - **7.1:** se o jogador não voltar, o bot continua e o resultado permanece contabilizado.
8. **Autenticação WebSocket:** ticket temporário, em vez de expor o JWT principal na URL.
9. **Entrada tardia:** permitida somente durante o lobby; depois da contagem/classificação a sala fecha.
10. **Pista:** o host escolhe uma das 24 pistas e a definição/versionamento ficam fixos na sala.
11. **Voltas:** quantidade padrão fixa no M3; configuração livre fica para módulo posterior.
12. **Largada:** sequência de cinco luzes vermelhas no estilo F1.
13. **Queima de largada:** bloqueio do acelerador por 5 s.
14. **Carro finalizado:** vira `ghost`, permanece visível e deixa de colidir.
15. **Fim da corrida:** quando todos terminarem ou o limite de segurança do servidor for atingido; demais recebem `DNF`.
16. **Pós-corrida:** tela de resultados seguida de retorno ao lobby.
17. **Configurações:** somente o host altera pista, grid e bots durante o lobby; confirmações de pronto não bloqueiam a edição nem são apagadas por uma alteração. As configurações travam somente quando a classificação começa.
18. **Privacidade:** não existe senha; salas públicas aceitam entrada direta e salas privadas usam somente o código.
19. **Bots:** uma dificuldade única para todos os bots da sala; dificuldade altera decisões, nunca a física.
20. **Pinturas:** cores podem se repetir; número, gamertag e HUD identificam cada carro.
21. **Número do carro:** servidor atribui números únicos de 1 a 22 por sala.
22. **Interpolação remota:** atraso fixo de aproximadamente 100 ms entre snapshots.
23. **Envio de input:** input normalizado a 30 Hz, com `clientSeq` e `clientTimestamp`.
24. **Perda de input:** servidor mantém o último comando por aproximadamente 150–250 ms e neutraliza gradualmente depois.
25. **Validação:** servidor valida e normaliza todos os inputs; cliente nunca envia posição ou estado físico como autoridade.
26. **Inputs suspeitos:** resposta progressiva; descartar/registrar, limitar temporariamente e desconectar em reincidência.
27. **Ticket:** uso único e validade de 60 s.
28. **Snapshots:** transmissão a 20 Hz (aproximadamente a cada 50 ms).
29. **Resultados:** persistir resultado online completo; usuários participantes ficam associados e bots não; guest não acessa o online.
30. **Mínimo:** pelo menos 2 carros para iniciar; dois humanos ou um humano e um bot quando habilitado.
31. **Grid (decisão inicial substituída):** a opção aleatória foi superada pela classificação; a ordem final vem da quali definida nos tópicos seguintes.
32. **Formato da classificação:** todos participam simultaneamente, cada um em sua própria simulação isolada.
33. **Bots na quali:** humanos e bots fazem a volta classificatória simultaneamente.
34. **Tentativa:** uma tentativa por participante; volta inválida vai para o fim do grid.
35. **Condições da quali:** exatamente as mesmas condições da corrida.
36. **Transição quali/corrida:** tela curta de tempos e nova confirmação de pronto antes da corrida principal.
37. **Visual da quali:** cada jogador vê somente o próprio carro.
38. **Lista pública:** somente nome da sala, nome de exibição do host e ocupação/capacidade; o código aparece apenas dentro da sala.
39. **Nome da sala:** host pode definir nome curto; se omitir, servidor gera nome automático.
40. **Salas vazias:** encerramento automático de salas sem jogadores.
   - **40.1:** expiração após 10 minutos.
41. **Sala cheia:** bloquear novas entradas com mensagem genérica e clara.
42. **Remoção:** host pode remover jogadores somente no lobby.
43. **Empate na quali:** timestamp do servidor; quem registrou primeiro fica à frente.
44. **Falha do servidor:** cancelar a corrida e não registrar resultado parcial oficial.
45. **Vínculo do ticket:** ticket ligado ao usuário e à sala, além de ser único e temporário.
46. **Reconexão:** jogador retorna ao mesmo slot e ao mesmo carro, com estado mantido pelo servidor.
47. **Pausa:** não haverá pausa manual durante uma corrida online.
48. **Formato do M3:** somente corridas avulsas; campeonatos ficam para o Módulo 6.
49. **Reinício:** não haverá reinício manual após a largada.
50. **Visibilidade padrão:** sala nova é pública por padrão; host pode torná-la privada.
51. **Latência:** avisar o jogador e manter conexão enquanto o heartbeat funcionar; não expulsar somente por ping alto.
52. **Desconexão na quali:** bot conclui a tentativa no mesmo slot; jogador pode reassumir ao reconectar.
53. **Voltas padrão:** 3 voltas.
54. **Bots padrão:** desativados por padrão; host ativa quando desejar.
55. **Grid padrão:** 22 carros, podendo ser reduzido pelo host.
56. **Tempo da quali:** limite de 3 minutos.
57. **Inválidos da quali:** ordem aleatória determinística por seed do servidor.
58. **Sentido:** somente o sentido oficial de cada circuito.
59. **Ambiente do M3:** pista seca e período fixo, iguais na quali e na corrida.
60. **Pit lane:** navegável, sem parada de serviço; reparos e pit stops completos ficam para o Módulo 5.
61. **Velocidade do pit no M3:** sem limite ou penalidade de velocidade nesta etapa.
62. **Cortes:** checkpoints na ordem e validação dos limites; corte invalida quali e não concede progresso na corrida até retorno válido, sem penalidade de tempo no M3.
63. **Dano entre sessões:** estado físico completamente restaurado antes da corrida principal.
64. **Início da quali:** lançamento padronizado antes da linha; cronômetro começa ao cruzá-la.
65. **Bots na quali:** simulam a volta completa com a mesma física, limites e checkpoints.
66. **Falha de bot na quali:** mesmas regras dos humanos; sem tempo válido se não completar.
67. **Fim antecipado da quali:** encerrar quando todos concluírem ou ao atingir 3 minutos.
68. **Contagem da quali:** contagem sincronizada curta de 3 s antes do lançamento.
69. **Código da sala:** 4 dígitos numéricos; limite de tentativas e bloqueio contra força bruta são obrigatórios.
70. **Entrada inválida:** mensagem genérica, sem revelar existência da sala, com bloqueio progressivo.
71. **Limite inicial:** 5 tentativas por minuto por usuário e origem.
72. **Senha da sala:** removida; o código de quatro dígitos é o único segredo de uma sala privada.
73. **Fechamento manual:** host pode fechar no lobby; durante a corrida só pode sair, sem cancelar a prova.
74. **Alteração de visibilidade:** permitida ao host somente no lobby; fica bloqueada no início da quali.
75. **Jogador inativo no lobby:** não remover automaticamente; host decide.
76. **Grid de 22:** duas colunas alternadas em 11 fileiras, usando largura da pista e espaçamento do contrato.
77. **Ordenação de `DNF`:** concluídos à frente; entre `DNF`, maior progresso válido, depois tempo do servidor.
78. **Chegada simultânea:** timestamp autoritativo do servidor no cruzamento da linha.
79. **Resultados:** tela permanece até todos confirmarem ou por no máximo 60 s; depois retorna ao lobby.
80. **Heartbeat:** ping/pong a cada 10 s; duas ou três falhas consecutivas iniciam o fluxo de desconexão.

## Refinamentos validados na Parte 3a

- A criação inicial solicita somente nome e visibilidade; pista, limite do grid e bots são escolhidos pelo host dentro da sala enquanto ela permanecer no lobby, inclusive depois de participantes confirmarem `ready`.
- O estado pronto é reversível no lobby e permanece intacto quando o host altera configurações. O payload normativo é `ready { ready: boolean }`.
- A sessão WebSocket pertence ao app, não à página do lobby: navegar por Início, Jogar, Online ou Minha conta não remove o jogador. O item Online identifica e reabre a sala ativa.
- A saída voluntária ocorre pelo botão **Sair da sala**, sempre com confirmação, tanto para o host quanto para participantes comuns e mesmo depois de o lobby avançar. Quando o host sai, a função é transferida automaticamente. Entrada, saída, remoção e alterações do host são publicadas imediatamente aos participantes restantes.
- Uma queda preserva jogador e vaga durante a janela de reconexão de 30 s. Sem retorno após essa janela, o participante desconectado é removido e a vaga volta a ficar disponível. “Jogador inativo” na decisão 75 significa um cliente ainda conectado sem interagir e continua sem remoção automática.

## Revisão de produto da Parte 3a — 02/09/2026

Esta revisão é normativa e detalha as decisões atualizadas acima:

- O online exige conta. Guest enxerga a composição da tela escurecida/desfocada e o aviso para entrar, mas não recebe lista de salas, ticket nem acesso WebSocket.
- Senha de sala foi removida de ponta a ponta. Sala pública permite entrada direta pelo card; sala privada não aparece na lista e usa o código numérico de quatro dígitos como único segredo.
- A lista pública expõe apenas nome da sala, nome de exibição do host e ocupação/capacidade. O código aparece somente dentro da sala, ao lado de **Ajustes** para o host e de **Resumo da sala** para convidados.
- O host não possui estado `ready`. Todos os demais humanos podem confirmar ou retirar o pronto; o host inicia a classificação quando todos eles confirmarem e o grid mínimo estiver atendido.
- Pista, grid, bots/dificuldade e visibilidade são ajustes vivos: não existe botão de salvar, e cada mudança válida é propagada aos demais participantes. O seletor de pista é um carrossel visual de traçados; o grid usa campo sem setas, botões `−`/`+` e normalização entre 2 e 22.
- O resumo do convidado contém pista, estado e bots (ativo/inativo, quantidade e dificuldade). O host vê somente o card de ajustes.
- Avisos e erros da tela são notificações no canto superior direito, expiram após cinco segundos e podem ser fechados manualmente.
- O host pode cancelar a classificação e retornar ao lobby somente enquanto nenhum carro tiver começado a andar; bots adicionados para o grid são removidos e as configurações voltam a ser editáveis.

## Limites e dependências

- Estas decisões não tornam o Módulo 3 completo: o Módulo 2 está pronto, a
  Parte 3a foi validada manualmente em dois navegadores e está pronta desde 03/09/2026, e as
  Parte 3b Java está implementada, com validação manual básica confirmada pelo autor.
  A correção numérica 2.0.3 foi autorizada separadamente, está testada automaticamente
  e aguarda confirmação manual curta; somente a Parte 3c permanece não implementada.
- Antes da 3c, seguir [module-3b-portability.md](module-3b-portability.md): os dois
  motores usam `portable-f64-v1`, sem chamadas transcendentais nativas na física.
- O M3 precisa reproduzir o contrato físico v2 e os cenários congelados antes de aceitar partidas online.
- O limite de velocidade e os serviços de pit permanecem deliberadamente fora do M3; entram no Módulo 5 conforme o plano.
- Penalidades esportivas de tempo e conduta permanecem no Módulo 16.
- O modo espectador continua no Módulo 13; entrada tardia no M3 não cria espectador.
- A lista pública e o ticket exigem endpoints WebSocket/REST compatíveis entre frontend e backend.
- O schema executável de tempo real v2 foi atualizado nesta Parte 3a para refletir o limite real
  de até 22 carros e o código de sala numérico de quatro dígitos, sem reescrever o histórico
  v1/v2 do Módulo 2 antecipadamente.
