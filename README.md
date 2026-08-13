# Never Lift

Frontend web do Never Lift, um jogo de corrida 2D multiplayer top-down com foco em drift. Este repositório contém as telas do aplicativo e, nos próximos módulos, o motor de corrida renderizado em Canvas.

## Fundação técnica

- React 19 + TypeScript strict + Vite.
- Tailwind CSS 4 pelo plugin oficial do Vite.
- shadcn/ui configurado em `components.json`, com aliases `@/*`, variáveis CSS e utilitário `cn` prontos para receber componentes.
- Vitest + Testing Library para testes de componentes.
- Oxlint para análise estática.
- GitHub Actions para lint, testes e build em pull requests e nas branches protegidas.

## Módulo 1 — usuários e autenticação

- `/` abre o menu principal e cria automaticamente uma sessão guest.
- `/login` e `/register` autenticam o piloto; o cadastro aceita um dos oito avatares chibi originais do Never Lift.
- `/account` permite trocar nome, avatar ou senha mediante confirmação da senha atual e excluir a conta por meio de um `AlertDialog` irreversível.
- O backend atual devolve JWT no corpo. O frontend guarda esse token somente no estado em memória e o envia como `Authorization: Bearer`; nada é escrito em `localStorage` ou `sessionStorage`.
- Rotas online futuras devem ser aninhadas sob o componente `OnlineRoute`, que direciona guest e visitante para `/login` com uma mensagem explicativa.

Como a sessão fica exclusivamente em memória, recarregar a página remove o login atual e, ao voltar para `/`, uma nova sessão guest é criada. Esse comportamento é intencional enquanto o backend não adotar cookie `httpOnly`.

## Roadmap

Os Módulos 0–9 formam o MVP planejado. A expansão pós-MVP aprovada está registrada nos Módulos 10–16: progressão e carros por conquista, contrarrelógio com fantasmas, controles personalizáveis, espectadores, equipes, torneios automáticos e conduta esportiva. O escopo, as dependências e os critérios de pronto ficam em [`docs/frontend-implementation-plan.md`](docs/frontend-implementation-plan.md); o estado corrente de cada módulo fica em [`AGENTS.md`](AGENTS.md).

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
  pages/        # menu, login, cadastro e conta
  test/         # configuração global dos testes
```

Consulte `docs/frontend-implementation-plan.md` para a arquitetura e os módulos planejados, e `AGENTS.md` para as regras de contribuição.
