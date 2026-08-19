import {
  ArrowRight,
  Flag,
  LoaderCircle,
  LockKeyhole,
  Radio,
  UserPlus,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '@/auth/auth-context'
import { AppShell } from '@/components/AppShell'
import { Button } from '@/components/ui/button'
import { getAvatar } from '@/lib/avatars'
import { getErrorMessage } from '@/lib/error-messages'

export function HomePage() {
  const { account, isUser, session, startGuestSession } = useAuth()
  const requestedGuest = useRef(false)
  const [guestError, setGuestError] = useState<string | null>(null)

  const requestGuestSession = useCallback(() => {
    requestedGuest.current = true
    setGuestError(null)
    startGuestSession().catch((error: unknown) => {
      requestedGuest.current = false
      setGuestError(getErrorMessage(error))
    })
  }, [startGuestSession])

  useEffect(() => {
    if (session || requestedGuest.current) return

    requestGuestSession()
  }, [requestGuestSession, session])

  const avatar = getAvatar(account?.avatarId)

  return (
    <AppShell>
      <section className="grid min-h-[calc(100vh-10rem)] items-center gap-12 lg:grid-cols-[minmax(0,1.12fr)_minmax(21rem,0.72fr)] xl:gap-20">
        <div className="relative">
          <div className="absolute -left-8 top-0 hidden h-full w-px bg-gradient-to-b from-primary via-primary/25 to-transparent xl:block" />

          <div className="mb-6 flex items-center gap-3 text-[11px] font-extrabold uppercase tracking-[0.24em] text-info">
            <Radio aria-hidden="true" className="size-4" />
            Menu principal
            <span className="h-px w-12 bg-info/35" />
          </div>

          <h1 className="display-heading max-w-4xl text-[clamp(4rem,9vw,8.5rem)]">
            Corra no limite.
            <span className="block text-primary">Nunca alivie.</span>
          </h1>

          <p className="mt-7 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            O seu paddock para corridas 2D multiplayer. Configure sua identidade
            agora; os modos de corrida chegam nos próximos módulos.
          </p>

          <div className="mt-9 flex flex-wrap gap-3">
            {isUser ? (
              <Button asChild size="lg">
                <Link to="/account">
                  Editar minha conta
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              </Button>
            ) : (
              <>
                <Button asChild size="lg">
                  <Link to="/register">
                    <UserPlus aria-hidden="true" className="size-4" />
                    Criar conta
                  </Link>
                </Button>
                <Button asChild size="lg" variant="secondary">
                  <Link to="/login">Já tenho conta</Link>
                </Button>
              </>
            )}
          </div>

          <div className="mt-12 flex flex-wrap gap-x-8 gap-y-3 border-t border-border/65 pt-5 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            <span>Top-down 2D</span>
            <span className="text-border">/</span>
            <span>Drift controlado</span>
            <span className="text-border">/</span>
            <span>Multiplayer autoritativo</span>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="surface-panel relative overflow-hidden p-6 sm:p-7">
            <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-primary via-info to-accent" />
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-muted-foreground">
                  Session // 01
                </p>
                <p className="mt-1 text-sm font-bold text-foreground">
                  Identidade do piloto
                </p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background/55 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                <span
                  className={
                    guestError
                      ? 'size-1.5 rounded-full bg-destructive'
                      : 'size-1.5 rounded-full bg-success shadow-[0_0_10px_var(--success)]'
                  }
                />
                {guestError ? 'Offline' : 'Ativa'}
              </span>
            </div>

            {!session && !guestError && (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-background/45 p-4 text-sm">
                <LoaderCircle
                  aria-hidden="true"
                  className="size-5 animate-spin text-primary"
                />
                Preparando sessão guest…
              </div>
            )}

            {guestError && (
              <div className="rounded-xl border border-destructive/35 bg-destructive/8 p-4">
                <p className="font-bold text-destructive">Guest indisponível</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {guestError}
                </p>
                <Button
                  className="mt-5"
                  onClick={requestGuestSession}
                  size="sm"
                  variant="secondary"
                >
                  Tentar novamente
                </Button>
              </div>
            )}

            {session && (
              <>
                <div className="flex items-center gap-4">
                  <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-[14px] border border-primary/35 bg-primary/10 shadow-[0_0_36px_rgb(45_125_255/0.12)]">
                    {avatar ? (
                      <img
                        alt={avatar.name}
                        className="size-full object-cover"
                        src={avatar.image}
                      />
                    ) : (
                      <Flag aria-hidden="true" className="size-7 text-primary" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-info">
                      {isUser ? 'Piloto autenticado' : 'Sessão guest ativa'}
                    </p>
                    <p className="mt-1 truncate text-2xl font-extrabold">
                      {account?.displayName ?? 'Piloto visitante'}
                    </p>
                    {account && (
                      <p className="mt-0.5 truncate text-sm font-medium text-muted-foreground">
                        @{account.gamertag}
                      </p>
                    )}
                  </div>
                </div>

                {!isUser && (
                  <div className="mt-6 flex gap-3 rounded-xl border border-border bg-background/45 p-4">
                    <LockKeyhole
                      aria-hidden="true"
                      className="mt-0.5 size-5 shrink-0 text-warning"
                    />
                    <p className="text-sm leading-6 text-muted-foreground">
                      Você pode explorar como guest. Qualquer modo online será
                      bloqueado até que faça login.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="rounded-2xl border border-border/80 bg-card/55 p-5">
            <div className="flex items-start gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-[10px] border border-accent/30 bg-accent/10 text-accent">
                <Zap aria-hidden="true" className="size-4" />
              </span>
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-muted-foreground">
                  Próxima etapa
                </p>
                <p className="mt-1 font-bold">Motor de corrida local</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  O laboratório da Parte 2a está disponível com oval técnico,
                  bots e dois jogadores no mesmo teclado.
                </p>
                <Button asChild className="mt-4" size="sm" variant="secondary">
                  <Link to="/race">Abrir laboratório</Link>
                </Button>
              </div>
            </div>
          </div>
        </aside>
      </section>
    </AppShell>
  )
}
