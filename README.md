# Never Lift

Frontend web do Never Lift, um jogo de corrida 2D multiplayer top-down com simulação acessível de um monoposto inspirado na F1 de 2026 e efeitos visuais arcade controlados. Este repositório contém as telas do aplicativo e o motor de corrida renderizado em Canvas.

## Fundação técnica

- React 19 + TypeScript strict + Vite.
- Tailwind CSS 4 pelo plugin oficial do Vite.
- shadcn/ui configurado em `components.json`, com aliases `@/*`, variáveis CSS e utilitário `cn` prontos para receber componentes.
- Vitest + Testing Library para testes de componentes.
- Oxlint para análise estática.
- GitHub Actions para lint, testes e build em pull requests e nas branches protegidas.

## Fundação visual

- Paleta **Midnight Racing** aplicada por tokens em `src/index.css`, com azul principal, magenta de acento e cores semânticas próprias para sucesso, aviso, informação e perigo.
- Barlow e Barlow Condensed são empacotadas localmente por `@fontsource`; a interface não depende de Google Fonts ou de outra CDN.
- O símbolo e o logotipo oficiais ficam em `public/brand/` e são aplicados pelo componente compartilhado `Brand`.
- `AppShell` fornece a navegação lateral no desktop e o cabeçalho compacto em telas menores, mantendo a mesma hierarquia e os mesmos fluxos.
- Menu, login, cadastro, conta, formulários e diálogo irreversível compartilham superfícies, espaçamentos, bordas e estados visuais consistentes.
- Os oito avatares chibi atuais continuam válidos. A eventual substituição pelos retratos semirrealistas documentados será uma rodada própria de assets, sem alterar os identificadores de avatar.

## Módulo 1 — usuários e autenticação

- `/` abre o menu principal e cria automaticamente uma sessão guest.
- `/login` e `/register` autenticam o piloto; o cadastro aceita um dos oito avatares chibi originais do Never Lift.
- `/account` permite trocar nome, avatar ou senha mediante confirmação da senha atual e excluir a conta por meio de um `AlertDialog` irreversível.
- O backend atual devolve JWT no corpo. O frontend guarda esse token somente no estado em memória e o envia como `Authorization: Bearer`; nada é escrito em `localStorage` ou `sessionStorage`.
- Rotas online futuras devem ser aninhadas sob o componente `OnlineRoute`, que direciona guest e visitante para `/login` com uma mensagem explicativa.

Como a sessão fica exclusivamente em memória, recarregar a página remove o login atual e, ao voltar para `/`, uma nova sessão guest é criada. Esse comportamento é intencional enquanto o backend não adotar cookie `httpOnly`.

## Módulo 2 — motor local, pistas e ambiente

