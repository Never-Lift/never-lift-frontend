import { Activity, Flag, Gauge } from 'lucide-react'

import { BackendDiagnostic } from '@/components/BackendDiagnostic'

export function App() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 py-12 text-foreground">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,oklch(0.79_0.17_126/0.12),transparent_34%),radial-gradient(circle_at_bottom_right,oklch(0.67_0.16_245/0.1),transparent_30%)]" />
      <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(oklch(1_0_0/0.04)_1px,transparent_1px),linear-gradient(90deg,oklch(1_0_0/0.04)_1px,transparent_1px)] [background-size:48px_48px]" />

      <section className="relative w-full max-w-3xl">
        <header className="mb-10 flex items-center justify-between border-b border-border/70 pb-5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-lg border border-primary/40 bg-primary/10 text-primary">
              <Flag aria-hidden="true" className="size-5" />
            </span>
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-primary">
                Never Lift
              </p>
              <p className="text-xs text-muted-foreground">Frontend · Módulo 0</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
            <Gauge aria-hidden="true" className="size-4" />
            Fundação e deploy
          </div>
        </header>

        <div className="grid gap-8 md:grid-cols-[1.15fr_0.85fr] md:items-end">
          <div>
            <div className="mb-4 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              <Activity aria-hidden="true" className="size-4 text-primary" />
              Diagnóstico de integração
            </div>
            <h1 className="max-w-xl text-4xl font-black tracking-[-0.04em] sm:text-6xl">
              Frontend pronto para a largada.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">
              Esta tela confirma a comunicação entre o cliente web e a API do
              Never Lift antes da implementação das funcionalidades do jogo.
            </p>
          </div>

          <BackendDiagnostic />
        </div>
      </section>
    </main>
  )
}
