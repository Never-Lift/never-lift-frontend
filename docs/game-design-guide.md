# Guia de design do jogo — Never Lift

## 1. Papel deste documento

Este é o registro oficial das decisões de direção visual, experiência e apresentação do Never Lift. Ele define **como o jogo deve parecer e se comportar visualmente**, mas não antecipa a implementação de módulos futuros.

Use as etiquetas abaixo ao interpretar qualquer decisão:

- **MVP:** pertence aos Módulos 0–9.
- **Pós-MVP — Módulo N:** só deve ser implementada no módulo indicado.
- **Fundação visual:** decisão transversal que deve ser aplicada uma única vez, em uma rodada isolada antes do Módulo 2, e então reutilizada pelos módulos seguintes.
- **Calibração:** valor inicial que precisa ser confirmado em protótipo sem alterar a direção aprovada.

O Módulo 1 permanece funcionalmente pronto. A futura modernização visual das telas existentes exige testes de regressão, mas não reabre o escopo de autenticação.

Este arquivo deve permanecer sincronizado entre os repositórios frontend e backend. O frontend é responsável pela implementação visual; o backend só implementa os contratos e dados compartilhados explicitamente indicados aqui e em seu próprio plano.

## 2. Princípios de direção

- Visual vivo, agressivo e contemporâneo, sem parecer infantil.
- Base semirrealista com efeitos arcade controlados.
- Legibilidade da corrida tem prioridade sobre detalhe, brilho ou fidelidade fotográfica.
- A referência visual não autoriza reaproveitar código ou assets de outros jogos.
- **Rush Rally Origins** é a principal referência de câmera e leitura geral.
- **Circuit Superstars** é referência de clareza de circuito e organização da corrida.
- **art of rally** é referência de composição e atmosfera controlada.
- **Need for Speed Heat** é referência de energia, tipografia, interface e contraste, sem copiar sua identidade.
- O projeto não terá uma etapa própria de identidade sonora; sons serão tratados apenas como necessidade funcional futura.

## 3. Identidade visual

### 3.1 Paleta “Midnight Racing”

| Papel | Cor | Uso principal |
|---|---|---|
| Fundo principal | `#070B14` | Base escura do aplicativo e menus |
| Azul principal | `#2D7DFF` | Ações, seleção e identidade |
| Branco suave | `#F0F0FA` | Texto e detalhes claros; evitar branco puro |
| Magenta | `#FF2E88` | Acento de energia, nunca como cor dominante |
| Sucesso | `#2BD67B` | Confirmação e estados positivos |
| Aviso | `#FFB82E` | Atenção e estados intermediários |
| Perigo | `#FF4055` | Erro, exclusão e penalidade |
| Informação | `#31C7FF` | Dados, telemetria e informação neutra |

Regras:

- Superfícies e painéis derivam do fundo azul-marinho em tons discretamente diferentes.
- Gradientes são permitidos, mas devem permanecer controlados.
- Magenta aparece em detalhes, momentos especiais e raridades máximas; não deve dominar telas inteiras.
- Cor nunca é o único sinal de erro, sucesso ou alerta: usar também texto e ícone.

### 3.2 Logo

- Existem símbolo, logotipo e assinatura completa, em versões preta e branca.
- Os SVGs recebidos são contêineres com PNG embutido, não vetores reais; servem como referência até a vetorização definitiva.
- Não redesenhar ou converter automaticamente a marca durante módulos funcionais.
- Vetorização real, áreas de proteção, tamanhos mínimos e variantes coloridas pertencem à futura fundação visual.

### 3.3 Tipografia

- Família principal: **Barlow**.
- Títulos principais: **Barlow Condensed Black Italic 900**.
- Títulos secundários: **Barlow Condensed ExtraBold 800**.
- Botões: peso 700–800.
- HUD: peso 600–800, conforme hierarquia.
- Texto corrido: **Barlow Regular/Medium**.
- **Saira Condensed** pode ser avaliada somente como fallback para títulos que precisem de uma forma mais angular; não é a fonte padrão.
- A tipografia mais quadrada da marca permanece própria da logo e não precisa ser repetida em todo texto da interface.

