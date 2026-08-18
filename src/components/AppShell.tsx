import { House, LogIn, LogOut, UserRound } from 'lucide-react'
import type { PropsWithChildren } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/auth-context'
import { Brand } from '@/components/Brand'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const navItemClass =
  'group inline-flex h-10 items-center justify-center gap-3 rounded-[10px] border border-transparent px-3 text-sm font-bold text-muted-foreground transition hover:border-border hover:bg-muted/70 hover:text-foreground lg:w-full lg:justify-start'

type AppShellProps = PropsWithChildren<{
  moduleLabel?: string
}>

export function AppShell({ children, moduleLabel = 'Módulo 01' }: AppShellProps) {
  const { account, isUser, signOut } = useAuth()
  const navigate = useNavigate()

  function handleSignOut() {
    signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="relative min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <div className="racing-grid pointer-events-none fixed inset-0 opacity-60" />
      <div className="speed-lines pointer-events-none fixed inset-0 opacity-45" />

      <aside className="relative z-20 flex h-20 items-center justify-between border-b border-border/80 bg-background/90 px-5 backdrop-blur-xl lg:sticky lg:top-0 lg:h-screen lg:flex-col lg:items-stretch lg:border-b-0 lg:border-r lg:px-6 lg:py-7">
        <Link className="shrink-0" to="/">
          <Brand tagline="Race control" />
        </Link>

        <nav
          aria-label="Navegação principal"
          className="flex items-center gap-1 lg:mt-12 lg:w-full lg:flex-1 lg:flex-col lg:items-stretch"
        >
          <NavLink
            className={({ isActive }) =>
              cn(
                navItemClass,
                isActive &&
                  'border-primary/30 bg-primary/10 text-foreground shadow-[inset_3px_0_0_var(--primary)]',
              )
            }
            end
            to="/"
          >
            <House aria-hidden="true" className="size-4 text-primary" />
            <span className="hidden lg:inline">Início</span>
          </NavLink>

          {isUser ? (
            <>
              <NavLink
                className={({ isActive }) =>
                  cn(
                    navItemClass,
                    isActive &&
                      'border-primary/30 bg-primary/10 text-foreground shadow-[inset_3px_0_0_var(--primary)]',
                  )
                }
                to="/account"
              >
                <UserRound aria-hidden="true" className="size-4 text-primary" />
                <span className="hidden lg:inline">Minha conta</span>
              </NavLink>

              <button
                className={cn(navItemClass, 'lg:mt-auto')}
                onClick={handleSignOut}
                type="button"
              >
                <LogOut aria-hidden="true" className="size-4" />
                <span className="hidden lg:inline">Sair</span>
              </button>
            </>
          ) : (
            <Button asChild className="ml-1 lg:mt-auto lg:ml-0" size="sm">
              <Link to="/login">
                <LogIn aria-hidden="true" className="size-4" />
                <span className="hidden sm:inline">Entrar</span>
              </Link>
            </Button>
          )}
        </nav>

        <div className="hidden border-t border-border/70 pt-5 lg:block">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-success shadow-[0_0_12px_var(--success)]" />
            Base de pilotos ativa
          </div>
          <p className="mt-2 truncate text-sm font-semibold text-foreground">
            {isUser ? `@${account?.gamertag ?? 'piloto'}` : 'Sessão visitante'}
          </p>
        </div>
      </aside>

      <div className="relative z-10 min-w-0">
        <header className="hidden h-[72px] items-center justify-between border-b border-border/60 px-8 lg:flex xl:px-12">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            Paddock digital <span className="mx-2 text-border">/</span>{' '}
            <span className="text-info">{moduleLabel}</span>
          </p>
          <p className="text-xs font-semibold text-muted-foreground">
            {isUser ? `@${account?.gamertag ?? 'piloto'}` : 'Acesso guest'}
          </p>
        </header>

        <main className="mx-auto w-full max-w-[1400px] px-5 py-10 sm:px-8 sm:py-14 lg:px-10 xl:px-14">
          {children}
        </main>
      </div>
    </div>
  )
}
