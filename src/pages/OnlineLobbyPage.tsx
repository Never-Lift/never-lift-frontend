import {
  Check,
  CircleAlert,
  Crown,
  DoorOpen,
  Globe2,
  LockKeyhole,
  LoaderCircle,
  Plus,
  RefreshCw,
  Settings2,
  ShieldAlert,
  Trash2,
  UserRound,
  Users,
  Wifi,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { useAuth } from '@/auth/auth-context'
import { AppShell } from '@/components/AppShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  onlineApi,
  raceApi,
  type CreateRoomRequest,
  type RoomBotDifficulty,
  type RoomParticipant,
  type RoomSettingsUpdate,
  type RoomState,
  type RoomSummary,
  type RoomVisibility,
  type TrackCatalog,
} from '@/lib/api'
import { getErrorMessage } from '@/lib/error-messages'
import {
  OnlineRoomClient,
  type OnlineEnvelope,
  type OnlineRoomClientStatus,
} from '@/online/OnlineRoomClient'

type LobbyApi = Pick<
  typeof onlineApi,
  | 'listRooms'
  | 'createRoom'
  | 'joinRoom'
  | 'getRoom'
  | 'getConnectionTicket'
  | 'updateRoom'
  | 'removePlayer'
  | 'closeRoom'
>

type LobbyDependencies = {
  api?: LobbyApi
  getTracks?: typeof raceApi.getTracks
  createClient?: (options: ConstructorParameters<typeof OnlineRoomClient>[0]) => OnlineRoomClient
}

const defaultClientFactory = (
  options: ConstructorParameters<typeof OnlineRoomClient>[0],
) => new OnlineRoomClient(options)

const DEFAULT_TRACK_CATALOG_VERSION = '2026.12'
const DEFAULT_PHYSICS_CONTRACT_VERSION = '2.0.0'

function normalizeState(value: unknown): RoomState {
  const state = String(value ?? 'lobby').toLowerCase()
  if (state === 'qualifying' || state === 'race' || state === 'closed') return state
  return 'lobby'
}

function participantFrom(value: unknown, readyStates?: Record<string, boolean>): RoomParticipant | null {
  if (typeof value !== 'object' || value === null) return null
  const source = value as Record<string, unknown>
  const id = String(source.id ?? source.playerId ?? source.userId ?? '')
  if (!id) return null
  const ready =
    typeof source.ready === 'boolean'
      ? source.ready
      : readyStates?.[id] ??
        (typeof source.userId === 'string' ? readyStates?.[source.userId] : false) ??
        false
  return {
    id,
    userId: typeof source.userId === 'string' ? source.userId : null,
    displayName:
      typeof source.displayName === 'string' ? source.displayName : null,
    gamertag: typeof source.gamertag === 'string' ? source.gamertag : null,
    bot: source.bot === true || source.kind === 'bot',
    ready,
    connected: source.connected !== false,
    color: typeof source.color === 'string' ? source.color : null,
    joinedAt: typeof source.joinedAt === 'string' ? source.joinedAt : undefined,
  }
}

