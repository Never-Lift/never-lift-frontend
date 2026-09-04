import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { AuthContext, type AuthContextValue } from '@/auth/auth-context'
import type { RoomSummary, TrackCatalog, TrackDefinition } from '@/lib/api'
import type { OnlineEnvelope, OnlineRoomClient } from '@/online/OnlineRoomClient'
import { onlineRoomSession } from '@/online/OnlineRoomSession'
import { OnlineLobbyPage } from '@/pages/OnlineLobbyPage'

const tracks = ['albert-park', 'shanghai', 'suzuka', 'bahrain'].map((id, index) => ({
  round: index + 1,
  id,
  name: id.split('-').map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join(' '),
  countryCode: ['AU', 'CN', 'JP', 'BH'][index],
  countryName: ['Austrália', 'China', 'Japão', 'Bahrein'][index],
  locality: 'Cidade',
  lengthMeters: 5_000 + index,
  definitionPath: `tracks/${id}.json`,
}))

const catalog: TrackCatalog = {
  schemaVersion: '2.0.0',
  catalogVersion: '2026.12',
  physicsContractVersion: '2.0.2',
  seasonReference: 2026,
  calendarPolicy: 'original-24-round-freeze',
  tracks,
}

const trackDefinition = (id: string): TrackDefinition => ({
  id,
  name: id,
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  centerline: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
} as TrackDefinition)

const room = (overrides: Partial<RoomSummary> = {}): RoomSummary => ({
  code: '1234',
  name: 'Treino de sexta',
  hostId: 'user-1',
  hostName: 'Host Principal',
  trackId: 'albert-park',
  trackName: 'Albert Park',
  trackCatalogVersion: '2026.12',
  physicsContractVersion: '2.0.2',
  participantCount: 1,
  limit: 22,
  state: 'lobby',
  settingsLocked: false,
  settings: {
    trackId: 'albert-park',
    trackCatalogVersion: '2026.12',
    physicsContractVersion: '2.0.2',
    gridSize: 22,
    botsEnabled: false,
    botDifficulty: 'normal',
    visibility: 'public',
    settingsLocked: false,
  },
  players: [{
    id: 'user-1',
    userId: 'user-1',
    displayName: 'Host Principal',
    bot: false,
    ready: false,
    connected: true,
  }],
  ...overrides,
})

function authValue(subject = 'user-1', role: 'user' | 'guest' = 'user'): AuthContextValue {
  return {
    session: { role, token: 'jwt', subject },
    account: null,
    isGuest: role === 'guest',
    isUser: role === 'user',
    startGuestSession: vi.fn().mockResolvedValue(undefined),
    login: vi.fn().mockResolvedValue(undefined),
    register: vi.fn().mockResolvedValue(undefined),
    loadAccount: vi.fn(),
    updateAccount: vi.fn(),
    deleteAccount: vi.fn(),
    signOut: vi.fn(),
  }
}

const getTracks = vi.fn().mockResolvedValue(catalog)
const getTrack = vi.fn().mockImplementation(async (id: string) => trackDefinition(id))

function renderSetup(api: Record<string, unknown>, auth = authValue()) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={['/race/setup?mode=online']}>
        <Routes>
          <Route element={<OnlineLobbyPage api={api as never} getTrack={getTrack} getTracks={getTracks} />} path="/race/setup" />
          <Route element={<p>lobby route</p>} path="/race/lobby/:roomCode" />
          <Route element={<p>login route</p>} path="/login" />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

