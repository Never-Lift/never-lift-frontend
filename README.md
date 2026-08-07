# Never Lift

Cliente web (React + TypeScript) do Never Lift — telas de conta/social/campeonato/recordes e o motor de corrida renderizado em Canvas.

Este é um **jogo novo**. Existe um protótipo anterior que serve só como referência visual e de sensação de jogo, não como código a reaproveitar diretamente.

## Stack

- TypeScript + Vite
- React + Tailwind CSS + shadcn/ui
- Canvas 2D nativo para o motor de corrida (dentro de um componente React)
- Deploy: Vercel ou Cloudflare Pages, tier free

## Documentação

- [`docs/plano-implementacao-frontend.md`](docs/plano-implementacao-frontend.md) — arquitetura completa, protocolo de tempo real, mapa de rotas e todos os módulos. Leia antes de começar qualquer módulo.
- [`AGENTS.md`](AGENTS.md) — resumo de convenções pro Codex (e pra qualquer humano entrando no projeto).

## Rodando localmente

Pré-requisitos: Node.js 20+.

```bash
cp .env.example .env   # preencher VITE_API_URL e VITE_WS_URL
npm install
npm run dev
```

## Variáveis de ambiente

| Nome | Descrição |
|---|---|
| `VITE_API_URL` | URL base do backend REST (ex.: `http://localhost:8080/api`) |
| `VITE_WS_URL` | URL do WebSocket do backend (ex.: `ws://localhost:8080/ws`) |

## Testes

```bash
npm run test
```

Nenhum módulo do plano de implementação é considerado pronto sem testes automatizados (componente, e no Módulo 3 um teste com dois clientes simulados) — ver seção 5 do plano.

## Estrutura sugerida

```
src/
  engine/         # RaceEngine — física (Módulo 2), predição/reconciliação/interpolação (Módulo 3)
  realtime/       # cliente WebSocket
  components/     # UI reutilizável (shadcn/ui como base)
  routes/         # telas do mapa de rotas (Módulos 0-9)
```

## Deploy

Push na branch principal aciona build + deploy automático (Vercel/Cloudflare Pages). Sem servidor rodando, sem hibernação — só CDN.