- `/race` abre a preparação do `RaceEngine`, com as 24 pistas do catálogo `2026.6`, prévia do traçado, país, comprimento e ambiente, além do F1 único e sua paleta de pinturas predefinidas.
- O runtime v2 usa passo fixo de `1/120s`; o `requestAnimationFrame` apenas alimenta o acumulador e interpola a renderização entre os dois últimos ticks.
- A Parte 2d implementa o contrato físico `2.0.0`: corpo rígido 2D, pneus com aderência combinada, transferência de carga, downforce/drag, tração traseira, câmbio automático, frenagem sem ABS, colisores compostos precisos, manifold, torque de impacto e CCD. A especificação e as fontes estão em `docs/contracts/module-2-physics-v2-proposal.md`.
- O frontend carrega `TrackDefinition` `2.0.0` por `GET /api/tracks/{id}` e a injeta no motor. Grid, centerline, largura, superfícies, checkpoints direcionais, linha de corrida, zebras, limites e faces canônicas de barreira vêm da mesma definição métrica usada pelo backend. A centerline é suavizada e amostrada a cada aproximadamente 5 m para que asfalto, áreas externas, barreiras e grades acompanhem as curvas. Cada lado pode combinar asfalto externo, grama e brita antes de uma barreira de impacto (`concrete-wall`, `guardrail`, `tecpro` ou `tyre-barrier`) e de uma grade de detritos externa opcional; a face desenhada da barreira é também seu limite físico.
- A câmera acompanha a posição e exclusivamente a direção do movimento com suavização de `0,25s`; o ângulo da carroceria não interfere na orientação. A projeção 2.5D usa inclinação de `42°` a partir da vista superior, comprime a profundidade para aproximadamente `0,743` e posiciona o carro em `68%` da altura, exibindo pouco mais que o dobro de pista à frente em relação à traseira. O comprimento visual nominal usa 6% da altura antes da projeção angular. Paradas preservam a última orientação e uma inversão sustentada segura a câmera por `0,4s` antes da convergência suave. O minimapa usa as mesmas coordenadas do mundo e nunca gira.
- O F1 original usa geometria Canvas detalhada e rotação visual contínua relativa a cada câmera, sem saltos entre poses. A silhueta combina volumes aerodinâmicos contínuos, bico alongado, asas multicamada, quatro pneus e rodas, suspensão, sidepods, assoalho, difusor, cockpit, capacete, halo e cobertura do motor legíveis conforme o ângulo, evitando a aparência de blocos retangulares desconectados. No Módulo 2, a pintura competitivamente neutra fica restrita a vermelho, azul ou verde em tons sóbrios; superfícies secundárias derivam da mesma cor em valores mais claros ou escuros, enquanto carbono, pneus e peças mecânicas permanecem neutros. A prévia usa o mesmo modelo com detalhe adicional.
- O modo local usa câmera própria para cada jogador: divisão vertical em áreas largas e horizontal abaixo da razão `1,35`. A pista é desenhada vetorialmente somente nos `chunks` visíveis, sem bitmap proporcional ao circuito completo.
- Solo cria dois bots determinísticos. No modo local, o jogador 1 usa WASD e o jogador 2 usa setas. Em solo, WASD e setas controlam o mesmo carro; A/seta esquerda esterçam para a esquerda e D/seta direita, para a direita.
- Boost/nitro não existe no runtime v2 e `Shift` não é capturado nem executa qualquer ação.
- O dano mecânico v2 é cumulativo e deriva da variação de velocidade normal do impacto. Danos de direção e motor afetam a dinâmica; impactos críticos ou perda de toda a integridade causam perda total, que desativa os controles.
- Ao terminar, o frontend envia a classificação autenticada para `POST /api/races/local-result` com `trackId`, `trackCatalogVersion` e `physicsContractVersion` efetivamente usados.

As Partes 2a, 2b e 2c e o catálogo `2026.5` passaram pela validação manual integrada em 24/08/2026. A simplificação posterior para F1 único/condução fixa e os refinamentos de câmera 2.5D/F1 ainda exigem validação manual final. Na Parte 2d, a implementação automatizada está concluída e a validação manual permanece pendente; por isso a Parte 2d e o Módulo 2 continuam em andamento e o Módulo 3 ainda não deve começar.

## Roadmap

Os Módulos 0–9 formam o MVP planejado. A expansão pós-MVP aprovada está registrada nos Módulos 10–16: progressão e cosméticos por conquista, contrarrelógio com fantasmas, controles personalizáveis, espectadores, equipes, torneios automáticos e conduta esportiva. O escopo, as dependências e os critérios de pronto ficam em [`docs/frontend-implementation-plan.md`](docs/frontend-implementation-plan.md); o estado corrente de cada módulo fica em [`AGENTS.md`](AGENTS.md).

A direção visual aprovada, incluindo paleta, tipografia, câmera dinâmica, escala métrica, veículos, circuitos, HUD e composição das telas, está em [`docs/game-design-guide.md`](docs/game-design-guide.md). A documentação não antecipa funcionalidades: a fundação visual global já foi aplicada numa rodada isolada e cada decisão específica continua entrando somente no módulo responsável. Os fluxos e o status funcional do Módulo 1 foram preservados.

