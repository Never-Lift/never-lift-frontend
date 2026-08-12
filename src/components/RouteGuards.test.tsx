import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import {
  AuthContext,
  emptyAuthValue,
  type AuthContextValue,
} from '@/auth/auth-context'
import { OnlineRoute } from '@/components/RouteGuards'

function authValue(role: 'guest' | 'user'): AuthContextValue {
  return {
    ...emptyAuthValue,
    session: { role, token: `${role}.jwt` },
    isGuest: role === 'guest',
    isUser: role === 'user',
  }
}

function renderGuard(role: 'guest' | 'user') {
  return render(
    <MemoryRouter initialEntries={['/online']}>
      <AuthContext.Provider value={authValue(role)}>
        <Routes>
          <Route element={<OnlineRoute />}>
            <Route element={<p>Corrida online liberada</p>} path="/online" />
          </Route>
          <Route
            element={
              <p>
                Login necessário: Faça login para liberar os modos online.
              </p>
            }
            path="/login"
          />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

describe('OnlineRoute', () => {
  afterEach(cleanup)

  it('redirects a guest to login', async () => {
    renderGuard('guest')
    expect(
      await screen.findByText(/Faça login para liberar os modos online/),
    ).toBeInTheDocument()
    expect(screen.queryByText('Corrida online liberada')).not.toBeInTheDocument()
  })

  it('allows authenticated users', () => {
    renderGuard('user')
    expect(screen.getByText('Corrida online liberada')).toBeInTheDocument()
  })
})
