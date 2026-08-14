import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/auth-context'
import { AuthForm } from '@/components/AuthForm'
import { Brand } from '@/components/Brand'

type LocationState = {
  from?: string
  message?: string
}

type AuthPageProps = {
  mode: 'login' | 'register'
}

export function AuthPage({ mode }: AuthPageProps) {
  const { isUser, login, register } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const state = location.state as LocationState | null
  const isRegister = mode === 'register'

  if (isUser) return <Navigate replace to="/" />

  async function handleLogin(values: {
    gamertag: string
    password: string
  }) {
    await login(values)
    navigate('/', { replace: true })
  }

  async function handleRegister(values: {
    gamertag: string
    displayName: string
    password: string
    avatarId?: string
  }) {
    await register(values)
    navigate('/', { replace: true })
  }

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-4 py-6 text-foreground sm:px-6 sm:py-10">
      <div className="racing-grid pointer-events-none absolute inset-0 opacity-75" />
      <div className="speed-lines pointer-events-none absolute inset-0 opacity-60" />
      <div className="pointer-events-none absolute -left-24 top-1/4 size-80 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 size-72 rounded-full bg-accent/8 blur-3xl" />

      <section className="relative grid w-full max-w-6xl overflow-hidden rounded-2xl border border-border bg-card/95 shadow-[0_35px_100px_rgb(0_0_0/0.45)] lg:grid-cols-[0.92fr_1.08fr]">
        <div className="relative flex min-h-[24rem] flex-col justify-between overflow-hidden border-b border-border bg-[linear-gradient(145deg,rgb(17_30_52/0.98),rgb(7_11_20/0.98))] p-7 sm:p-10 lg:min-h-[44rem] lg:border-b-0 lg:border-r lg:p-12">
          <div className="pointer-events-none absolute -right-28 top-1/3 size-64 rotate-45 border border-primary/15" />
          <div className="pointer-events-none absolute -right-20 top-1/3 size-64 rotate-45 border border-primary/8" />
          <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-primary via-info to-accent" />

          <Link
            aria-label="Voltar ao menu"
            className="relative inline-flex w-fit items-center gap-4"
            to="/"
          >
            <Brand tagline="Driver access" />
          </Link>

          <div className="relative my-12 lg:my-16">
            <p className="mb-5 text-[11px] font-extrabold uppercase tracking-[0.24em] text-info">
              Identidade // 01
            </p>
            <h1 className="display-heading max-w-md text-5xl sm:text-7xl">
              {isRegister ? 'Crie sua identidade.' : 'Volte para a pista.'}
            </h1>
            <p className="mt-6 max-w-sm text-sm leading-7 text-muted-foreground sm:text-base">
              {isRegister
                ? 'Escolha seu gamertag, um avatar original e prepare-se para os próximos modos do Never Lift.'
                : 'Entre com sua conta para acessar perfil e, em breve, disputar corridas online.'}
            </p>
          </div>

          <div className="relative flex items-start gap-3 border-t border-border/70 pt-5 text-sm text-muted-foreground">
            <ShieldCheck
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-success"
            />
            <p>
              Sua sessão fica apenas na memória deste navegador e desaparece ao
              fechar ou recarregar a página.
            </p>
          </div>
        </div>

        <div className="relative flex flex-col justify-center p-7 sm:p-10 lg:p-12 xl:p-16">
          <Link
            className="mb-10 inline-flex w-fit items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.16em] text-muted-foreground transition hover:text-primary"
            to="/"
          >
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            Voltar ao paddock
          </Link>

          <div className="mb-8 flex items-end justify-between gap-5 border-b border-border/70 pb-6">
            <div>
              <p className="font-display text-3xl font-extrabold uppercase tracking-[-0.02em]">
                {isRegister ? 'Criar conta' : 'Entrar'}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {isRegister ? 'Já tem uma conta? ' : 'Ainda não tem uma conta? '}
                <Link
                  className="font-bold text-primary transition hover:text-info"
                  to={isRegister ? '/login' : '/register'}
                >
                  {isRegister ? 'Faça login' : 'Cadastre-se'}
                </Link>
              </p>
            </div>
            <span className="hidden font-display text-5xl font-black italic text-border/55 sm:block">
              {isRegister ? 'UP' : 'IN'}
            </span>
          </div>

          {state?.message && (
            <p
              className="mb-5 rounded-[10px] border border-info/35 bg-info/8 px-3.5 py-3 text-sm font-medium text-info"
              role="status"
            >
              {state.message}
            </p>
          )}

          {isRegister ? (
            <AuthForm mode="register" onSubmit={handleRegister} />
          ) : (
            <AuthForm mode="login" onSubmit={handleLogin} />
          )}
        </div>
      </section>
    </main>
  )
}
