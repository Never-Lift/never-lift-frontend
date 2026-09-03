import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RaceEngine } from '@/race/RaceEngine'

const raceCanvasCapture = vi.hoisted(() => ({
  engine: null as RaceEngine | null,
}))

vi.mock('@/components/race/RaceCanvas', () => ({
  RaceCanvas: ({ engine }: { engine: RaceEngine }) => {
    raceCanvasCapture.engine = engine
    return <section aria-label="Corrida de teste iniciada" />
  },
}))

import trackCatalog from '../../contracts/module-2/v2/catalog.json'
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
  return screen.findByRole('button', { name: /Iniciar corrida/ }, { timeout: 5_000 })
}

describe('Module 2 local race setup', () => {
  beforeEach(() => {
    raceCanvasCapture.engine = null
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
          return Promise.resolve(
            jsonResponse({
              ...SHORT_TRACK,
              id: 'monaco',
              name: 'Circuit de Monaco',
            }),
          )
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

  it('groups every local setting in one panel without a redundant summary', async () => {
    renderApp('/race')

    expect(await findStartButton()).toBeEnabled()
    expect(screen.getByRole('button', { name: /SoloUm jogador/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('group', { name: 'Jogador 1' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Pesquisar circuitos' })).toBeInTheDocument()
    expect(screen.getByLabelText('2 bots selecionados')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Dificuldade dos bots: Fácil/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Dia' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('complementary', { name: 'Resumo da corrida' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Personalizar' })).not.toBeInTheDocument()
  })

  it('switches to two local players while preserving bot configuration', async () => {
    const user = userEvent.setup()
    renderApp('/race')
    await findStartButton()

    await user.click(screen.getByRole('button', { name: /LocalDois jogadores/ }))

    expect(screen.getByRole('group', { name: 'Jogador 2' })).toBeInTheDocument()
    expect(screen.getByLabelText('2 bots selecionados')).toBeInTheDocument()
    expect(screen.getByText('4/22 vagas ocupadas')).toBeInTheDocument()
  })

  it('shows paint choices directly and blocks the color used by the other player', async () => {
    const user = userEvent.setup()
    renderApp('/race')
    await findStartButton()
    await user.click(screen.getByRole('button', { name: /LocalDois jogadores/ }))

    const playerTwo = screen.getByRole('group', { name: 'Jogador 2' })
    expect(
      within(playerTwo).getByRole('button', { name: 'Selecionar pintura Azul' }),
    ).toBeDisabled()
    expect(
      within(playerTwo).getByRole('button', { name: 'Selecionar pintura Vermelho' }),
    ).toBeEnabled()
  })

  it('offers only the restrained red, blue and green paint presets', async () => {
    renderApp('/race')
    await findStartButton()

    expect(screen.getByRole('button', { name: 'Selecionar pintura Vermelho' })).toHaveStyle({
      backgroundColor: '#a84448',
    })
    expect(screen.getByRole('button', { name: 'Selecionar pintura Azul' })).toHaveStyle({
      backgroundColor: '#365f82',
    })
    expect(screen.getByRole('button', { name: 'Selecionar pintura Verde' })).toHaveStyle({
      backgroundColor: '#3f704f',
    })
    expect(screen.getAllByRole('button', { name: /Selecionar pintura/ })).toHaveLength(3)
  })

  it('supports zero bots and cycles the three difficulty levels', async () => {
    const user = userEvent.setup()
    renderApp('/race')
    await findStartButton()

    await user.click(screen.getByRole('button', { name: /Dificuldade dos bots: Fácil/ }))
    expect(screen.getByRole('button', { name: /Dificuldade dos bots: Médio/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Dificuldade dos bots: Médio/ }))
    expect(screen.getByRole('button', { name: /Dificuldade dos bots: Difícil/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Diminuir quantidade de bots' }))
    await user.click(screen.getByRole('button', { name: 'Diminuir quantidade de bots' }))
    expect(screen.getByLabelText('0 bots selecionados')).toBeInTheDocument()
    expect(screen.getByText('1/22 vagas ocupadas')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Dificuldade dos bots: Difícil/ })).toBeDisabled()
  })

  it('caps the grid at 22 cars in both solo and local modes', async () => {
    const user = userEvent.setup()
    renderApp('/race')
    await findStartButton()
    const increase = screen.getByRole('button', { name: 'Aumentar quantidade de bots' })

    for (let index = 0; index < 19; index += 1) fireEvent.click(increase)
    expect(screen.getByLabelText('21 bots selecionados')).toBeInTheDocument()
    expect(screen.getByText('22/22 vagas ocupadas')).toBeInTheDocument()
    expect(increase).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /LocalDois jogadores/ }))
    expect(screen.getByLabelText('20 bots selecionados')).toBeInTheDocument()
    expect(screen.getByText('22/22 vagas ocupadas')).toBeInTheDocument()
  })

  it('starts the race with a complete grid of 21 active bots', async () => {
    const user = userEvent.setup()
    renderApp('/race')
    const startButton = await findStartButton()
    const increase = screen.getByRole('button', {
      name: 'Aumentar quantidade de bots',
    })
    for (let index = 0; index < 19; index += 1) fireEvent.click(increase)

    await user.click(startButton)

    expect(
      screen.getByRole('region', { name: 'Corrida de teste iniciada' }),
    ).toBeInTheDocument()
    const engine = raceCanvasCapture.engine
    expect(engine).not.toBeNull()
    const vehicles = engine?.getInterpolatedVehicles() ?? []
    expect(vehicles).toHaveLength(22)
    expect(vehicles.filter((vehicle) => vehicle.kind === 'bot')).toHaveLength(21)
  })

  it('keeps the time-of-day choices directly visible', async () => {
    const user = userEvent.setup()
    renderApp('/race')
    await findStartButton()

    await user.click(screen.getByRole('button', { name: 'Noite' }))

    expect(screen.getByRole('button', { name: 'Noite' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('filters the 24-card carousel without hiding the selected track label', async () => {
    const user = userEvent.setup()
    renderApp('/race')
    await findStartButton()

    expect(screen.getByText('Albert Park Circuit', { selector: 'span.text-info' })).toBeInTheDocument()
    await user.type(screen.getByRole('searchbox', { name: 'Pesquisar circuitos' }), 'monaco')

    expect(screen.getByRole('option', { name: 'Selecionar Circuit de Monaco' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Selecionar Albert Park Circuit' })).not.toBeInTheDocument()
  })

  it('loads a selected circuit and exposes its start and race direction', async () => {
    const user = userEvent.setup()
    renderApp('/race')
    await findStartButton()

    await user.click(screen.getByRole('option', { name: 'Selecionar Circuit de Monaco' }))

    expect(
      await screen.findByRole('img', { name: 'Prévia do traçado Circuit de Monaco' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: 'Selecionar Circuit de Monaco' }),
    ).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Largada e sentido da prova')).toBeInTheDocument()
  })
})
