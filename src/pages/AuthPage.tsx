import { Flag, ShieldCheck } from 'lucide-react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/auth-context'
import { AuthForm } from '@/components/AuthForm'

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
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-5 py-10 text-foreground">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,oklch(0.79_0.17_126/0.14),transparent_36%),radial-gradient(circle_at_bottom_right,oklch(0.67_0.16_245/0.1),transparent_30%)]" />
      <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(oklch(1_0_0/0.04)_1px,transparent_1px),linear-gradient(90deg,oklch(1_0_0/0.04)_1px,transparent_1px)] [background-size:48px_48px]" />

      <section className="relative grid w-full max-w-5xl overflow-hidden rounded-3xl border border-border bg-card/80 shadow-2xl shadow-black/30 backdrop-blur md:grid-cols-[0.9fr_1.1fr]">
        <div className="flex flex-col justify-between border-b border-border bg-muted/25 p-7 md:border-b-0 md:border-r md:p-10">
          <Link className="flex items-center gap-3" to="/">
            <span className="grid size-10 place-items-center rounded-lg border border-primary/40 bg-primary/10 text-primary">
              <Flag aria-hidden="true" className="size-5" />
            </span>
            <p className="text-sm font-black uppercase tracking-[0.24em] text-primary">
              Never Lift
            </p>
          </Link>

          <div className="my-10">
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-primary">
              Módulo de pilotos
            </p>
            <h1 className="text-3xl font-black tracking-[-0.04em] sm:text-5xl">
              {isRegister ? 'Crie sua identidade.' : 'Volte para a pista.'}
            </h1>
            <p className="mt-5 max-w-sm leading-7 text-muted-foreground">
              {isRegister
                ? 'Escolha seu gamertag, um avatar original e prepare-se para os próximos modos do Never Lift.'
                : 'Entre com sua conta para acessar perfil e, em breve, disputar corridas online.'}
            </p>
          </div>

          <div className="flex items-start gap-3 text-sm text-muted-foreground">
            <ShieldCheck
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-primary"
            />
            <p>
              Sua sessão fica apenas na memória deste navegador e desaparece ao
              fechar ou recarregar a página.
            </p>
          </div>
        </div>

        <div className="p-7 md:p-10">
          <div className="mb-7">
            <p className="text-2xl font-bold">
              {isRegister ? 'Criar conta' : 'Entrar'}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {isRegister ? 'Já tem uma conta? ' : 'Ainda não tem uma conta? '}
              <Link
                className="font-bold text-primary hover:underline"
                to={isRegister ? '/login' : '/register'}
              >
                {isRegister ? 'Faça login' : 'Cadastre-se'}
              </Link>
            </p>
          </div>

          {state?.message && (
            <p
              className="mb-5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-primary"
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
