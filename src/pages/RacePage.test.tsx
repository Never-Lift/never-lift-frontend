import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import trackCatalog from '../../contracts/module-2/v1/catalog.json'
import { jsonResponse, renderApp } from '@/test/render-app'
import { SHORT_TRACK } from '@/test/track-fixtures'

const albertParkDefinition = {
  ...SHORT_TRACK,
  id: 'albert-park',
  name: 'Albert Park Circuit',
  countryCode: 'AU',
  locality: 'Melbourne',
}

function findStartButton() {
  return screen.findByRole('button', { name: /Largar/ }, { timeout: 5_000 })
}

describe('Module 2b race setup', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://localhost:8080/api')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/auth/guest')) {
          return Promise.resolve(
            jsonResponse({ token: 'guest.jwt', role: 'guest', subject: 'guest-id' }),
          )
        }
        if (url.endsWith('/tracks')) return Promise.resolve(jsonResponse(trackCatalog))
        if (url.endsWith('/tracks/albert-park')) {
          return Promise.resolve(jsonResponse(albertParkDefinition))
        }
        if (url.endsWith('/tracks/monaco')) {
          return Promise.resolve(jsonResponse(SHORT_TRACK))
        }
        return Promise.resolve(jsonResponse({}, 404))
      }),
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('prepares a guest session and exposes solo configuration', async () => {
    renderApp('/race')

    expect(await findStartButton()).toBeEnabled()
    expect(screen.getByRole('button', { name: /Solo contra bots/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText('Dificuldade dos bots')).toBeInTheDocument()
    expect(screen.getByText('Modo de condução da corrida')).toBeInTheDocument()
    expect(screen.getByText('Horário da corrida')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Dia/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(
      screen.getByText(/A opção escolhida vale igualmente/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/A escolha do modelo é somente visual/),
    ).toBeInTheDocument()
    expect(screen.getByText('24 circuitos')).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: 'Prévia do traçado Albert Park Circuit' }),
    ).toBeInTheDocument()
    expect(screen.getByText('5.278 km')).toBeInTheDocument()
    expect(screen.getByText('Litoral')).toBeInTheDocument()
  })

  it('switches to two players and exposes the second car selection', async () => {
    const user = userEvent.setup()
    renderApp('/race')
    await findStartButton()
    await user.click(screen.getByRole('button', { name: /Dois jogadores locais/ }))

    expect(screen.getByText('Jogador 2')).toBeInTheDocument()
    expect(screen.queryByText('Dificuldade dos bots')).not.toBeInTheDocument()
  })

  it('fixes the selected visual preset before starting the race', async () => {
    const user = userEvent.setup()
    renderApp('/race')
    await findStartButton()

    await user.click(screen.getByRole('button', { name: /Noite/ }))

    expect(screen.getByRole('button', { name: /Noite/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText(/Litoral · Noite/)).toBeInTheDocument()
  })

  it('loads the selected track definition instead of keeping a fixed track id', async () => {
    const user = userEvent.setup()
    renderApp('/race')
    await findStartButton()

    await user.click(
      screen.getByRole('button', { name: /Circuit de Monaco/ }),
    )

    expect(
      await screen.findByRole('img', {
        name: 'Prévia do traçado Circuit de Monaco',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Circuit de Monaco/ }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByText('3.337 km').length).toBeGreaterThan(0)
  })
})
