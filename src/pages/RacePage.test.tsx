import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { jsonResponse, renderApp } from '@/test/render-app'

describe('Module 2a race setup', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://localhost:8080/api')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ token: 'guest.jwt', role: 'guest', subject: 'guest-id' }),
      ),
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('prepares a guest session and exposes solo configuration', async () => {
    renderApp('/race')

    expect(await screen.findByRole('button', { name: /Largar/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Solo contra bots/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText('Dificuldade dos bots')).toBeInTheDocument()
  })

  it('switches to two players and exposes the second car selection', async () => {
    const user = userEvent.setup()
    renderApp('/race')
    await screen.findByRole('button', { name: /Largar/ })
    await user.click(screen.getByRole('button', { name: /Dois jogadores locais/ }))

    expect(screen.getByText('Jogador 2')).toBeInTheDocument()
    expect(screen.queryByText('Dificuldade dos bots')).not.toBeInTheDocument()
  })
})