function renderLobby({
  api,
  subject = 'user-1',
}: {
  api: Record<string, unknown>
  subject?: string
}) {
  let clientOptions: {
    onEnvelope?: (envelope: OnlineEnvelope) => void
    onStatus?: (status: 'connected') => void
  } | undefined
  const client = {
    connect: vi.fn().mockImplementation(async () => clientOptions?.onStatus?.('connected')),
    disconnect: vi.fn(),
    setReady: vi.fn(),
    startRace: vi.fn(),
  } as unknown as OnlineRoomClient

  render(
    <AuthContext.Provider value={authValue(subject)}>
      <MemoryRouter initialEntries={['/race/lobby/1234']}>
        <Routes>
          <Route
            element={
              <OnlineLobbyPage
                api={api as never}
                createClient={(options) => {
                  clientOptions = options
                  return client
                }}
                getTrack={getTrack}
                getTracks={getTracks}
              />
            }
            path="/race/lobby/:roomCode"
          />
          <Route element={<p>online setup</p>} path="/race/setup" />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )

  return { client, getClientOptions: () => clientOptions }
}

describe('OnlineLobbyPage', () => {
  afterEach(() => {
    onlineRoomSession.resetForTests()
    cleanup()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('shows only public-room identity and capacity, and joins it directly', async () => {
    const api = {
      listRooms: vi.fn().mockResolvedValue([room()]),
      joinRoom: vi.fn().mockResolvedValue(room()),
    }
    renderSetup(api)
    expect(await screen.findByText('Treino de sexta')).toBeInTheDocument()
    expect(screen.getByText(/Host Principal/)).toBeInTheDocument()
    expect(screen.getByLabelText('Capacidade de jogadores')).toHaveTextContent('1/22')
    expect(screen.queryByText('1234')).not.toBeInTheDocument()
    expect(screen.queryByText(/Albert Park/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Senha da sala/i)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^entrar$/i }))
    await waitFor(() => expect(api.joinRoom).toHaveBeenCalledWith('1234', 'jwt'))
    expect(await screen.findByText('lobby route')).toBeInTheDocument()
  })

  it('refreshes only the room list and keeps the setup screen mounted', async () => {
    const api = { listRooms: vi.fn().mockResolvedValue([]) }
    renderSetup(api)
    expect(await screen.findByText(/Nenhuma sala pública/i)).toBeInTheDocument()
    expect(getTracks).toHaveBeenCalledTimes(1)

    api.listRooms.mockResolvedValue([room()])
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar salas' }))
    expect(await screen.findByText('Treino de sexta')).toBeInTheDocument()
    expect(getTracks).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { name: /Entre no lobby/i })).toBeInTheDocument()
  })

  it('keeps code entry private, removes passwords and creates only with identity and visibility', async () => {
    const api = {
      listRooms: vi.fn().mockResolvedValue([]),
      createRoom: vi.fn().mockResolvedValue(room()),
    }
    renderSetup(api)
    const user = userEvent.setup()
    expect(await screen.findByText(/Entrar em sala privada/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/senha/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Sala pública; tornar privada/i }))
    await user.click(screen.getByRole('button', { name: /^criar sala$/i }))
    await waitFor(() => expect(api.createRoom).toHaveBeenCalledWith({ name: undefined, visibility: 'private' }, 'jwt'))
  })

  it('shows a blocked preview to guests and never loads protected room data', async () => {
    const api = { listRooms: vi.fn() }
    renderSetup(api, authValue('guest-1', 'guest'))
    expect(await screen.findByRole('heading', { name: /Login necessário/i })).toBeInTheDocument()
    expect(screen.getByText('Encontrar corrida')).toBeInTheDocument()
    expect(api.listRooms).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /Fazer login/i }))
    expect(await screen.findByText('login route')).toBeInTheDocument()
  })

  it('updates host settings live, clamps the grid and never asks the host to be ready', async () => {
    const second = {
      id: 'user-2', userId: 'user-2', displayName: 'Segundo', bot: false, ready: true, connected: true,
    }
    const initial = room({ participantCount: 2, players: [...room().players!, second] })
    const api = {
      getRoom: vi.fn().mockResolvedValue(initial),
      getConnectionTicket: vi.fn(),
      updateRoom: vi.fn().mockImplementation(async (_code, changes) => ({ ...initial, ...changes, limit: changes.gridSize, settings: { ...initial.settings, ...changes } })),
      startRoom: vi.fn().mockResolvedValue({ ...initial, state: 'qualifying' }),
    }
    renderLobby({ api })
    const user = userEvent.setup()
    const grid = await screen.findByLabelText('Limite de carros')
    expect(screen.queryByRole('button', { name: /Estou pronto/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Salvar ajustes/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Resumo da sala/i })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Código da sala 1234')).toBeInTheDocument()

    await user.clear(grid)
    await user.type(grid, '30')
    expect(grid).toHaveValue('22')
    expect(await screen.findByRole('alert')).toHaveTextContent(/entre 2 e 22/i)
    await user.click(screen.getByRole('button', { name: 'Diminuir limite de carros' }))
    await waitFor(() => expect(api.updateRoom).toHaveBeenCalledWith('1234', expect.objectContaining({ gridSize: 21 }), 'jwt'))
    await user.click(screen.getByRole('button', { name: /Sala pública; tornar privada/i }))
    await waitFor(() => expect(api.updateRoom).toHaveBeenCalledWith('1234', expect.objectContaining({ visibility: 'private' }), 'jwt'))
  })

  it('shows the regular-player summary, syncs host changes and keeps ready reversible', async () => {
    const player = {
      id: 'user-2', userId: 'user-2', displayName: 'Segundo', bot: false, ready: false, connected: true,
    }
    const initial = room({
      participantCount: 2,
      settings: { ...room().settings!, botsEnabled: true, botDifficulty: 'hard', gridSize: 4 },
      limit: 4,
      players: [...room().players!, player],
    })
    const api = { getRoom: vi.fn().mockResolvedValue(initial), getConnectionTicket: vi.fn() }
    const { client, getClientOptions } = renderLobby({ api, subject: 'user-2' })
    const user = userEvent.setup()
    expect(await screen.findByRole('heading', { name: /Resumo da sala/i })).toBeInTheDocument()
    expect(screen.getByText('Ativos · 2 · Difícil')).toBeInTheDocument()
    expect(screen.getByLabelText('Código da sala 1234')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Estou pronto/i }))
    expect(client.setReady).toHaveBeenCalledWith(true)

    getClientOptions()?.onEnvelope?.({
      type: 'room_state',
      payload: {
        ...initial,
        trackId: 'shanghai',
        settings: { ...initial.settings, trackId: 'shanghai' },
        players: initial.players?.map((item) => item.id === 'user-2' ? { ...item, ready: true } : item),
      },
    })
    expect(await screen.findByText('Shanghai')).toBeInTheDocument()
    await new Promise((resolve) => window.setTimeout(resolve, 500))
    await user.click(screen.getByRole('button', { name: /Retirar pronto/i }))
    expect(client.setReady).toHaveBeenLastCalledWith(false)
  })

  it('starts without host ready and lets the host cancel an untouched qualification', async () => {
    const second = {
      id: 'user-2', userId: 'user-2', displayName: 'Segundo', bot: false, ready: true, connected: true,
    }
    const initial = room({ participantCount: 2, players: [...room().players!, second] })
    const qualifying = { ...initial, state: 'qualifying' as const, settingsLocked: true }
    const api = {
      getRoom: vi.fn().mockResolvedValue(initial),
      getConnectionTicket: vi.fn(),
      updateRoom: vi.fn().mockResolvedValue(initial),
      startRoom: vi.fn().mockResolvedValue(qualifying),
      cancelQualification: vi.fn().mockResolvedValue(initial),
    }
    renderLobby({ api })
    const user = userEvent.setup()
    const start = await screen.findByRole('button', { name: /Iniciar classificação/i })
    expect(start).toBeEnabled()
    await user.click(start)
    expect(api.startRoom).toHaveBeenCalledWith('1234', 'jwt')
    const cancel = await screen.findByRole('button', { name: /Cancelar classificação/i })
    await user.click(cancel)
    expect(api.cancelQualification).toHaveBeenCalledWith('1234', 'jwt')
    expect(await screen.findByRole('status')).toHaveTextContent(/voltou ao lobby/i)
  })
})