A preparação técnica do Módulo 2 está em [`docs/contracts/module-2-shared-contracts.md`](docs/contracts/module-2-shared-contracts.md), na [proposta aprovada da física v2](docs/contracts/module-2-physics-v2-proposal.md) e em [`contracts/module-2/v2/`](contracts/module-2/v2/). O `v1` preserva o catálogo `2026.5` e a física `1.3.0` como histórico imutável; o runtime atual usa a linha `v2`, catálogo `2026.6` e física `2.0.0`. O frontend mantém somente a pista selecionada em memória; as 24 geometrias completas pertencem ao backend e chegam pela API.

## Pré-requisitos

- Node.js 24 recomendado. O Vite exige, no mínimo, Node.js 20.19 ou 22.12.
- Backend do Never Lift disponível localmente ou em uma URL acessível pelo navegador.

## Configuração local

Crie o arquivo de ambiente a partir do exemplo:

```bash
cp .env.example .env
```

No Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Configure a URL base da API, incluindo o prefixo `/api` e sem adicionar `/health`:

```dotenv
VITE_API_URL=http://localhost:8080/api
```

A tela de diagnóstico consulta `${VITE_API_URL}/health`. Com o valor acima, a requisição será feita para `http://localhost:8080/api/health`.

## Executando

```bash
npm install
npm run dev
```

O Vite exibirá a URL local no terminal, normalmente `http://localhost:5173`.

## Verificações

```bash
npm run lint
npm run test
npm run build
```

Para executar as três verificações em sequência:

```bash
npm run check
```

## Deploy automático: Vercel

Foi escolhida a **Vercel** porque ela detecta projetos Vite automaticamente, publica previews para pull requests e permite definir `main` como única branch de produção. Isso se encaixa no fluxo do repositório: branches de trabalho entram em `develop` e somente `develop` entra em `main`.

O arquivo `vercel.json` já fixa o comando de instalação, o build, a pasta `dist` e o fallback de SPA. A criação inicial do projeto precisa ser feita manualmente:

1. Entre em [vercel.com](https://vercel.com) e conecte a conta do GitHub que tem acesso à organização `Never-Lift`.
2. Clique em **Add New → Project** e importe `Never-Lift/never-lift-frontend`.
3. Confirme estas opções:
   - **Framework Preset:** Vite;
   - **Root Directory:** `./`;
   - **Install Command:** `npm ci`;
   - **Build Command:** `npm run build`;
   - **Output Directory:** `dist`.
4. Em **Environment Variables**, crie `VITE_API_URL` com a URL pública base do backend, terminando em `/api`. Marque **Production**, **Preview** e **Development**.
5. Clique em **Deploy** e aguarde o primeiro build.
6. Depois do deploy, abra **Settings → Git** e confirme **Production Branch: `main`**. Mantenha os deployments automáticos habilitados; commits em outras branches gerarão apenas previews.
7. Copie o domínio final da Vercel e permita essa origem na configuração CORS do backend. Se previews também precisarem consultar a API, permita os domínios de preview de forma controlada no backend.
8. Abra a URL de produção. Quando o backend estiver implantado e acessível, a tela deve mostrar `backend: ok` e, quando fornecida, a versão retornada pela API.

O painel da Vercel e o CORS do backend são configurações externas e não são criados por este repositório.

## Estrutura inicial

```text
src/
  assets/       # avatares originais e demais recursos visuais do app
  auth/         # sessão JWT exclusivamente em memória
  components/   # componentes React e base local do shadcn/ui
  lib/          # utilitários compartilhados e base do shadcn/ui
  pages/        # menu, autenticação, conta e laboratório de corrida
  race/         # física, loop fixo, colisões, input, bots e Canvas 2D
  test/         # configuração global dos testes
```

Consulte `docs/frontend-implementation-plan.md` para a arquitetura e os módulos planejados, `docs/game-design-guide.md` para a direção visual e `AGENTS.md` para as regras de contribuição.