## 4. Técnica visual e desempenho

- Renderização da corrida em Canvas 2D.
- Carros e objetos principais usam sprites rasterizados de alta qualidade, preferencialmente pré-renderizados.
- Pistas combinam texturas rasterizadas, formas do Canvas e elementos reutilizáveis.
- Fumaça, chuva, faíscas, spray, nitro e vento usam partículas limitadas e reutilizadas.
- Ícones, marcações e interface usam vetores sempre que fizer sentido.
- Ilustrações estáticas podem usar pintura digital; pixel art não faz parte da direção.
- Não usar uma imagem única gigantesca para cada circuito. A pista deve ser segmentada e desenhada por visibilidade.
- Não usar reflexos reais em tempo real, filtros de tela inteira ou partículas ilimitadas.
- Haverá qualidades gráficas baixa, média e alta.
- A resolução interna do Canvas pode se adaptar à qualidade e ao desempenho, sem alterar física, zoom ou tamanho aparente dos carros.
- HUD e textos permanecem nítidos fora da redução interna do Canvas.

### 4.1 Formatos de tela

- Prioridade para desktop.
- Suporte a 16:9, 16:10 e ultrawide.
- Ultrawide mostra mais cenário lateral, preservando a mesma visão à frente e atrás.
- O HUD permanece dentro de uma área central segura.
- Mobile e controles por toque não fazem parte do escopo atual.

## 5. Câmera, perspectiva e escala

### 5.1 Perspectiva e movimento

- Top-down levemente inclinado, mostrando principalmente o teto e uma pequena parte das laterais dos carros.
- A câmera acompanha a posição do carro.
- A câmera gira dinamicamente conforme a direção de movimento, não cada oscilação instantânea do ângulo da carroceria.
- Suavização inicial de referência: `0,2–0,3 s` (**calibração**).
- Quando o carro estiver parado ou quase parado, manter a última orientação válida.
- Rodadas e mudanças para ré não podem produzir giros instantâneos de 180°. A câmera conserva a orientação no início da ré e, se o movimento contrário persistir, converge suavemente para a nova direção.
- HUD e minimapa não giram com o mundo.

### 5.2 Enquadramento

- O carro fica aproximadamente em 60% da altura da área de jogo, mostrando mais pista à frente sem eliminar a visão traseira.
- Zoom fixo durante a corrida; adaptar resolução não significa alterar zoom.
- Comprimento visual inicial do carro: aproximadamente 5,5% da altura da área de jogo, equivalente a cerca de 60 px em 1080p.
- Limite visual inicial: 6% da altura (**calibração obrigatória no Módulo 2**).
- Microtremor somente em colisões fortes, muito curto e discreto; deve poder ser desativado.

### 5.3 Minimap

- Orientação fixa em relação ao circuito.
- Exibe o traçado completo, o jogador e os adversários.
- Não gira com a câmera.
- Usa transformação normalizada das coordenadas do mundo, nunca uma segunda simulação.

## 6. Pistas e ambientes

### 6.1 Catálogo e escala compartilhada

