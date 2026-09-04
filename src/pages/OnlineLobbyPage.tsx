import {
  Check,
  Crown,
  DoorOpen,
  LoaderCircle,
  Lock,
  Plus,
  RefreshCw,
  Settings2,
  ShieldAlert,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Unlock,
  UserRound,
  Users,
  Wifi,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { useAuth } from '@/auth/auth-context'
import { AppShell } from '@/components/AppShell'
import { TrackCarousel } from '@/components/race/TrackCarousel'
import { CountStepper } from '@/components/race/CountStepper'
import { DifficultyButton } from '@/components/race/DifficultyButton'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NotificationStack } from '@/components/ui/notification-stack'
import { useNotifications } from '@/hooks/use-notifications'
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
import { OnlineRoomClient } from '@/online/OnlineRoomClient'
import {
  onlineRoomSession,
  useOnlineRoomSession,
} from '@/online/OnlineRoomSession'
import { roomFromPayload } from '@/online/room-state'

type LobbyApi = Pick<
  typeof onlineApi,
  | 'listRooms'
  | 'createRoom'
  | 'joinRoom'
  | 'getRoom'
  | 'getConnectionTicket'
  | 'updateRoom'
  | 'removePlayer'
  | 'leaveRoom'
  | 'closeRoom'
  | 'startRoom'
  | 'cancelQualification'
>

type LobbyDependencies = {
  api?: LobbyApi
  getTracks?: typeof raceApi.getTracks
  getTrack?: typeof raceApi.getTrack
  createClient?: (options: ConstructorParameters<typeof OnlineRoomClient>[0]) => OnlineRoomClient
}

const defaultClientFactory = (
  options: ConstructorParameters<typeof OnlineRoomClient>[0],
) => new OnlineRoomClient(options)

const GRID_MIN = 2
const GRID_MAX = 22

function trackNameFor(catalog: TrackCatalog | null, trackId: string) {
  return catalog?.tracks.find((track) => track.id === trackId)?.name ?? trackId
}

function formatRoomState(state: RoomState) {
  if (state === 'qualifying') return 'Classificação'
  if (state === 'race') return 'Em corrida'
  if (state === 'closed') return 'Fechada'
  return 'Lobby'
}

function formatDifficulty(value: RoomBotDifficulty) {
  if (value === 'easy') return 'Fácil'
  if (value === 'hard') return 'Difícil'
  return 'Médio'
}

function RoomList({
  rooms,
  onJoin,
  joining,
}: {
  rooms: RoomSummary[]
  onJoin: (code: string) => void
  joining: boolean
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
              <p className="truncate font-extrabold">{room.name || 'Sala online'}</p>
              <p className="mt-1 text-xs font-semibold text-muted-foreground">
                Host <span className="text-foreground">{room.hostName ?? 'Piloto'}</span>
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs font-bold text-muted-foreground">
              <span className="inline-flex items-center gap-1.5" aria-label="Capacidade de jogadores">
                <Users aria-hidden="true" className="size-3.5" />
                {room.participantCount}/{room.limit}
              </span>
              <Button
                disabled={joining || full || room.state !== 'lobby'}
                onClick={() => onJoin(room.code)}
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
  canRemove,
  participantIsHost,
  isCurrentPlayer,
  onRemove,
}: {
  player: RoomParticipant
  canRemove: boolean
  participantIsHost: boolean
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
            {participantIsHost && (
              <span aria-label="Host da sala" className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-warning">
                <Crown aria-hidden="true" className="size-3" /> Host
              </span>
            )}
            {isCurrentPlayer && <span className="ml-2 text-xs font-semibold text-info">Você</span>}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {player.bot ? 'Bot da sala' : player.connected ? 'Conectado' : 'Reconectando'}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {participantIsHost ? (
          <span className="rounded-full border border-warning/30 bg-warning/8 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-warning">
            Controla a largada
          </span>
        ) : (
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
        )}
        {canRemove && !player.bot && !isCurrentPlayer && (
          <Button aria-label={`Remover ${label}`} onClick={onRemove} size="icon" variant="ghost">
            <Trash2 aria-hidden="true" className="size-4 text-destructive" />
          </Button>
        )}
      </div>
    </li>
  )
}