function roomFromPayload(payload: unknown, fallbackCode: string): RoomSummary | null {
  if (typeof payload !== 'object' || payload === null) return null
  const source = payload as Record<string, unknown>
  const nested =
    typeof source.room === 'object' && source.room !== null
      ? (source.room as Record<string, unknown>)
      : source
  const settingsSource =
    typeof nested.settings === 'object' && nested.settings !== null
      ? (nested.settings as Record<string, unknown>)
      : nested
  const readyStates =
    typeof nested.readyStates === 'object' && nested.readyStates !== null
      ? (nested.readyStates as Record<string, boolean>)
      : undefined
  const players = Array.isArray(nested.players)
    ? nested.players
        .map((player) => participantFrom(player, readyStates))
        .filter((player): player is RoomParticipant => player !== null)
    : []
  const code = String(nested.code ?? nested.roomCode ?? fallbackCode)
  const trackId = String(nested.trackId ?? settingsSource.trackId ?? '')
  if (!trackId) return null
  const gridSize = Number(nested.limit ?? settingsSource.gridSize ?? 22)
  const visibility = String(
    nested.visibility ?? settingsSource.visibility ?? 'public',
  ).toLowerCase() === 'private'
    ? 'private'
    : 'public'
  const room: RoomSummary = {
    code,
    name: String(nested.name ?? 'Sala online'),
    hostId: String(nested.hostId ?? ''),
    hostName:
      typeof nested.hostName === 'string' ? nested.hostName : null,
    trackId,
    trackName: typeof nested.trackName === 'string' ? nested.trackName : null,
    trackCatalogVersion: String(
      nested.trackCatalogVersion ??
        settingsSource.trackCatalogVersion ??
        DEFAULT_TRACK_CATALOG_VERSION,
    ),
    physicsContractVersion: String(
      nested.physicsContractVersion ??
        settingsSource.physicsContractVersion ??
        DEFAULT_PHYSICS_CONTRACT_VERSION,
    ),
    participantCount: Number(nested.participantCount ?? players.length),
    limit: Number.isFinite(gridSize) ? gridSize : 22,
    state: normalizeState(nested.state),
    hasPassword: nested.hasPassword === true,
    settingsLocked:
      nested.settingsLocked === true || settingsSource.settingsLocked === true,
    settings: {
      trackId,
      trackCatalogVersion: String(
        settingsSource.trackCatalogVersion ?? DEFAULT_TRACK_CATALOG_VERSION,
      ),
      physicsContractVersion: String(
        settingsSource.physicsContractVersion ?? DEFAULT_PHYSICS_CONTRACT_VERSION,
      ),
      gridSize: Number.isFinite(gridSize) ? gridSize : 22,
      botsEnabled: settingsSource.botsEnabled === true,
      botDifficulty: normalizeDifficulty(settingsSource.botDifficulty),
      visibility,
      settingsLocked:
        nested.settingsLocked === true || settingsSource.settingsLocked === true,
      passwordRequired: nested.hasPassword === true,
    },
    players,
  }
  return room
}

function normalizeDifficulty(value: unknown): RoomBotDifficulty {
  const difficulty = String(value ?? 'normal').toLowerCase()
  return difficulty === 'easy' || difficulty === 'hard' ? difficulty : 'normal'
}

function trackNameFor(catalog: TrackCatalog | null, trackId: string) {
  return catalog?.tracks.find((track) => track.id === trackId)?.name ?? trackId
}

function formatRoomState(state: RoomState) {
  if (state === 'qualifying') return 'Classificação'
  if (state === 'race') return 'Em corrida'
  if (state === 'closed') return 'Fechada'
  return 'Lobby'
}

function GenericError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div
      aria-live="polite"
      className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/8 p-4 text-sm"
      role="alert"
    >
      <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-destructive" />
      <p className="leading-6 text-destructive">{message}</p>
    </div>
  )
}

