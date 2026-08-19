# Never Lift

Frontend web do Never Lift, um jogo de corrida 2D multiplayer top-down com foco em drift. Este repositório contém as telas do aplicativo e, nos próximos módulos, o motor de corrida renderizado em Canvas.

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

## Módulo 2 — Parte 2a: motor local

- `/race` abre o laboratório do `RaceEngine`, com seleção entre F1, Supercarro e Drift, paleta predefinida e acerto normal/drift.
- O motor usa o passo fixo de `1/60s` e os perfis de `contracts/module-2/v1/physics-constants.json`; o `requestAnimationFrame` apenas alimenta o acumulador e interpola a renderização entre os dois últimos ticks.
- O oval técnico temporário permite validar asfalto, grama, bordas, colisão entre carros, marcas de pneu e dano mecânico determinístico. As geometrias das 24 pistas entram na Parte 2b.
- Solo cria dois bots determinísticos. No modo local, o jogador 1 usa WASD e Shift esquerdo, enquanto o jogador 2 usa setas e Shift direito. Em solo, WASD e setas controlam o mesmo carro.
- Shift alterna o acerto normal/drift durante a corrida e não funciona como freio de mão. Conforme o contrato v1.1, dano de motor reduz desempenho, dano de direção reduz esterço e perda total desativa os controles; o Módulo 5 acrescenta reparo em pits e o polimento visual completo.
- A corrida técnica tem uma volta e limite de 60 segundos. Ao terminar, o frontend envia a classificação autenticada para `POST /api/races/local-result`.

O identificador `albert-park` é usado provisoriamente para vincular o oval técnico ao catálogo `2026.1` no envio do resultado. A Parte 2b substituirá somente a geometria temporária pela definição oficial carregada da API.

## Roadmap

Os Módulos 0–9 formam o MVP planejado. A expansão pós-MVP aprovada está registrada nos Módulos 10–16: progressão e carros por conquista, contrarrelógio com fantasmas, controles personalizáveis, espectadores, equipes, torneios automáticos e conduta esportiva. O escopo, as dependências e os critérios de pronto ficam em [`docs/frontend-implementation-plan.md`](docs/frontend-implementation-plan.md); o estado corrente de cada módulo fica em [`AGENTS.md`](AGENTS.md).

A direção visual aprovada, incluindo paleta, tipografia, câmera dinâmica, escala métrica, veículos, circuitos, HUD e composição das telas, está em [`docs/game-design-guide.md`](docs/game-design-guide.md). A documentação não antecipa funcionalidades: a fundação visual global já foi aplicada numa rodada isolada e cada decisão específica continua entrando somente no módulo responsável. Os fluxos e o status funcional do Módulo 1 foram preservados.

A preparação técnica do Módulo 2 está em [`docs/contracts/module-2-shared-contracts.md`](docs/contracts/module-2-shared-contracts.md) e [`contracts/module-2/v1/`](contracts/module-2/v1/): catálogo `2026.1`, schemas métricos e constantes físicas compartilhadas. A Parte 2a já consome as constantes diretamente; as geometrias completas pertencem ao backend e serão carregadas por API na Parte 2b.

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