function VisibilityToggle({
  value,
  disabled = false,
  onChange,
}: {
  value: RoomVisibility
  disabled?: boolean
  onChange: (value: RoomVisibility) => void
}) {
  const isPublic = value === 'public'
  return (
    <Button
      aria-label={isPublic ? 'Sala pública; tornar privada' : 'Sala privada; tornar pública'}
      aria-pressed={!isPublic}
      className={isPublic ? 'text-info' : 'text-warning'}
      disabled={disabled}
      onClick={() => onChange(isPublic ? 'private' : 'public')}
      size="icon"
      title={isPublic ? 'Sala pública' : 'Sala privada'}
      type="button"
      variant="secondary"
    >
      {isPublic ? <Unlock aria-hidden="true" className="size-4" /> : <Lock aria-hidden="true" className="size-4" />}
    </Button>
  )
}

function settingsSignature(settings: RoomSettingsUpdate) {
  return JSON.stringify(settings)
}

export function OnlineLobbyPage({
  api = onlineApi,
  getTracks = raceApi.getTracks,
  getTrack = raceApi.getTrack,
  createClient = defaultClientFactory,
}: LobbyDependencies = {}) {
  const { session, isGuest, isUser, startGuestSession } = useAuth()
  const navigate = useNavigate()
  const { roomCode: routeRoomCode } = useParams()
  const roomCode = routeRoomCode?.toUpperCase() ?? null
  const isLobby = Boolean(roomCode)
  const requestedGuest = useRef(false)
  const settingsTimer = useRef<number | null>(null)
  const lastSentSettings = useRef('')
  const onlineSession = useOnlineRoomSession()
  const room = onlineSession.roomCode === roomCode ? onlineSession.room : null
  const clientStatus = onlineSession.roomCode === roomCode ? onlineSession.status : 'idle'
  const { notifications, notify, dismiss } = useNotifications()

  const [trackCatalog, setTrackCatalog] = useState<TrackCatalog | null>(null)
  const [rooms, setRooms] = useState<RoomSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [roomsRefreshing, setRoomsRefreshing] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const [roomName, setRoomName] = useState('')
  const [gridSize, setGridSize] = useState('22')
  const [selectedTrackId, setSelectedTrackId] = useState('')
  const [botsEnabled, setBotsEnabled] = useState(false)
  const [botDifficulty, setBotDifficulty] = useState<RoomBotDifficulty>('normal')
  const [visibility, setVisibility] = useState<RoomVisibility>('public')
  const [submitting, setSubmitting] = useState(false)
  const [readyPending, setReadyPending] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)

  const genericEntryError = 'Não foi possível entrar nessa sala. Confira o código e a disponibilidade.'
  const gridError = 'O limite de carros deve estar entre 2 e 22.'

  const ensureSession = useCallback(() => {
    if (session || requestedGuest.current) return
    requestedGuest.current = true
    startGuestSession().catch((sessionError: unknown) => {
      requestedGuest.current = false
      notify(getErrorMessage(sessionError))
    })
  }, [notify, session, startGuestSession])

  useEffect(() => {
    ensureSession()
  }, [ensureSession])

  useEffect(() => {
    if (!isGuest || !isLobby) return
    navigate('/race/setup?mode=online', { replace: true })
  }, [isGuest, isLobby, navigate])

  const normalizeRooms = useCallback((payload: RoomSummary[]) => (
    payload.map((item) => roomFromPayload(item, item.code)).filter((item): item is RoomSummary => item !== null)
  ), [])

  const refreshRooms = useCallback(async () => {
    if (!session || !isUser || isLobby) return
    setRoomsRefreshing(true)
    try {
      setRooms(normalizeRooms(await api.listRooms(session.token)))
    } catch (loadError: unknown) {
      notify(getErrorMessage(loadError))
    } finally {
      setRoomsRefreshing(false)
    }
  }, [api, isLobby, isUser, normalizeRooms, notify, session])

  useEffect(() => {
    if (isLobby || !session) return
    if (!isUser) {
      setLoading(false)
      return
    }
    let disposed = false
    setLoading(true)
    Promise.all([getTracks(), api.listRooms(session.token)])
      .then(([catalog, publicRooms]) => {
        if (disposed) return
        setTrackCatalog(catalog)
        setSelectedTrackId((current) => current || catalog.tracks[0]?.id || '')
        setRooms(normalizeRooms(publicRooms))
      })
      .catch((loadError: unknown) => {
        if (!disposed) notify(getErrorMessage(loadError))
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [api, getTracks, isLobby, isUser, normalizeRooms, notify, session])

  useEffect(() => {
    if (!isLobby || !roomCode || !session || !isUser) return
    let disposed = false
    setLoading(true)
    const loadLobby = async () => {
      try {
        const [catalog, initialRoom] = await Promise.all([
          getTracks(),
          api.getRoom(roomCode, session.token),
        ])
        if (disposed) return
        const normalized = roomFromPayload(initialRoom, roomCode)
        if (!normalized) throw new Error('A resposta da sala é inválida.')
        setTrackCatalog(catalog)
        setGridSize(String(normalized.limit))
        setSelectedTrackId(normalized.trackId)
        setBotsEnabled(normalized.settings?.botsEnabled === true)
        setBotDifficulty(normalized.settings?.botDifficulty ?? 'normal')
        setVisibility(normalized.settings?.visibility ?? 'public')
        lastSentSettings.current = settingsSignature({
          trackId: normalized.trackId,
          gridSize: normalized.limit,
          botsEnabled: normalized.settings?.botsEnabled === true,
          botDifficulty: normalized.settings?.botDifficulty ?? 'normal',
          visibility: normalized.settings?.visibility ?? 'public',
        })
        await onlineRoomSession.connect({
          roomCode,
          initialRoom: normalized,
          trackCatalogVersion: catalog.catalogVersion,
          physicsContractVersion: catalog.physicsContractVersion,
          getTicket: () => api.getConnectionTicket(roomCode, session.token),
          createClient,
        })
      } catch {
        if (!disposed) notify(genericEntryError)
      } finally {
        if (!disposed) setLoading(false)
      }
    }
    void loadLobby()
    return () => {
      disposed = true
    }
  }, [api, createClient, genericEntryError, getTracks, isLobby, isUser, notify, roomCode, session])

  useEffect(() => {
    if (!isLobby || onlineSession.roomCode || !onlineSession.error) return
    notify(
      onlineSession.error.code === 'removed_from_room'
        ? 'Você foi removido da sala pelo host.'
        : onlineSession.error.code === 'room_closed'
          ? 'A sala foi encerrada pelo host.'
          : genericEntryError,
    )
    onlineRoomSession.clearError()
    navigate('/race/setup?mode=online', { replace: true })
  }, [genericEntryError, isLobby, navigate, notify, onlineSession.error, onlineSession.roomCode])

  useEffect(() => {
    if (isLobby || !onlineSession.error) return
    notify(
      onlineSession.error.code === 'removed_from_room'
        ? 'Você foi removido da sala pelo host.'
        : onlineSession.error.code === 'room_closed'
          ? 'A sala foi encerrada pelo host.'
          : onlineSession.error.message || genericEntryError,
    )
    onlineRoomSession.clearError()
  }, [genericEntryError, isLobby, notify, onlineSession.error])

  const currentPlayer = useMemo(() => {
    if (!room || !session) return null
    return room.players?.find((player) =>
      session.subject ? player.userId === session.subject || player.id === session.subject : false,
    ) ?? null
  }, [room, session])
  const isHost = Boolean(room && session && (room.hostId === session.subject || room.hostId === currentPlayer?.id))

  useEffect(() => {
    if (!room || isHost) return
    setGridSize(String(room.limit))
    setSelectedTrackId(room.trackId)
    setBotsEnabled(room.settings?.botsEnabled === true)
    setBotDifficulty(room.settings?.botDifficulty ?? 'normal')
    setVisibility(room.settings?.visibility ?? 'public')
  }, [isHost, room])

  const draftSettings = useMemo<RoomSettingsUpdate>(() => ({
    trackId: selectedTrackId,
    gridSize: Number(gridSize),
    botsEnabled,
    botDifficulty,
    visibility,
  }), [botDifficulty, botsEnabled, gridSize, selectedTrackId, visibility])

  const persistSettings = useCallback(async (force = false) => {
    if (!room || !session || !isHost || room.state !== 'lobby') return true
    const parsedGrid = Number(gridSize)
    if (!Number.isInteger(parsedGrid) || parsedGrid < GRID_MIN || parsedGrid > GRID_MAX) {
      notify(gridError)
      return false
    }
    const changes = { ...draftSettings, gridSize: parsedGrid }
    const signature = settingsSignature(changes)
    if (!force && lastSentSettings.current === signature) return true
    lastSentSettings.current = signature
    setSettingsSaving(true)
    try {
      const updated = await api.updateRoom(room.code, changes, session.token)
      const normalized = roomFromPayload(updated, room.code, room)
      if (normalized) onlineRoomSession.setRoom(normalized)
      return true
    } catch (saveError: unknown) {
      lastSentSettings.current = ''
      notify(getErrorMessage(saveError))
      return false
    } finally {
      setSettingsSaving(false)
    }
  }, [api, draftSettings, gridError, gridSize, isHost, notify, room, session])

  useEffect(() => {
    if (!room || !isHost || room.state !== 'lobby') return
    const signature = settingsSignature(draftSettings)
    if (
      signature === lastSentSettings.current ||
      typeof draftSettings.gridSize !== 'number' ||
      !Number.isInteger(draftSettings.gridSize) ||
      draftSettings.gridSize < GRID_MIN ||
      draftSettings.gridSize > GRID_MAX
    ) return
    if (settingsTimer.current !== null) window.clearTimeout(settingsTimer.current)
    settingsTimer.current = window.setTimeout(() => {
      settingsTimer.current = null
      void persistSettings()
    }, 350)
    return () => {
      if (settingsTimer.current !== null) window.clearTimeout(settingsTimer.current)
    }
  }, [draftSettings, isHost, persistSettings, room])

  const nonHostHumansReady = Boolean(
    room?.players
      ?.filter((player) => !player.bot && player.userId !== room.hostId && player.id !== room.hostId)
      .every((player) => player.ready),
  )
  const minimumGridReached = Boolean(
    room && (room.participantCount >= 2 || room.settings?.botsEnabled === true),
  )
  const canStart = Boolean(
    room && isHost && room.state === 'lobby' && minimumGridReached && nonHostHumansReady && !settingsSaving,
  )

  const handleJoin = useCallback(async (code = joinCode) => {
    const normalizedCode = code.replace(/\D/g, '').slice(0, 4)
    if (!/^\d{4}$/.test(normalizedCode)) {
      notify(genericEntryError)
      return
    }
    if (!session || !isUser) return
    setSubmitting(true)
    try {
      const joined = await api.joinRoom(normalizedCode, session.token)
      const target = roomFromPayload(joined, normalizedCode)?.code ?? normalizedCode
      navigate(`/race/lobby/${target}`)
    } catch {
      notify(genericEntryError)
    } finally {
      setSubmitting(false)
    }
  }, [api, genericEntryError, isUser, joinCode, navigate, notify, session])

  const handleCreate = useCallback(async () => {
    if (!session || !isUser) return
    setSubmitting(true)
    const request: CreateRoomRequest = {
      name: roomName.trim() || undefined,
      visibility,
    }
    try {
      const created = await api.createRoom(request, session.token)
      const target = roomFromPayload(created, '0000')?.code
      if (!target) throw new Error('A resposta da sala não trouxe um código válido.')
      navigate(`/race/lobby/${target}`)
    } catch (createError: unknown) {
      notify(getErrorMessage(createError))
    } finally {
      setSubmitting(false)
    }
  }, [api, isUser, navigate, notify, roomName, session, visibility])

  const handleGridChange = useCallback(
    (rawValue: string) => {
      const digits = rawValue.replace(/\D/g, '')
      if (!digits) {
        setGridSize('')
        return
      }
      const value = Number(digits)
      if (value > GRID_MAX) {
        setGridSize(String(GRID_MAX))
        notify(gridError)
      } else {
        // Allow a leading 1 while typing 10–19; normalize the lower bound on blur.
        // Incomplete drafts are never sent by the autosave effect.
        setGridSize(String(value))
      }
    },
    [gridError, notify],
  )

  const adjustGrid = useCallback(
    (change: number) => {
      const value = Math.min(
        GRID_MAX,
        Math.max(GRID_MIN, (Number(gridSize) || GRID_MIN) + change),
      )
      setGridSize(String(value))
    },
    [gridSize],
  )

  const handleRemove = useCallback(async (playerId: string) => {
    if (!room || !session || !isHost) return
    try {
      const updated = await api.removePlayer(room.code, playerId, session.token)
      const normalized = roomFromPayload(updated, room.code, room)
      if (normalized) onlineRoomSession.setRoom(normalized)
    } catch (removeError: unknown) {
      notify(getErrorMessage(removeError))
    }
  }, [api, isHost, notify, room, session])

  const handleClose = useCallback(async () => {
    if (!room || !session || !isHost) return
    try {
      await api.closeRoom(room.code, session.token)
      onlineRoomSession.disconnect()
      navigate('/race/setup?mode=online', { replace: true })
    } catch (closeError: unknown) {
      notify(getErrorMessage(closeError))
    }
  }, [api, isHost, navigate, notify, room, session])

  const handleLeave = useCallback(async () => {
    if (!room || !session) return
    setSubmitting(true)
    try {
      await api.leaveRoom(room.code, session.token)
      onlineRoomSession.disconnect()
      navigate('/race/setup?mode=online', { replace: true })
    } catch (leaveError: unknown) {
      notify(getErrorMessage(leaveError))
    } finally {
      setSubmitting(false)
    }
  }, [api, navigate, notify, room, session])

  const handleStart = useCallback(async () => {
    if (!room || !session || !isHost || !canStart) return
    if (settingsTimer.current !== null) window.clearTimeout(settingsTimer.current)
    setSubmitting(true)
    try {
      if (!(await persistSettings(true))) return
      const started = await api.startRoom(room.code, session.token)
      const normalized = roomFromPayload(started, room.code)
      if (normalized) onlineRoomSession.setRoom(normalized)
    } catch (startError: unknown) {
      notify(getErrorMessage(startError))
    } finally {
      setSubmitting(false)
    }
  }, [api, canStart, isHost, notify, persistSettings, room, session])

  const handleCancelQualification = useCallback(async () => {
    if (!room || !session || !isHost || room.state !== 'qualifying') return
    setSubmitting(true)
    try {
      const cancelled = await api.cancelQualification(room.code, session.token)
      const normalized = roomFromPayload(cancelled, room.code)
      if (normalized) onlineRoomSession.setRoom(normalized)
      notify('Classificação cancelada. A sala voltou ao lobby.', 'success')
    } catch (cancelError: unknown) {
      notify(getErrorMessage(cancelError))
    } finally {
      setSubmitting(false)
    }
  }, [api, isHost, notify, room, session])

  if (!session || loading) {
    return (
      <AppShell moduleLabel="Lobby online">
        <NotificationStack notifications={notifications} onDismiss={dismiss} />
        <div className="grid min-h-[50vh] place-items-center text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-3"><LoaderCircle aria-hidden="true" className="size-5 animate-spin text-info" /> Preparando conexão online…</span>
        </div>
      </AppShell>
    )
  }

  if (isLobby && room) {
    const players = room.players ?? []
    const humanCount = players.filter((player) => !player.bot).length
    const actualBotCount = players.filter((player) => player.bot).length
    const configuredBotCount = room.settings?.botsEnabled ? Math.max(0, room.limit - humanCount) : 0
    const botCount = Math.max(actualBotCount, configuredBotCount)
    const settingsDisabled = room.state !== 'lobby'
    return (
      <AppShell moduleLabel={`Lobby // ${room.code}`}>
        <NotificationStack notifications={notifications} onDismiss={dismiss} />
        <section className="space-y-7">
          <header className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-info">Sala online</p>
              <h1 className="display-heading mt-3 text-6xl sm:text-8xl">{room.name}</h1>
              <p className="mt-4 text-sm text-muted-foreground">{trackNameFor(trackCatalog, room.trackId)} · grid {room.limit}</p>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-2 text-xs font-bold">
              <span className={`size-2 rounded-full ${clientStatus === 'connected' ? 'bg-success shadow-[0_0_10px_var(--success)]' : clientStatus === 'reconnecting' ? 'bg-warning' : 'bg-muted-foreground'}`} />
              {clientStatus === 'connected' ? 'Conectado' : clientStatus === 'reconnecting' ? 'Reconectando' : 'Conexão pendente'}
            </div>
          </header>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.78fr)]">
            <section className="surface-panel p-5 sm:p-7">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-5">
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-muted-foreground">Pilotos</p>
                  <h2 className="mt-1 font-display text-3xl font-black uppercase italic">{players.length}/{room.limit}</h2>
                </div>
                <span className="inline-flex items-center gap-2 text-xs font-bold text-muted-foreground"><Users aria-hidden="true" className="size-4 text-info" /> {nonHostHumansReady ? 'Convidados prontos' : 'Aguardando convidados'}</span>
              </div>
              <ul className="space-y-2">
                {players.map((player) => (
                  <LobbyPlayer
                    canRemove={isHost && room.state === 'lobby'}
                    isCurrentPlayer={player.id === currentPlayer?.id || player.userId === session.subject}
                    key={player.id}
                    onRemove={() => void handleRemove(player.id)}
                    participantIsHost={player.userId === room.hostId || player.id === room.hostId}
                    player={player}
                  />
                ))}
              </ul>
              {players.length < 2 && !room.settings?.botsEnabled && <p className="mt-4 text-xs font-semibold text-warning">São necessários pelo menos dois carros para iniciar.</p>}
              <div className="mt-6 flex flex-wrap gap-3 border-t border-border/70 pt-5">
                {!isHost && (
                  <Button
                    disabled={!currentPlayer || readyPending || clientStatus !== 'connected' || room.state !== 'lobby'}
                    onClick={() => {
                      setReadyPending(true)
                      onlineRoomSession.setReady(!currentPlayer?.ready)
                      window.setTimeout(() => setReadyPending(false), 450)
                    }}
                    size="lg"
                    variant={currentPlayer?.ready ? 'secondary' : 'default'}
                  >
                    {currentPlayer?.ready ? <ToggleRight aria-hidden="true" className="size-4" /> : <ToggleLeft aria-hidden="true" className="size-4" />}
                    {currentPlayer?.ready ? 'Retirar pronto' : 'Estou pronto'}
                  </Button>
                )}
                {isHost && room.state === 'lobby' && <Button disabled={!canStart || submitting} onClick={() => void handleStart()} size="lg"><Crown aria-hidden="true" className="size-4" /> Iniciar classificação</Button>}
                {isHost && room.state === 'qualifying' && <Button disabled={submitting} onClick={() => void handleCancelQualification()} size="lg" variant="secondary"><RefreshCw aria-hidden="true" className="size-4" /> Cancelar classificação</Button>}
                <AlertDialog>
                  <AlertDialogTrigger asChild><Button size="lg" variant="secondary"><DoorOpen aria-hidden="true" className="size-4" /> Sair da sala</Button></AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader><AlertDialogTitle>Sair de {room.name}?</AlertDialogTitle><AlertDialogDescription>Deseja realmente sair da sala {room.name}? Sua vaga será liberada para outro piloto.</AlertDialogDescription></AlertDialogHeader>
                    <AlertDialogFooter><AlertDialogCancel>Continuar na sala</AlertDialogCancel><AlertDialogAction onClick={() => void handleLeave()}>Sair da sala</AlertDialogAction></AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                {isHost && room.state === 'lobby' && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild><Button size="lg" variant="destructive"><Trash2 aria-hidden="true" className="size-4" /> Fechar sala</Button></AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader><AlertDialogTitle>Encerrar {room.name}?</AlertDialogTitle><AlertDialogDescription>A sala será fechada para todos. Se quiser transferir o host, use “Sair da sala”.</AlertDialogDescription></AlertDialogHeader>
                      <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => void handleClose()}>Fechar sala para todos</AlertDialogAction></AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </section>

            <aside>
              {isHost ? (
                <section className="surface-panel p-5 sm:p-6">
                  <div className="mb-5 flex items-center justify-between gap-3 border-b border-border/70 pb-4">
                    <div className="flex items-center gap-3"><Settings2 aria-hidden="true" className="size-5 text-primary" /><h2 className="font-display text-2xl font-black uppercase italic">Ajustes</h2></div>
                    <span className="rounded-lg border border-info/30 bg-info/8 px-3 py-1.5 font-mono text-sm font-black tracking-[0.22em] text-info" aria-label={`Código da sala ${room.code}`}>{room.code}</span>
                  </div>
                  <div className="space-y-5">
                    <TrackCarousel catalog={trackCatalog} disabled={settingsDisabled} getTrack={getTrack} onLoadError={notify} onSelect={setSelectedTrackId} selectedId={selectedTrackId} />
                    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <div>
                        <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-muted-foreground">
                          Limite de carros
                        </p>
                        <CountStepper
                          disabled={settingsDisabled}
                          label="Limite de carros"
                          maximum={GRID_MAX}
                          minimum={GRID_MIN}
                          onDecrease={() => adjustGrid(-1)}
                          onIncrease={() => adjustGrid(1)}
                          onValueChange={handleGridChange}
                          onBlur={() => {
                            if (Number(gridSize) < GRID_MIN) {
                              setGridSize(String(GRID_MIN))
                              notify(gridError)
                            }
                          }}
                          value={gridSize}
                        />
                      </div>
                      <div>
                        <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-muted-foreground">
                          Dificuldade
                        </p>
                        <DifficultyButton
                          disabled={settingsDisabled || !botsEnabled}
                          onChange={setBotDifficulty}
                          value={botDifficulty}
                        />
                      </div>
                    </div>
                    <label className="flex items-center gap-3 text-sm font-semibold"><input checked={botsEnabled} disabled={settingsDisabled} onChange={(event) => setBotsEnabled(event.target.checked)} type="checkbox" /> Habilitar bots</label>
                    <div className="flex items-center justify-between gap-3"><span className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Visibilidade</span><VisibilityToggle disabled={settingsDisabled} onChange={setVisibility} value={visibility} /></div>
                    {settingsSaving && <p className="inline-flex items-center gap-2 text-xs font-semibold text-info"><LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> Sincronizando ajustes…</p>}
                    {settingsDisabled && <p className="rounded-xl border border-warning/30 bg-warning/8 p-3 text-xs leading-5 text-warning">Os ajustes ficam bloqueados durante a classificação. Cancele antes do primeiro carro andar para voltar ao lobby.</p>}
                  </div>
                </section>
              ) : (
                <section className="surface-panel p-5 sm:p-6">
                  <div className="mb-5 flex items-center justify-between gap-3 border-b border-border/70 pb-4">
                    <div className="flex items-center gap-3"><Settings2 aria-hidden="true" className="size-5 text-info" /><h2 className="font-display text-2xl font-black uppercase italic">Resumo da sala</h2></div>
                    <span className="rounded-lg border border-info/30 bg-info/8 px-3 py-1.5 font-mono text-sm font-black tracking-[0.22em] text-info" aria-label={`Código da sala ${room.code}`}>{room.code}</span>
                  </div>
                  <dl className="space-y-3 text-sm">
                    <div className="flex justify-between gap-4 border-b border-border/60 pb-3"><dt className="text-muted-foreground">Pista</dt><dd className="text-right font-bold">{trackNameFor(trackCatalog, room.trackId)}</dd></div>
                    <div className="flex justify-between gap-4 border-b border-border/60 pb-3"><dt className="text-muted-foreground">Estado</dt><dd className="font-bold">{formatRoomState(room.state)}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Bots</dt><dd className="text-right font-bold">{room.settings?.botsEnabled ? `Ativos · ${botCount} · ${formatDifficulty(room.settings.botDifficulty)}` : 'Inativos · 0'}</dd></div>
                  </dl>
                </section>
              )}
            </aside>
          </div>
        </section>
      </AppShell>
    )
  }

  const setupContent = (
    <section className="space-y-7">
      <header className="max-w-3xl">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-info">Online // matchmaking</p>
        <h1 className="display-heading mt-3 text-6xl sm:text-8xl">Entre no lobby.</h1>
        <p className="mt-5 max-w-2xl leading-7 text-muted-foreground">Salas de até 22 pilotos, com a mesma pista e as mesmas regras para todos.</p>
      </header>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
        <section className="surface-panel p-5 sm:p-7">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-5"><div><p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-muted-foreground">Salas públicas</p><h2 className="mt-1 font-display text-3xl font-black uppercase italic">Encontrar corrida</h2></div><Button aria-label="Atualizar salas" disabled={roomsRefreshing} onClick={() => void refreshRooms()} size="icon" variant="ghost"><RefreshCw aria-hidden="true" className={`size-4 ${roomsRefreshing ? 'animate-spin' : ''}`} /></Button></div>
          <RoomList joining={submitting} onJoin={(code) => void handleJoin(code)} rooms={rooms} />
          <div className="mt-6 border-t border-border/70 pt-5">
            <p className="mb-3 text-[10px] font-extrabold uppercase tracking-[0.18em] text-muted-foreground">Entrar em sala privada</p>
            <div className="flex flex-wrap gap-2"><Input aria-label="Código de quatro dígitos" className="max-w-44 font-mono tracking-[0.35em]" inputMode="numeric" maxLength={4} onChange={(event) => setJoinCode(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="0000" value={joinCode} /><Button aria-label="Entrar na sala por código" disabled={submitting || joinCode.length !== 4} onClick={() => void handleJoin()}><DoorOpen aria-hidden="true" className="size-4" /> Entrar</Button></div>
            <p className="mt-3 text-xs text-muted-foreground">O código de quatro dígitos é a chave de acesso. Código inválido e sala indisponível usam a mesma mensagem.</p>
          </div>
        </section>

        <section className="surface-panel p-5 sm:p-7">
          <div className="mb-5 flex items-center gap-3 border-b border-border/70 pb-5"><Plus aria-hidden="true" className="size-5 text-primary" /><div><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-muted-foreground">Host</p><h2 className="mt-1 font-display text-3xl font-black uppercase italic">Criar sala</h2></div></div>
          <div className="space-y-4">
            <label className="block text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Nome curto (opcional)<Input maxLength={40} onChange={(event) => setRoomName(event.target.value)} placeholder="Ex.: Treino de sexta" value={roomName} /></label>
            <div className="flex items-center justify-between gap-3"><span className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Visibilidade</span><VisibilityToggle onChange={setVisibility} value={visibility} /></div>
            <Button className="w-full" disabled={submitting} onClick={() => void handleCreate()} size="lg"><Plus aria-hidden="true" className="size-4" /> {submitting ? 'Criando sala…' : 'Criar sala'}</Button>
          </div>
        </section>
      </div>
      <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" /> Salas públicas permitem entrada direta; salas privadas são acessadas somente pelo código exibido dentro do lobby.</p>
    </section>
  )

  return (
    <AppShell moduleLabel="Lobby online">
      <NotificationStack notifications={notifications} onDismiss={dismiss} />
      {isGuest ? (
        <div className="relative min-h-[34rem]">
          <div aria-hidden="true" className="pointer-events-none select-none opacity-35 blur-[2px]">{setupContent}</div>
          <div className="absolute inset-0 z-10 grid place-items-start bg-background/20 pt-28 sm:place-items-center sm:pt-0">
            <div className="surface-panel mx-4 max-w-md border-info/35 p-7 text-center shadow-2xl">
              <Lock aria-hidden="true" className="mx-auto size-8 text-info" />
              <h2 className="mt-4 font-display text-3xl font-black uppercase italic">Login necessário</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">Você pode conhecer as formas de entrada, mas precisa entrar em uma conta para acessar o modo online.</p>
              <Button className="mt-6" onClick={() => navigate('/login')} size="lg"><UserRound aria-hidden="true" className="size-4" /> Fazer login</Button>
            </div>
          </div>
        </div>
      ) : setupContent}
    </AppShell>
  )
}