function RoomList({
  rooms,
  trackCatalog,
  onJoin,
}: {
  rooms: RoomSummary[]
  trackCatalog: TrackCatalog | null
  onJoin: (code: string, passwordRequired: boolean) => void
}) {
  if (rooms.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Nenhuma sala pública disponível. Crie a primeira da lista.
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {rooms.map((room) => {
        const full = room.participantCount >= room.limit
        return (
          <div
            className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border/70 bg-background/35 px-4 py-3"
            key={room.code}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate font-extrabold">{room.name || 'Sala online'}</p>
                {room.hasPassword ? (
                  <LockKeyhole aria-label="Sala protegida por senha" className="size-3.5 text-warning" />
                ) : (
                  <Globe2 aria-label="Sala pública" className="size-3.5 text-success" />
                )}
              </div>
              <p className="mt-1 text-xs font-semibold text-muted-foreground">
                Código <span className="font-mono text-foreground">{room.code}</span> ·{' '}
                Host {room.hostName ?? room.hostId.slice(0, 8)} ·{' '}
                {trackNameFor(trackCatalog, room.trackId)} · {formatRoomState(room.state)}
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs font-bold text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Users aria-hidden="true" className="size-3.5" />
                {room.participantCount}/{room.limit}
              </span>
              <Button
                disabled={full || room.state !== 'lobby'}
                onClick={() => onJoin(room.code, room.hasPassword)}
                size="sm"
                variant="secondary"
              >
                <DoorOpen aria-hidden="true" className="size-4" />
                {full ? 'Cheia' : 'Entrar'}
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function LobbyPlayer({
  player,
  isHost,
  isCurrentPlayer,
  onRemove,
}: {
  player: RoomParticipant
  isHost: boolean
  isCurrentPlayer: boolean
  onRemove: () => void
}) {
  const label = player.displayName ?? player.gamertag ?? (player.bot ? 'Bot' : 'Piloto')
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/35 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full border border-border bg-muted/70">
          {player.bot ? <Wifi aria-hidden="true" className="size-4 text-info" /> : <UserRound aria-hidden="true" className="size-4 text-primary" />}
        </span>
        <div className="min-w-0">
          <p className="truncate font-bold">
            {label}
            {isCurrentPlayer && <span className="ml-2 text-xs font-semibold text-info">Você</span>}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {player.bot ? 'Bot da sala' : player.connected ? 'Conectado' : 'Reconectando'}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.12em] ${
            player.ready
              ? 'border-success/35 bg-success/10 text-success'
              : 'border-border bg-muted/50 text-muted-foreground'
          }`}
        >
          {player.ready && <Check aria-hidden="true" className="size-3" />}
          {player.ready ? 'Pronto' : 'Aguardando'}
        </span>
        {isHost && !player.bot && !isCurrentPlayer && (
          <Button aria-label={`Remover ${label}`} onClick={onRemove} size="icon" variant="ghost">
            <Trash2 aria-hidden="true" className="size-4 text-destructive" />
          </Button>
        )}
      </div>
    </li>
  )
}

export function OnlineLobbyPage({
  api = onlineApi,
  getTracks = raceApi.getTracks,
  createClient = defaultClientFactory,
}: LobbyDependencies = {}) {
  const { session, startGuestSession } = useAuth()
  const navigate = useNavigate()
  const { roomCode: routeRoomCode } = useParams()
  const roomCode = routeRoomCode?.toUpperCase() ?? null
  const isLobby = Boolean(roomCode)
  const requestedGuest = useRef(false)
  const clientRef = useRef<OnlineRoomClient | null>(null)

  const [trackCatalog, setTrackCatalog] = useState<TrackCatalog | null>(null)
  const [rooms, setRooms] = useState<RoomSummary[]>([])
  const [room, setRoom] = useState<RoomSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [joinCode, setJoinCode] = useState('')
  const [joinPassword, setJoinPassword] = useState('')
  const [joinPasswordRequired, setJoinPasswordRequired] = useState(false)
  const [roomName, setRoomName] = useState('')
  const [gridSize, setGridSize] = useState('22')
  const [createTrackId, setCreateTrackId] = useState('')
  const [botsEnabled, setBotsEnabled] = useState(false)
  const [botDifficulty, setBotDifficulty] = useState<RoomBotDifficulty>('normal')
  const [visibility, setVisibility] = useState<RoomVisibility>('public')
  const [roomPassword, setRoomPassword] = useState('')
  const [clearRoomPassword, setClearRoomPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [clientStatus, setClientStatus] = useState<OnlineRoomClientStatus>('idle')
  const [readyPending, setReadyPending] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)

  const genericEntryError = 'Não foi possível entrar nessa sala. Confira o código, a senha e a disponibilidade.'

  const ensureSession = useCallback(() => {
    if (session || requestedGuest.current) return
    requestedGuest.current = true
    startGuestSession().catch((sessionError: unknown) => {
      requestedGuest.current = false
      setError(getErrorMessage(sessionError))
    })
  }, [session, startGuestSession])

  useEffect(() => {
    ensureSession()
  }, [ensureSession])

  const loadSetup = useCallback(async () => {
    if (isLobby || !session) return
    setLoading(true)
    setError(null)
    try {
      const [catalog, publicRooms] = await Promise.all([
        getTracks(),
        api.listRooms(session.token),
      ])
      setTrackCatalog(catalog)
      setCreateTrackId((current) => current || catalog.tracks[0]?.id || '')
      setRooms(publicRooms.map((item) => roomFromPayload(item, item.code)).filter((item): item is RoomSummary => item !== null))
    } catch (loadError: unknown) {
      setError(getErrorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [api, getTracks, isLobby, session])

  useEffect(() => {
    void loadSetup()
  }, [loadSetup])

  useEffect(() => {
    if (!isLobby || !roomCode || !session) return
    let disposed = false
    setLoading(true)
    setError(null)
    const loadLobby = async () => {
      try {
        const [catalog, initialRoom] = await Promise.all([
          getTracks(),
          api.getRoom(roomCode, session.token),
        ])
        if (disposed) return
        setTrackCatalog(catalog)
        const normalized = roomFromPayload(initialRoom, roomCode)
        if (normalized) {
          setRoom(normalized)
          setGridSize(String(normalized.limit))
          setCreateTrackId(normalized.trackId)
          setBotsEnabled(normalized.settings?.botsEnabled === true)
          setBotDifficulty(normalized.settings?.botDifficulty ?? 'normal')
          setVisibility(normalized.settings?.visibility ?? 'public')
          setClearRoomPassword(false)
        }
        const client = createClient({
          roomCode,
          trackCatalogVersion: catalog.catalogVersion,
          physicsContractVersion: catalog.physicsContractVersion,
          getTicket: () => api.getConnectionTicket(roomCode, session.token),
          onStatus: (status) => {
            if (!disposed) setClientStatus(status)
          },
          onEnvelope: (envelope: OnlineEnvelope) => {
            if (disposed) return
            if (envelope.type === 'room_state') {
              const nextRoom = roomFromPayload(envelope.payload, roomCode)
              if (nextRoom) setRoom(nextRoom)
            }
            if (envelope.type === 'error') {
              setError(genericEntryError)
            }
          },
        })
        clientRef.current = client
        await client.connect()
      } catch (loadError: unknown) {
        if (!disposed) setError(genericEntryError || getErrorMessage(loadError))
      } finally {
        if (!disposed) setLoading(false)
      }
    }
    void loadLobby()
    return () => {
      disposed = true
      clientRef.current?.disconnect()
      clientRef.current = null
    }
  }, [api, createClient, genericEntryError, getTracks, isLobby, roomCode, session])

  const currentPlayer = useMemo(() => {
    if (!room || !session) return null
    return room.players?.find((player) =>
      session.subject ? player.userId === session.subject || player.id === session.subject : false,
    ) ?? null
  }, [room, session])
  const isHost = Boolean(room && session && (room.hostId === session.subject || room.hostId === currentPlayer?.id))
  const allHumansReady = Boolean(
    room?.players?.filter((player) => !player.bot).every((player) => player.ready),
  )
  const minimumGridReached = Boolean(
    room &&
      (room.participantCount >= 2 ||
        (room.settings?.botsEnabled === true &&
          room.players?.some((player) => !player.bot))),
  )
  const canStart = Boolean(
    room && isHost && room.state === 'lobby' && minimumGridReached && allHumansReady,
  )

  const handleJoin = useCallback(
    async (code = joinCode, passwordRequired = joinPasswordRequired) => {
      const normalizedCode = code.replace(/\D/g, '').slice(0, 4)
      if (!/^\d{4}$/.test(normalizedCode)) {
        setError(genericEntryError)
        return
      }
      if (!session) return
      setSubmitting(true)
      setError(null)
      try {
        const joined = await api.joinRoom(
          normalizedCode,
          passwordRequired || joinPassword ? { password: joinPassword } : {},
          session.token,
        )
        const target = roomFromPayload(joined, normalizedCode)?.code ?? normalizedCode
        navigate(`/race/lobby/${target}`)
      } catch {
        setError(genericEntryError)
      } finally {
        setSubmitting(false)
      }
    }, [api, genericEntryError, joinCode, joinPassword, joinPasswordRequired, navigate, session],
  )

  const handleCreate = useCallback(async () => {
    if (!session || !createTrackId) return
    const parsedGrid = Number(gridSize)
    if (!Number.isInteger(parsedGrid) || parsedGrid < 2 || parsedGrid > 22) {
      setError('O grid deve ter entre 2 e 22 carros.')
      return
    }
    if (roomPassword && roomPassword.length < 6) {
      setError('A senha da sala precisa ter pelo menos 6 caracteres.')
      return
    }
    setSubmitting(true)
    setError(null)
    const request: CreateRoomRequest = {
      name: roomName.trim() || undefined,
      trackId: createTrackId,
      gridSize: parsedGrid,
      botsEnabled,
      botDifficulty,
      visibility,
      password: roomPassword || undefined,
    }
    try {
      const created = await api.createRoom(request, session.token)
      const target = roomFromPayload(created, '0000')?.code
      if (!target) throw new Error('A resposta da sala não trouxe um código válido.')
      navigate(`/race/lobby/${target}`)
    } catch (createError: unknown) {
      setError(getErrorMessage(createError))
    } finally {
      setSubmitting(false)
    }
  }, [api, botDifficulty, botsEnabled, createTrackId, gridSize, navigate, roomName, roomPassword, session, visibility])

  const handleSaveSettings = useCallback(async () => {
    if (!room || !session || !isHost || room.settingsLocked) return
    const changes: RoomSettingsUpdate = {
      trackId: createTrackId,
      gridSize: Number(gridSize),
      botsEnabled,
      botDifficulty,
      visibility,
      password: clearRoomPassword ? '' : roomPassword || undefined,
    }
    setSettingsSaving(true)
    setError(null)
    try {
      const updated = await api.updateRoom(room.code, changes, session.token)
      const normalized = roomFromPayload(updated, room.code)
      if (normalized) setRoom(normalized)
    } catch (saveError: unknown) {
      setError(getErrorMessage(saveError))
    } finally {
      setSettingsSaving(false)
    }
  }, [api, botDifficulty, botsEnabled, clearRoomPassword, createTrackId, gridSize, isHost, room, roomPassword, session, visibility])

  const handleRemove = useCallback(async (playerId: string) => {
    if (!room || !session || !isHost) return
    try {
      await api.removePlayer(room.code, playerId, session.token)
    } catch (removeError: unknown) {
      setError(getErrorMessage(removeError))
    }
  }, [api, isHost, room, session])

  const handleClose = useCallback(async () => {
    if (!room || !session || !isHost) return
    try {
      await api.closeRoom(room.code, session.token)
      clientRef.current?.disconnect()
      navigate('/race/setup?mode=online', { replace: true })
    } catch (closeError: unknown) {
      setError(getErrorMessage(closeError))
    }
  }, [api, isHost, navigate, room, session])

  if (!session || loading) {
    return (
      <AppShell moduleLabel="Lobby online">
        <div className="grid min-h-[50vh] place-items-center text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-3"><LoaderCircle aria-hidden="true" className="size-5 animate-spin text-info" /> Preparando conexão online…</span>
        </div>
      </AppShell>
    )
  }

  if (isLobby && room) {
    const players = room.players ?? []
    return (
      <AppShell moduleLabel={`Lobby // ${room.code}`}>
        <section className="space-y-7">
          <header className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-info">Sala online · {room.code}</p>
              <h1 className="display-heading mt-3 text-6xl sm:text-8xl">{room.name}</h1>
              <p className="mt-4 text-sm text-muted-foreground">{trackNameFor(trackCatalog, room.trackId)} · grid {room.limit} · {room.hasPassword ? 'protegida por senha' : 'sala pública'}</p>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-2 text-xs font-bold">
              <span className={`size-2 rounded-full ${clientStatus === 'connected' ? 'bg-success shadow-[0_0_10px_var(--success)]' : clientStatus === 'reconnecting' ? 'bg-warning' : 'bg-muted-foreground'}`} />
              {clientStatus === 'connected' ? 'Conectado' : clientStatus === 'reconnecting' ? 'Reconectando' : 'Conexão pendente'}
            </div>
          </header>

          <GenericError message={error} />

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.7fr)]">
            <section className="surface-panel p-5 sm:p-7">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-5">
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-muted-foreground">Pilotos</p>
                  <h2 className="mt-1 font-display text-3xl font-black uppercase italic">{players.length}/{room.limit}</h2>
                </div>
                <span className="inline-flex items-center gap-2 text-xs font-bold text-muted-foreground"><Users aria-hidden="true" className="size-4 text-info" /> {allHumansReady ? 'Todos os humanos prontos' : 'Aguardando confirmações'}</span>
              </div>
              <ul className="space-y-2">
                {players.map((player) => (
                  <LobbyPlayer
                    isCurrentPlayer={player.id === currentPlayer?.id || player.userId === session.subject}
                    isHost={isHost && room.state === 'lobby'}
                    key={player.id}
                    onRemove={() => void handleRemove(player.id)}
                    player={player}
                  />
                ))}
              </ul>
              {players.length < 2 && <p className="mt-4 text-xs font-semibold text-warning">São necessários pelo menos dois carros para iniciar.</p>}
              <div className="mt-6 flex flex-wrap gap-3 border-t border-border/70 pt-5">
                <Button
                  disabled={!currentPlayer || readyPending || clientStatus !== 'connected' || room.state !== 'lobby'}
                  onClick={() => {
                    const nextReady = !currentPlayer?.ready
                    setReadyPending(true)
                    clientRef.current?.setReady(nextReady)
                    window.setTimeout(() => setReadyPending(false), 450)
                  }}
                  size="lg"
                  variant={currentPlayer?.ready ? 'secondary' : 'default'}
                >
                  {currentPlayer?.ready ? <X aria-hidden="true" className="size-4" /> : <Check aria-hidden="true" className="size-4" />}
                  {currentPlayer?.ready ? 'Cancelar pronto' : 'Estou pronto'}
                </Button>
                {isHost && <Button disabled={!canStart} onClick={() => clientRef.current?.startRace()} size="lg"><Crown aria-hidden="true" className="size-4" /> Iniciar classificação</Button>}
                {isHost && room.state === 'lobby' && <Button onClick={() => void handleClose()} size="lg" variant="destructive"><DoorOpen aria-hidden="true" className="size-4" /> Fechar sala</Button>}
              </div>
            </section>

            <aside className="space-y-5">
              <section className="surface-panel p-5 sm:p-6">
                <div className="mb-5 flex items-center gap-3"><Settings2 aria-hidden="true" className="size-5 text-info" /><div><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-muted-foreground">Configuração</p><h2 className="font-display text-2xl font-black uppercase italic">Resumo da sala</h2></div></div>
                <dl className="space-y-3 text-sm">
                  <div className="flex justify-between gap-4 border-b border-border/60 pb-3"><dt className="text-muted-foreground">Pista</dt><dd className="text-right font-bold">{trackNameFor(trackCatalog, room.trackId)}</dd></div>
                  <div className="flex justify-between gap-4 border-b border-border/60 pb-3"><dt className="text-muted-foreground">Estado</dt><dd className="font-bold">{formatRoomState(room.state)}</dd></div>
                  <div className="flex justify-between gap-4 border-b border-border/60 pb-3"><dt className="text-muted-foreground">Bots</dt><dd className="font-bold">{room.settings?.botsEnabled ? `Ativos · ${room.settings.botDifficulty}` : 'Desativados'}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Host</dt><dd className="font-mono text-xs font-bold">{room.hostName ?? room.hostId.slice(0, 8)}</dd></div>
                </dl>
              </section>

              {isHost && room.state === 'lobby' && !room.settingsLocked && (
                <section className="surface-panel p-5 sm:p-6">
                  <div className="mb-5 flex items-center gap-3"><Settings2 aria-hidden="true" className="size-5 text-primary" /><h2 className="font-display text-2xl font-black uppercase italic">Ajustes do host</h2></div>
                  <div className="space-y-4">
                    <label className="block text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Pista<select className="mt-2 h-11 w-full rounded-[10px] border border-input bg-background/65 px-3 text-sm font-semibold text-foreground" onChange={(event) => setCreateTrackId(event.target.value)} value={createTrackId}>{trackCatalog?.tracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}</select></label>
                    <label className="block text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Limite de carros<Input max={22} min={2} onChange={(event) => setGridSize(event.target.value)} type="number" value={gridSize} /></label>
                    <label className="flex items-center gap-3 text-sm font-semibold"><input checked={botsEnabled} onChange={(event) => setBotsEnabled(event.target.checked)} type="checkbox" /> Habilitar bots</label>
                    {botsEnabled && <label className="block text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Dificuldade<select className="mt-2 h-11 w-full rounded-[10px] border border-input bg-background/65 px-3 text-sm font-semibold text-foreground" onChange={(event) => setBotDifficulty(event.target.value as RoomBotDifficulty)} value={botDifficulty}><option value="easy">Fácil</option><option value="normal">Normal</option><option value="hard">Difícil</option></select></label>}
                    <label className="block text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Visibilidade<select className="mt-2 h-11 w-full rounded-[10px] border border-input bg-background/65 px-3 text-sm font-semibold text-foreground" onChange={(event) => setVisibility(event.target.value as RoomVisibility)} value={visibility}><option value="public">Pública</option><option value="private">Privada</option></select></label>
                    <label className="block text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Nova senha (opcional)<Input minLength={6} onChange={(event) => setRoomPassword(event.target.value)} placeholder="Mínimo de 6 caracteres" type="password" value={roomPassword} /></label>
                    {room.hasPassword && <label className="flex items-center gap-3 text-sm font-semibold"><input checked={clearRoomPassword} onChange={(event) => setClearRoomPassword(event.target.checked)} type="checkbox" /> Remover senha</label>}
                    <Button disabled={settingsSaving} onClick={() => void handleSaveSettings()} variant="secondary">{settingsSaving ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Check aria-hidden="true" className="size-4" />} Salvar ajustes</Button>
                  </div>
                </section>
              )}
            </aside>
          </div>
        </section>
      </AppShell>
    )
  }

  return (
    <AppShell moduleLabel="Lobby online">
      <section className="space-y-7">
        <header className="max-w-3xl">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-info">Online // matchmaking</p>
          <h1 className="display-heading mt-3 text-6xl sm:text-8xl">Entre no lobby.</h1>
          <p className="mt-5 max-w-2xl leading-7 text-muted-foreground">Salas de até 22 pilotos, com a mesma pista e as mesmas regras para todos. Guest e contas podem participar desta etapa.</p>
        </header>
        <GenericError message={error} />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
          <section className="surface-panel p-5 sm:p-7">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-5"><div><p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-muted-foreground">Salas públicas</p><h2 className="mt-1 font-display text-3xl font-black uppercase italic">Encontrar corrida</h2></div><Button aria-label="Atualizar salas" onClick={() => void loadSetup()} size="icon" variant="ghost"><RefreshCw aria-hidden="true" className="size-4" /></Button></div>
            <RoomList onJoin={(code, passwordRequired) => { setJoinCode(code); setJoinPasswordRequired(passwordRequired); setError(null) }} rooms={rooms} trackCatalog={trackCatalog} />
            <div className="mt-6 border-t border-border/70 pt-5">
              <p className="mb-3 text-[10px] font-extrabold uppercase tracking-[0.18em] text-muted-foreground">Entrar por código</p>
              <div className="flex flex-wrap gap-2"><Input aria-label="Código de quatro dígitos" className="max-w-44 font-mono tracking-[0.35em]" inputMode="numeric" maxLength={4} onChange={(event) => setJoinCode(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="0000" value={joinCode} /><Button aria-label="Entrar na sala por código" disabled={submitting || joinCode.length !== 4} onClick={() => void handleJoin()}><DoorOpen aria-hidden="true" className="size-4" /> Entrar</Button></div>
              {(joinPasswordRequired || joinCode.length === 4) && <Input aria-label="Senha da sala" className="mt-3 max-w-sm" onChange={(event) => setJoinPassword(event.target.value)} placeholder="Senha, se a sala exigir" type="password" value={joinPassword} />}
              <p className="mt-3 text-xs text-muted-foreground">Código inválido, sala cheia e senha incorreta usam a mesma mensagem por segurança.</p>
            </div>
          </section>

          <section className="surface-panel p-5 sm:p-7">
            <div className="mb-5 flex items-center gap-3 border-b border-border/70 pb-5"><Plus aria-hidden="true" className="size-5 text-primary" /><div><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-muted-foreground">Host</p><h2 className="mt-1 font-display text-3xl font-black uppercase italic">Criar sala</h2></div></div>
            <div className="space-y-4">
              <label className="block text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Nome curto (opcional)<Input maxLength={40} onChange={(event) => setRoomName(event.target.value)} placeholder="Ex.: Treino de sexta" value={roomName} /></label>
              <label className="block text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Pista<select className="mt-2 h-11 w-full rounded-[10px] border border-input bg-background/65 px-3 text-sm font-semibold text-foreground" onChange={(event) => setCreateTrackId(event.target.value)} value={createTrackId}>{trackCatalog?.tracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}</select></label>
              <label className="block text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Grid de carros<Input max={22} min={2} onChange={(event) => setGridSize(event.target.value)} type="number" value={gridSize} /></label>
              <label className="flex items-center gap-3 text-sm font-semibold"><input checked={botsEnabled} onChange={(event) => setBotsEnabled(event.target.checked)} type="checkbox" /> Habilitar bots (desativado por padrão)</label>
              {botsEnabled && <label className="block text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Dificuldade única<select className="mt-2 h-11 w-full rounded-[10px] border border-input bg-background/65 px-3 text-sm font-semibold text-foreground" onChange={(event) => setBotDifficulty(event.target.value as RoomBotDifficulty)} value={botDifficulty}><option value="easy">Fácil</option><option value="normal">Normal</option><option value="hard">Difícil</option></select></label>}
              <label className="block text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Visibilidade<select className="mt-2 h-11 w-full rounded-[10px] border border-input bg-background/65 px-3 text-sm font-semibold text-foreground" onChange={(event) => setVisibility(event.target.value as RoomVisibility)} value={visibility}><option value="public">Pública</option><option value="private">Privada (somente por código)</option></select></label>
              <label className="block text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Senha (opcional)<Input minLength={6} onChange={(event) => setRoomPassword(event.target.value)} placeholder="Mínimo de 6 caracteres" type="password" value={roomPassword} /></label>
              <Button className="w-full" disabled={submitting || !createTrackId} onClick={() => void handleCreate()} size="lg"><Plus aria-hidden="true" className="size-4" /> {submitting ? 'Criando sala…' : 'Criar sala'}</Button>
            </div>
          </section>
        </div>
        <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" /> O ticket temporário de conexão é emitido antes do WebSocket e nunca expõe seu JWT na URL.</p>
      </section>
    </AppShell>
  )
}
