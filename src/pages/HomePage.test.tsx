import { cleanup, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { jsonResponse, renderApp } from '@/test/render-app'

describe('main menu', () => {
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

  it('prioritizes the available local race without exposing roadmap copy', async () => {
    renderApp('/')

    expect(await screen.findByText('Sessão guest ativa')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Jogar agora/ })).toHaveAttribute(
      'href',
      '/race',
    )
    expect(screen.getByRole('link', { name: 'Jogar' })).toHaveAttribute(
      'href',
      '/race',
    )
    expect(screen.getByText('Pronto para largar')).toBeInTheDocument()
    expect(screen.queryByText(/próximos módulos/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Próxima etapa/i)).not.toBeInTheDocument()
  })
})
