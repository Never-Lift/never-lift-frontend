import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { AuthContext, type AuthContextValue } from '@/auth/auth-context'
import { AppShell } from '@/components/AppShell'
import type { RoomSummary } from '@/lib/api'
import { onlineRoomSession } from '@/online/OnlineRoomSession'

const room: RoomSummary = {
  code: '1234',
  name: 'Sala ativa',
  hostId: 'guest-1',
  trackId: 'albert-park',
  trackCatalogVersion: '2026.12',
  physicsContractVersion: '2.0.3',
  participantCount: 1,
  limit: 22,
  state: 'lobby',
  settingsLocked: false,
}

const auth: AuthContextValue = {
  session: { role: 'guest', token: 'guest.jwt', subject: 'guest-1' },
  account: null,
  isGuest: true,
  isUser: false,
  startGuestSession: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  loadAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  signOut: vi.fn(),
}

const userAuth: AuthContextValue = {
  ...auth,
  session: { role: 'user', token: 'user.jwt', subject: 'user-1' },
  account: {
    id: 'user-1',
    displayName: 'Turbo Fox',
    gamertag: 'turbo_fox',
    avatarId: 'rookie-pilot',
    preferredLanguage: 'pt-BR',
    createdAt: '2026-08-01T00:00:00Z',
  },
  isGuest: false,
  isUser: true,
}

describe('AppShell online navigation', () => {
  afterEach(() => {
    onlineRoomSession.resetForTests()
    cleanup()
  })

  it('marks Online instead of Jogar and keeps the active room as its destination', async () => {
    onlineRoomSession.setRoom(room)
    render(
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={['/race/lobby/1234']}>
          <Routes>
            <Route element={<AppShell><p>Lobby</p></AppShell>} path="/race/lobby/:roomCode" />
            <Route element={<AppShell><p>Início</p></AppShell>} path="/" />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    )

    expect(screen.getByRole('link', { name: 'Jogar' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Online' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Online' })).toHaveAttribute(
      'href',
      '/race/lobby/1234',
    )

    await userEvent.click(screen.getByRole('link', { name: 'Início' }))
    expect(await screen.findAllByText('Início')).not.toHaveLength(0)
    expect(onlineRoomSession.getSnapshot().roomCode).toBe('1234')
  })

  it('moves the signed-in account to the top-right identity card', () => {
    render(
      <AuthContext.Provider value={userAuth}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route
              element={<AppShell moduleLabel="Início"><p>Conteúdo</p></AppShell>}
              path="/"
            />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    )

    expect(screen.queryByText('Race control')).not.toBeInTheDocument()
    expect(screen.getByText('@turbo_fox')).toHaveClass('text-muted-foreground')
    expect(screen.getByText('Turbo Fox')).toHaveClass('text-foreground')
    expect(screen.getAllByRole('link', { name: 'Minha conta' })).toHaveLength(2)
    expect(screen.getByText('Início', { selector: 'span.text-info' })).toBeInTheDocument()
  })
})
