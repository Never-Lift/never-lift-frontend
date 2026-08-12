import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import { App } from '@/App'
import { AuthProvider } from '@/auth/AuthContext'

export function renderApp(route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  )
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const userAccount = {
  id: 'd42a153a-234b-4655-a36c-04075687c5fb',
  gamertag: 'turbo_fox',
  displayName: 'Turbo Fox',
  avatarId: 'rookie-pilot',
  preferredLanguage: 'pt-BR',
  createdAt: '2026-08-12T12:00:00Z',
}
