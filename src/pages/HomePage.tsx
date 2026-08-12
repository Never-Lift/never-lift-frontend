import { Flag, LoaderCircle, LockKeyhole, Radio, UserPlus } from 'lucide-react'
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
      <section className="grid items-center gap-10 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <div className="mb-5 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-primary">
            <Radio aria-hidden="true" className="size-4" />
            Menu principal
          </div>
          <h1 className="max-w-3xl text-5xl font-black tracking-[-0.055em] sm:text-7xl">
            Corra no limite. Nunca alivie.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-muted-foreground sm:text-lg">
            O seu paddock para corridas 2D multiplayer. Configure sua identidade
            agora; os modos de corrida chegam nos próximos módulos.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            {isUser ? (
              <Button asChild size="lg">
                <Link to="/account">Editar minha conta</Link>
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
        </div>

        <aside className="rounded-3xl border border-border bg-card/80 p-6 shadow-2xl shadow-black/20 backdrop-blur sm:p-8">
          {!session && !guestError && (
            <div className="flex items-center gap-3 text-sm">
              <LoaderCircle
                aria-hidden="true"
                className="size-5 animate-spin text-primary"
              />
              Preparando sessão guest…
            </div>
          )}

          {guestError && (
            <div>
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
                <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-primary/30 bg-primary/10">
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
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    {isUser ? 'Piloto autenticado' : 'Sessão guest ativa'}
                  </p>
                  <p className="mt-1 text-xl font-black">
                    {account?.displayName ?? 'Piloto visitante'}
                  </p>
                  {account && (
                    <p className="text-sm text-muted-foreground">
                      @{account.gamertag}
                    </p>
                  )}
                </div>
              </div>

              {!isUser && (
                <div className="mt-6 flex gap-3 rounded-xl border border-border bg-muted/35 p-4">
                  <LockKeyhole
                    aria-hidden="true"
                    className="mt-0.5 size-5 shrink-0 text-primary"
                  />
                  <p className="text-sm leading-6 text-muted-foreground">
                    Você pode explorar como guest. Qualquer modo online será
                    bloqueado até que faça login.
                  </p>
                </div>
              )}
            </>
          )}
        </aside>
      </section>
    </AppShell>
  )
}
