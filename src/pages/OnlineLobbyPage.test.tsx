import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '@/auth/auth-context'
import { OnlineLobbyPage } from '@/pages/OnlineLobbyPage'
import type { RoomSummary, TrackCatalog } from '@/lib/api'
import type { OnlineEnvelope, OnlineRoomClient } from '@/online/OnlineRoomClient'
import { onlineRoomSession } from '@/online/OnlineRoomSession'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const catalog: TrackCatalog = {
  schemaVersion: '2.0.0',
  catalogVersion: '2026.12',
  physicsContractVersion: '2.0.0',
  seasonReference: 2026,
  calendarPolicy: 'original-24-round-freeze',
  tracks: [
    {
      round: 1,
      id: 'albert-park',
      name: 'Albert Park Circuit',
      countryCode: 'AU',
      countryName: 'Austrália',
      locality: 'Melbourne',
      lengthMeters: 5278,
      definitionPath: 'tracks/albert-park.json',
    },
  ],
}

const room = (overrides: Partial<RoomSummary> = {}): RoomSummary => ({
  code: '1234',
  name: 'Treino de sexta',
  hostId: 'user-1',
  trackId: 'albert-park',
  trackName: 'Albert Park Circuit',
  trackCatalogVersion: '2026.12',
  physicsContractVersion: '2.0.0',
  participantCount: 1,
  limit: 22,
  state: 'lobby',
  hasPassword: false,
  settingsLocked: false,
  settings: {
    trackId: 'albert-park',
    trackCatalogVersion: '2026.12',
    physicsContractVersion: '2.0.0',
    gridSize: 22,
    botsEnabled: false,
    botDifficulty: 'normal',
    visibility: 'public',
    settingsLocked: false,
  },
  players: [
    {
      id: 'user-1',
      userId: 'user-1',
      displayName: 'Host',
      bot: false,
      ready: false,
      connected: true,
    },
  ],
  ...overrides,
})

function authValue(): AuthContextValue {
  return {
    session: { role: 'user', token: 'jwt', subject: 'user-1' },
    account: null,
    isGuest: false,
    isUser: true,
    startGuestSession: vi.fn().mockResolvedValue(undefined),
    login: vi.fn().mockResolvedValue(undefined),
    register: vi.fn().mockResolvedValue(undefined),
    loadAccount: vi.fn(),
    updateAccount: vi.fn(),
    deleteAccount: vi.fn(),
    signOut: vi.fn(),
  }
}

