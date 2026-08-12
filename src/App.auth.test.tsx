import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { jsonResponse, renderApp, userAccount } from '@/test/render-app'

describe('Module 1 authentication flows', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://localhost:8080/api')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('automatically creates a guest session when the menu opens', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ token: 'guest.jwt', role: 'guest', subject: 'guest-id' }),
      )
    vi.stubGlobal('fetch', fetchMock)

    renderApp('/')

    expect(await screen.findByText('Sessão guest ativa')).toBeInTheDocument()
    expect(screen.getByText('Piloto visitante')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/api/auth/guest',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('logs in and returns to the main menu', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ token: 'user.jwt', role: 'user', subject: userAccount.id }),
      )
      .mockResolvedValueOnce(jsonResponse(userAccount))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderApp('/login')
    await user.type(screen.getByLabelText('Gamertag'), 'turbo_fox')
    await user.type(screen.getByLabelText('Senha'), 'fast123')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(await screen.findByText('Piloto autenticado')).toBeInTheDocument()
    expect(screen.getByText('Turbo Fox')).toBeInTheDocument()
  })

  it('registers with an optional avatar and returns to the main menu', async () => {
    const accountWithoutAvatar = { ...userAccount, avatarId: null }
    const accountWithAvatar = { ...userAccount, avatarId: 'pit-mechanic' }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ token: 'user.jwt', role: 'user', subject: userAccount.id }),
      )
      .mockResolvedValueOnce(jsonResponse(accountWithoutAvatar))
      .mockResolvedValueOnce(jsonResponse(accountWithAvatar))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderApp('/register')
    await user.type(screen.getByLabelText('Gamertag'), 'turbo_fox')
    await user.type(screen.getByLabelText('Nome de exibição'), 'Turbo Fox')
    await user.type(screen.getByLabelText('Senha'), 'fast123')
    await user.click(screen.getByRole('radio', { name: 'Mecânico de box' }))
    await user.click(screen.getByRole('button', { name: 'Criar conta' }))

    expect(await screen.findByText('Piloto autenticado')).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: 'Mecânico de box' }),
    ).toBeInTheDocument()
  })

  it('shows a login error without leaving the form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          { code: 'invalid_credentials', message: 'Invalid credentials' },
          401,
        ),
      ),
    )
    const user = userEvent.setup()

    renderApp('/login')
    await user.type(screen.getByLabelText('Gamertag'), 'turbo_fox')
    await user.type(screen.getByLabelText('Senha'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Gamertag ou senha inválidos.',
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled(),
    )
  })
})