- O catálogo `2026.5` congela as 24 etapas do calendário original de 2026, incluindo Bahrain e Jeddah mesmo se o campeonato real for alterado durante a temporada. Os circuitos usam nomes reais, traçados reconhecíveis, ambientes laterais auditados e landmarks semânticos específicos por pista, destinados ao uso pessoal informado pelo proprietário.
- Curvas, asfalto, áreas externas, barreiras e grades derivam da mesma centerline métrica suavizada, amostrada a cada aproximadamente 5 m. Zebras são segmentos explícitos do contrato, colocados no lado interno e na saída das curvas conforme o traçado e o número oficial de curvas, com paletas específicas quando a identidade do circuito é conhecida.
- Se houver decisão futura de distribuição pública, nomes, marcas e apresentação devem ser revistos antes da publicação.
- Circuitos podem ter comprimentos diferentes e próximos das proporções reais.
- Unidade compartilhada de mundo: **1 unidade = 1 metro**.
- Posição, distância, dimensões, checkpoints, limites e metadados do circuito usam metros nos dois motores.
- Pequenos ajustes aproximados de 10–20% são permitidos quando necessários para legibilidade, física ou diversão, preservando a identidade do traçado.
- A pista existe em coordenadas de mundo e não precisa caber inteira na tela.
- Renderização usa trechos, culling e elementos reutilizáveis; tamanho do circuito não pode exigir um bitmap proporcional ao mundo inteiro.
- Limites são definidos por trecho e por lado. Cada lado declara uma sequência ordenada de zonas (`asphalt`, `grass` ou `gravel`) com largura em metros, seguida da barreira de impacto e, quando existir, de uma `debris-fence` externa independente. A grade é visual e nunca substitui nem desloca a barreira usada pela colisão. A largura do asfalto e a distância até a proteção podem variar ao longo da volta; mudanças grandes precisam de transição visual e física legível. Mônaco e circuitos urbanos murados preservam barreiras próximas, enquanto híbridos e autódromos alternam áreas de escape de acordo com as referências auditadas. Cruzamentos em níveis diferentes, como Suzuka, usam camada de elevação explícita para não misturar projeção, desenho nem colisões.

### 6.2 Aparência

- Traçado reconhecível, mas somente elementos marcantes dos arredores precisam ser recriados.
- Asfalto semirrealista simples: variação leve, poucas marcas e emborrachamento discreto.
- Limites com contraste controlado por zebras, cor e textura, sem contornos arcade fortes.
- Densidade equilibrada: mais objetos nos pontos marcantes e trechos abertos nos demais.
- Elementos de cenário são estáticos; clima e efeitos da corrida continuam dinâmicos.
- Áreas próximas recebem mais definição; regiões distantes usam terreno e objetos simplificados.
- Publicidade usa marcas fictícias e Never Lift de forma discreta, principalmente em reta principal, boxes e barreiras selecionadas.
- Tratamento cinematográfico de cor muito suave, sem filtros pesados.

### 6.3 Horário e clima

- Presets fixos por corrida: dia, entardecer ou noite.
- Não há ciclo de horário durante a prova.
- Clima semirrealista equilibrado e otimizado.
- Chuva usa partículas limitadas; pista molhada usa textura/brilho simulado; spray é pequeno; névoa é uma camada simples.
- Qualidades baixa e média reduzem automaticamente partículas, spray e camadas atmosféricas.

## 7. Veículos

### 7.1 Direção dos modelos

- O jogo usa um único modelo de corrida: um monoposto inspirado em carros de F1, sem copiar exatamente um modelo, equipe ou pintura real.
- Proporções semirrealistas: carroceria natural, pneus expostos, aerofólios e elementos de desempenho ligeiramente enfatizados.
- Não existe seleção entre categorias ou carrocerias; Supercarro e Drift foram retirados da direção aprovada.
- A variedade visual vem de pintura, capacete, acabamento e detalhes cosméticos da identidade Never Lift.
- A preparação de pista permanece plausível, sem peças ou proporções absurdas.

### 7.2 Detalhe e personalização

- Alto detalhamento na seleção/garagem; versão otimizada durante a corrida.
- Pintura-base com cor principal, secundária e detalhes.
- **MVP — Módulo 2:** paleta simples de cores predefinidas.
- **Pós-MVP — Módulo 10:** cores predefinidas mais seletor avançado.
- Prévia de personalização é imediata, mas exige Salvar ou Descartar.
- Acabamentos brilhante, metálico e fosco usam reflexos suaves.
- Sombra de contato permanente e projeção direcional discreta conforme o preset de iluminação.

### 7.3 Feedback na corrida

