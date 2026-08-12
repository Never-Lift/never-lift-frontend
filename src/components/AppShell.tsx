import { Flag, Gauge, LogOut, UserRound } from 'lucide-react'
import type { PropsWithChildren } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/auth-context'
import { Button } from '@/components/ui/button'

export function AppShell({ children }: PropsWithChildren) {
  const { isUser, signOut } = useAuth()
  const navigate = useNavigate()

  function handleSignOut() {
    signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,oklch(0.79_0.17_126/0.1),transparent_32%),radial-gradient(circle_at_bottom_right,oklch(0.67_0.16_245/0.08),transparent_28%)]" />
      <div className="pointer-events-none fixed inset-0 opacity-20 [background-image:linear-gradient(oklch(1_0_0/0.04)_1px,transparent_1px),linear-gradient(90deg,oklch(1_0_0/0.04)_1px,transparent_1px)] [background-size:48px_48px]" />

      <header className="relative z-10 border-b border-border/70 bg-background/75 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link className="flex items-center gap-3" to="/">
            <span className="grid size-9 place-items-center rounded-lg border border-primary/40 bg-primary/10 text-primary">
              <Flag aria-hidden="true" className="size-4" />
            </span>
            <div>
              <p className="text-sm font-black uppercase tracking-[0.22em] text-primary">
                Never Lift
              </p>
              <p className="hidden text-[11px] text-muted-foreground sm:block">
                Sua corrida começa aqui
              </p>
            </div>
          </Link>

          <nav className="flex items-center gap-1" aria-label="Navegação principal">
            {isUser ? (
              <>
                <Button asChild size="sm" variant="ghost">
                  <Link to="/account">
                    <UserRound aria-hidden="true" className="size-4" />
                    <span className="hidden sm:inline">Minha conta</span>
                  </Link>
                </Button>
                <Button onClick={handleSignOut} size="sm" variant="ghost">
                  <LogOut aria-hidden="true" className="size-4" />
                  <span className="hidden sm:inline">Sair</span>
                </Button>
              </>
            ) : (
              <Button asChild size="sm" variant="secondary">
                <Link to="/login">
                  <Gauge aria-hidden="true" className="size-4" />
                  Entrar
                </Link>
              </Button>
            )}
          </nav>
        </div>
      </header>

      <main className="relative z-0 mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        {children}
      </main>
    </div>
  )
}
