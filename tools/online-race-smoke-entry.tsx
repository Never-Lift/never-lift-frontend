// Test-only entry; never imported by the production application.
import { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { App } from '@/App'
import { AuthProvider } from '@/auth/AuthContext'
import { useAuth } from '@/auth/auth-context'
import '@fontsource/barlow/latin-400.css'
import '@fontsource/barlow/latin-700.css'
import '@fontsource/barlow-condensed/latin-900-italic.css'
import '@/index.css'

declare global {
  interface Window { onlineSmokeLogin: { gamertag: string; password: string; code: string } }
}
export function AuthenticatedApp() {
  const auth = useAuth()
  const started = useRef(false)
  useEffect(() => {
    if (!started.current) {
      started.current = true
      const { gamertag, password } = window.onlineSmokeLogin
      void auth.login({ gamertag, password })
    }
  }, [auth])
  return auth.account ? <App /> : <p>Autenticando teste local…</p>
}
createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={['/race/lobby/' + window.onlineSmokeLogin.code]}>
    <AuthProvider><AuthenticatedApp /></AuthProvider>
  </MemoryRouter>,
)