- Dano simples por estados, sem deformação detalhada:
  - normal: sem efeito;
  - danificado: marcas discretas e fumaça leve;
  - crítico: fumaça mais visível e pequenas faíscas ocasionais;
  - perda total: carro parado, visual escurecido e alerta no HUD.
- Efeitos de movimento arcade controlados: fumaça proporcional à perda de aderência, marcas de pneu limitadas, faíscas em contatos relevantes e nitro com chama/rastro curtos.
- Iluminação simples: faróis, lanternas, luz de freio e cone noturno, com brilho suave.
- Todos os participantes usam o mesmo modelo de F1 e a mesma física, colisão e desempenho.
- Jogadores são diferenciados somente pela pintura e pelos detalhes cosméticos permitidos.
- A mesma pintura principal não pode se repetir na mesma sala.

## 8. Interface e HUD

### 8.1 Linguagem

- Mistura das linguagens minimalista tecnológica, automobilismo profissional e urbana agressiva, com foco no híbrido.
- Estrutura e navegação são limpas; dados de corrida usam linguagem de automobilismo; títulos e momentos especiais recebem detalhes urbanos controlados.
- Cards e painéis: cantos entre 12 e 16 px como referência.
- Botões e campos: cantos entre 8 e 12 px.
- Recortes e diagonais aparecem apenas em títulos, seleções ativas e ações importantes.
- Profundidade suave por bordas finas, sombras leves e diferenças de superfície; evitar vidro ou neon excessivos.
- Menus têm espaçamento equilibrado; HUD é compacto.
- Ícones são minimalistas, normalmente em contorno médio; preenchimento sólido fica reservado a alertas e ações críticas.
- Animações de estado são rápidas e discretas, normalmente entre 150 e 250 ms; sem elasticidade infantil.
- Gradientes leves são a base. Imagens estáticas otimizadas aparecem apenas no menu principal, seleção de carro e telas especiais. Não usar vídeo ou garagem 3D como fundo.

### 8.2 HUD de corrida

- Distribuição periférica; centro livre para a corrida.
- Painéis pequenos, escuros e semitransparentes somente onde o contraste exigir.
- Elementos permanentes:
  - posição e total de competidores;
  - volta atual e total;
  - tempo atual e melhor volta;
  - minimapa;
  - nitro;
  - velocidade.
- Elementos condicionais:
  - dano somente quando existir;
  - penalidades, bandeiras e alertas temporariamente;
  - classificação detalhada somente em momentos apropriados.
- Não exibir telemetria decorativa ou gráficos sem uso para a jogabilidade.

### 8.3 Acessibilidade visual inicial

- Contraste adequado e textos legíveis.
- Estados importantes usam cor, ícone e mensagem.
- Não há, inicialmente, presets de daltonismo, ajuste manual amplo de escala ou modo completo de redução de movimento.
- Manter a opção específica de desligar o microtremor da câmera.

## 9. Estrutura das telas

### 9.1 Shell e menu principal

- Menu híbrido: navegação vertical compacta à esquerda, barra superior discreta, carro em destaque e no máximo dois cards contextuais.
- Logo no topo da barra lateral; configurações e sair ficam próximos ao final.
- Barra superior mostra perfil, notificações e estado online.
- “Jogar” é a ação principal.
- Atalho para continuar ou repetir a última atividade.
- Garagem, Social, Perfil, Recordes e Configurações aparecem conforme seus módulos estiverem disponíveis; não mostrar entradas de módulos ainda não implementados.
- Cards contextuais priorizam atividade recente/última corrida; convites urgentes, torneios ou desbloqueios podem ocupar temporariamente uma posição.
- O carro aparece no menu, garagem e preparação; Perfil, Social, Recordes e Configurações usam composições próprias.

### 9.2 Seleção de modo e preparação