function renderSetup(api: Record<string, unknown>) {
  return render(
    <AuthContext.Provider value={authValue()}>
      <MemoryRouter initialEntries={['/race/setup?mode=online']}>
        <Routes>
          <Route element={<OnlineLobbyPage api={api as never} getTracks={vi.fn().mockResolvedValue(catalog)} />} path="/race/setup" />
          <Route element={<p>lobby route</p>} path="/race/lobby/:roomCode" />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('OnlineLobbyPage', () => {
  afterEach(() => {
    onlineRoomSession.resetForTests()
    cleanup()
    vi.restoreAllMocks()
  })

  it('lists public rooms and only asks for a password when the selected room is protected', async () => {
    const api = {
      listRooms: vi.fn().mockResolvedValue([
        room({ hasPassword: true }),
        room({ code: '5678', name: 'Livre', participantCount: 22 }),
      ]),
    }
    renderSetup(api)

    expect(await screen.findByText('Treino de sexta')).toBeInTheDocument()
    expect(screen.getByText('Livre')).toBeInTheDocument()
    const enterButtons = screen.getAllByRole('button', { name: /entrar/i })
    await userEvent.click(enterButtons[0])
    expect(screen.getByLabelText('Senha da sala')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cheia' })).toBeDisabled()
  })

  it('uses one generic error for malformed codes and backend join failures', async () => {
    const api = {
      listRooms: vi.fn().mockResolvedValue([]),
      joinRoom: vi.fn().mockRejectedValue(new Error('room exists')),
    }
    renderSetup(api)
    const user = userEvent.setup()
    const code = (await screen.findAllByLabelText('Código de quatro dígitos'))[0]
    await user.type(code, '9999')
    await user.click(screen.getAllByRole('button', { name: /entrar na sala por código/i })[0])
    expect(await screen.findByText(/não foi possível entrar nessa sala/i)).toBeInTheDocument()
    await waitFor(() => expect(api.joinRoom).toHaveBeenCalledWith('9999', {}, 'jwt'))
  })

  it('submits the selected password for a protected room', async () => {
    const api = {
      listRooms: vi.fn().mockResolvedValue([room({ hasPassword: true })]),
      joinRoom: vi.fn().mockResolvedValue(room()),
    }
    renderSetup(api)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /^entrar$/i }))
    await user.type(screen.getByLabelText('Senha da sala'), 'secret1')
    await user.click(screen.getByRole('button', { name: /entrar na sala por código/i }))
    await waitFor(() =>
      expect(api.joinRoom).toHaveBeenCalledWith(
        '1234',
        { password: 'secret1' },
        'jwt',
      ),
    )
    expect(await screen.findByText('lobby route')).toBeInTheDocument()
  })

  it('creates a room with identity and access only, leaving race settings for the lobby', async () => {
    const api = {
      listRooms: vi.fn().mockResolvedValue([]),
      createRoom: vi.fn().mockResolvedValue(room()),
    }
    renderSetup(api)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /^criar sala$/i }))
    await waitFor(() =>
      expect(api.createRoom).toHaveBeenCalledWith(
        {
          name: undefined,
          visibility: 'public',
          password: undefined,
        },
        'jwt',
      ),
    )
    expect(await screen.findByText('lobby route')).toBeInTheDocument()
  })

  it('keeps the host start action disabled until all humans are ready', async () => {
    const initial = room({
      participantCount: 2,
      players: [
        ...room().players!,
        {
          id: 'user-2',
          userId: 'user-2',
          displayName: 'Segundo piloto',
          bot: false,
          ready: false,
          connected: true,
        },
      ],
    })
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      setReady: vi.fn(),
      startRace: vi.fn(),
    } as unknown as OnlineRoomClient
    let clientOptions: { onEnvelope?: (envelope: OnlineEnvelope) => void } | undefined
    const api = {
      getRoom: vi.fn().mockResolvedValue(initial),
      getConnectionTicket: vi.fn().mockResolvedValue({
        ticket: 'ticket',
        roomCode: '1234',
        expiresAt: '2026-09-01T12:01:00.000Z',
      }),
      startRoom: vi.fn().mockResolvedValue({
        ...initial,
        state: 'qualifying',
        players: initial.players?.map((player) => ({ ...player, ready: true })),
      }),
    }
    render(
      <AuthContext.Provider value={authValue()}>
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
                  getTracks={vi.fn().mockResolvedValue(catalog)}
                />
              }
              path="/race/lobby/:roomCode"
            />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    )

    const start = await screen.findByRole('button', { name: /iniciar classificação/i })
    expect(start).toBeDisabled()
    clientOptions?.onEnvelope?.({
      type: 'room_state',
      payload: {
        ...initial,
        players: initial.players?.map((player) => ({ ...player, ready: true })),
      },
    })
    await waitFor(() => expect(start).toBeEnabled())
    await userEvent.click(start)
    expect(api.startRoom).toHaveBeenCalledWith('1234', 'jwt')
  })

  it('identifies the host, configures and moderates the room, toggles ready, and leaves with confirmation', async () => {
    const initial = room({
      participantCount: 2,
      players: [
        ...room().players!,
        {
          id: 'user-2',
          userId: 'user-2',
          displayName: 'Segundo piloto',
          bot: false,
          ready: false,
          connected: true,
        },
      ],
    })
    let clientOptions: { onStatus?: (status: 'connected') => void; onEnvelope?: (envelope: OnlineEnvelope) => void } | undefined
    const client = {
      connect: vi.fn().mockImplementation(async () => clientOptions?.onStatus?.('connected')),
      disconnect: vi.fn(),
      setReady: vi.fn(),
      startRace: vi.fn(),
    } as unknown as OnlineRoomClient
    const api = {
      getRoom: vi.fn().mockResolvedValue(initial),
      getConnectionTicket: vi.fn(),
      updateRoom: vi.fn().mockResolvedValue({ ...initial, limit: 12 }),
      removePlayer: vi.fn().mockResolvedValue({
        ...initial,
        participantCount: 1,
        players: initial.players?.slice(0, 1),
      }),
      leaveRoom: vi.fn().mockResolvedValue({
        ...initial,
        participantCount: 1,
        players: initial.players?.slice(1),
      }),
      closeRoom: vi.fn(),
      startRoom: vi.fn(),
    }
    render(
      <AuthContext.Provider value={authValue()}>
        <MemoryRouter initialEntries={['/race/lobby/1234']}>
          <Routes>
            <Route
              element={
                <OnlineLobbyPage
                  api={api as never}
                  createClient={(options) => {
                    clientOptions = options as typeof clientOptions
                    return client
                  }}
                  getTracks={vi.fn().mockResolvedValue(catalog)}
                />
              }
              path="/race/lobby/:roomCode"
            />
            <Route element={<p>online setup</p>} path="/race/setup" />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    )

    expect(await screen.findByLabelText('Host da sala')).toBeInTheDocument()
    const user = userEvent.setup()
    const grid = screen.getByLabelText('Limite de carros')
    await user.clear(grid)
    await user.type(grid, '12')
    await user.click(screen.getByRole('button', { name: /salvar ajustes/i }))
    await waitFor(() =>
      expect(api.updateRoom).toHaveBeenCalledWith(
        '1234',
        expect.objectContaining({ gridSize: 12 }),
        'jwt',
      ),
    )

    await user.click(screen.getByRole('button', { name: 'Remover Segundo piloto' }))
    expect(api.removePlayer).toHaveBeenCalledWith('1234', 'user-2', 'jwt')

    await user.click(screen.getByRole('button', { name: /estou pronto/i }))
    expect(client.setReady).toHaveBeenCalledWith(true)
    clientOptions?.onEnvelope?.({
      type: 'room_state',
      payload: {
        ...initial,
        players: initial.players?.map((player) =>
          player.id === 'user-1' ? { ...player, ready: true } : player,
        ),
      },
    })
    const unready = await screen.findByRole('button', { name: /retirar pronto/i })
    await new Promise((resolve) => window.setTimeout(resolve, 500))
    await user.click(unready)
    expect(client.setReady).toHaveBeenLastCalledWith(false)

    await user.click(screen.getByRole('button', { name: /^sair da sala$/i }))
    expect(await screen.findByText(/deseja realmente sair da sala treino de sexta/i)).toBeInTheDocument()
    const leaveButtons = screen.getAllByRole('button', { name: /^sair da sala$/i })
    await user.click(leaveButtons.at(-1)!)
    await waitFor(() => expect(api.leaveRoom).toHaveBeenCalledWith('1234', 'jwt'))
    expect(await screen.findByText('online setup')).toBeInTheDocument()
  })
})