- Seleção de modo: cards compactos com prévia maior e descrição.
- Categorias fixas: Solo e local, Online e Competição.
- Estrutura compartilhada entre solo, local e online, adaptando campos e permissões.
- Escolhas principais visíveis; opções adicionais em área expansível.
- Circuitos em lista compacta com prévia grande do traçado, país, comprimento e ambiente.
- O F1 atual fica visível; “Personalizar” abre um painel compacto de pintura e capacete, sem seleção de modelo.
- Painel lateral fixo resume pista, voltas, clima, horário, tipo de prova e pintura.
- Ação principal muda entre Iniciar, Pronto e Iniciar como host.
- No modo local, a colisão entre carros fica ativa. O split-screen divide verticalmente telas largas e horizontalmente telas abaixo da razão de aspecto `1.35`, sempre com uma câmera por jogador.
- A condução usa uma única configuração fixa para todas as corridas e participantes; não existe seletor Normal/Drift nem troca de acerto durante a prova.
- Shift é reservado ao nitro/boost do Módulo 5. O orçamento depende do total de voltas, é finito e não recarrega.
- Dano no Módulo 2 é cumulativo, reduz uma barra de vida e usa intensidade do impacto: fraco afeta direção, médio afeta motor, alto combina os dois e crítico causa perda total. Batidas menores repetidas também podem causar perda total. Motor reduz desempenho de forma moderada; direção aplica um leve desvio persistente para a esquerda ou direita sem reduzir a capacidade de esterçar, e uma nova batida fraca pode redefinir o lado. O Módulo 5 acrescenta reparo em pits e o tratamento visual completo. Bots mais difíceis melhoram ritmo, frenagem, trajetória, recuperação e consistência simultaneamente.

### 9.3 Resultado e pódio

- Top 3 em pódio visual; demais participantes em lista compacta na mesma tela.
- Mostrar tempo total, melhor volta e penalidades relevantes.
- Ações para repetir, trocar circuito ou voltar ao menu.
- **Pós-MVP — Módulo 10:** progresso e recompensas aparecem em painel integrado, não em tela obrigatória separada.

### 9.4 Autenticação, conta e configurações

- Login/registro: composição dividida no desktop e card centralizado em áreas menores.
- Conta: seções de perfil, segurança e área de risco na mesma página.
- Exclusão permanece isolada no final, com confirmação explícita.
- Configurações: categorias laterais e painel de conteúdo; mudanças imediatas e ação para restaurar padrões.

### 9.5 Perfil, Social, Recordes e Campeonatos

- Perfil híbrido: identidade em destaque e abas de visão geral, estatísticas, histórico e conquistas.
- Social: amigos, solicitações e notificações em estrutura híbrida; lista compacta e painel de detalhes do amigo.
- Notificações imediatas aparecem discretamente e permanecem na central.
- Recordes: top 3 em destaque, tabelas filtráveis e marca pessoal fácil de localizar.
- Campeonato: calendário, próxima corrida, classificação e etapa anterior no mesmo painel.
- Montagem de campeonato: biblioteca pesquisável de circuitos e calendário ordenável, com repetições e até 24 etapas.

### 9.6 Estados de sistema

- Carregamento: indicador minimalista com marca, mensagem curta e progresso somente quando mensurável.
- Erros aparecem no contexto: campo, painel, aviso persistente ou tela bloqueante, conforme gravidade.
- Detalhes técnicos ficam restritos à tela de diagnóstico.
- Estado vazio: ícone minimalista, mensagem curta e uma ação útil.

## 10. Telas pós-MVP

| Módulo | Decisão de composição |
|---|---|
| 10 — Personalização | F1 em destaque, painel lateral, rotação manual e cosméticos bloqueados visíveis com requisito; sem carrossel de modelos |
| 10 — Conquistas | Categorias, cards compactos, progresso e painel com requisito, raridade e recompensa |
| 10 — Medalhas | Forma ligada à conquista; materiais bronze, prata, ouro e titânio escuro; três ícones com tooltip |
| 11 — Contrarrelógio | Lista de circuitos e prévia detalhada; separar fantasma próprio dos fantasmas de amigos; um fantasma por tentativa |
| 12 — Controles | Lista de comandos com captura da próxima tecla/botão; conflitos oferecem Trocar ou Cancelar; restaurar padrões |
| 13 — Espectador | HUD reduzido e mesma câmera dinâmica do piloto selecionado; alternância entre participantes |
| 14 — Equipes | Painel com identidade, membros, estatísticas e ranking; nome, sigla, cor e emblema predefinido |
| 15 — Torneios | Agenda, detalhes, inscrição e chaveamento em colunas por rodada com cards de corridas |
| 16 — Penalidades | Aviso curto durante a corrida e explicação objetiva integrada ao resultado |

## 11. Avatares e medalhas

### 11.1 Avatares

- Os oito avatares chibi atuais permanecem enquanto o Módulo 1 não passar pela futura modernização visual.
- Direção futura: aproximadamente oito retratos ilustrados semirrealistas originais.
- Proporções humanas naturais, enquadramento de cabeça/ombros/peito e foco no rosto.
- Arquétipos ligados ao automobilismo, sem representar pessoas reais.
- Personalidades maduras e variadas: confiante, focado, calmo, competitivo e discretamente descontraído.
- Conjunto fixo identificado por `avatarId`; não criar editor modular.

### 11.2 Medalhas

- A forma comunica a conquista: troféu/bandeira para vitórias, louros para campeonatos, volante para domínio técnico, cronômetro/calendário para idade da conta, escudo para corrida limpa e traçado para domínio de circuito.
- O material comunica a raridade: bronze, prata, ouro e titânio escuro com detalhe azul/magenta.
- Três medalhas equipadas aparecem abaixo da identidade do jogador.
- Nome, requisito e data ficam em tooltip ou painel curto; lobby e pódio usam versões menores.

## 12. Implementação por fase

### 12.1 Fundação visual, antes do Módulo 2

Executar em uma rodada e PR próprios, sem misturar com funcionalidade de corrida:

- tokens de cor, tipografia, espaçamento, raios, bordas e elevação;
- componentes-base e shell compartilhado;
- aplicação correta das variantes de logo disponíveis;
- modernização visual das telas dos Módulos 0 e 1;
- testes de regressão dos fluxos existentes;
- nenhum endpoint, regra de autenticação ou status funcional deve mudar.

### 12.2 Decisões que entram com seus módulos

| Módulo | Principais decisões aplicadas |
|---|---|
| 2 | física em metros, circuitos extensos, câmera, minimapa local, culling, F1/pintura e tela de preparação |
| 3 | lobby, minimapa online, carros remotos e preparação com permissões |
| 4 | presets de horário, clima otimizado e modo caos |
| 5 | HUD, dano simples, efeitos de movimento, resultado e pódio |
| 6 | criação e painel de campeonato |
| 7 | Social e notificações |
| 8 | Perfil, Recordes e histórico |
| 9 | i18n, estados de sistema, responsividade e polimento final do MVP |
| 10–16 | somente as decisões explicitamente etiquetadas como pós-MVP |

## 13. Pontos de calibração, não decisões em aberto

Os itens abaixo precisam de protótipo, mas não autorizam trocar a direção definida:

- intensidade e curva exata da suavização da câmera — calibração da Parte 2b: `0,25s`, limite angular para impedir giros instantâneos e retenção inicial de `0,4s` antes de convergir durante ré sustentada;
- escala final do carro dentro do alvo de 5,5% e limite inicial de 6% — calibração da Parte 2b: `5,5%` da altura da viewport focada;
- densidade máxima de partículas por nível de qualidade;
- tons intermediários das superfícies escuras;
- quantidade de trechos de pista mantidos em memória — na Parte 2b, somente os `chunks` cuja projeção intercepta a viewport, com margem equivalente à largura visual da pista, são desenhados;
- compressão e resolução final de sprites e imagens estáticas;
- pequenos ajustes métricos de cada circuito para jogabilidade.
