import type {
  RoomBotDifficulty,
  RoomParticipant,
  RoomState,
  RoomSummary,
} from '@/lib/api'

export const DEFAULT_TRACK_CATALOG_VERSION = '2026.12'
export const DEFAULT_PHYSICS_CONTRACT_VERSION = '2.0.0'

function normalizeState(value: unknown): RoomState {
  const state = String(value ?? 'lobby').toLowerCase()
  if (state === 'qualifying' || state === 'race' || state === 'closed') return state
  return 'lobby'
}

export function normalizeDifficulty(value: unknown): RoomBotDifficulty {
  const difficulty = String(value ?? 'normal').toLowerCase()
  return difficulty === 'easy' || difficulty === 'hard' ? difficulty : 'normal'
}

function participantFrom(
  value: unknown,
  readyStates?: Record<string, boolean>,
): RoomParticipant | null {
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
    displayName: typeof source.displayName === 'string' ? source.displayName : null,
    gamertag: typeof source.gamertag === 'string' ? source.gamertag : null,
    bot: source.bot === true || source.isBot === true || source.kind === 'bot',
    ready,
    connected: source.connected !== false,
    color: typeof source.color === 'string' ? source.color : null,
    joinedAt: typeof source.joinedAt === 'string' ? source.joinedAt : undefined,
  }
}

export function roomFromPayload(
  payload: unknown,
  fallbackCode: string,
  previous?: RoomSummary | null,
): RoomSummary | null {
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
    : previous?.players ?? []
  const code = String(nested.code ?? nested.roomCode ?? previous?.code ?? fallbackCode)
  const trackId = String(
    nested.trackId ?? settingsSource.trackId ?? previous?.trackId ?? '',
  )
  if (!trackId) return null
  const gridSize = Number(
    nested.limit ?? settingsSource.gridSize ?? previous?.limit ?? 22,
  )
  const visibility =
    String(
      nested.visibility ??
        settingsSource.visibility ??
        previous?.settings?.visibility ??
        'public',
    ).toLowerCase() === 'private'
      ? 'private'
      : 'public'
  const settingsLocked =
    nested.settingsLocked === true ||
    settingsSource.settingsLocked === true ||
    previous?.settingsLocked === true

  return {
    code,
    name: String(nested.name ?? previous?.name ?? 'Sala online'),
    hostId: String(nested.hostId ?? previous?.hostId ?? ''),
    hostName:
      typeof nested.hostName === 'string'
        ? nested.hostName
        : previous?.hostName ?? null,
    trackId,
    trackName:
      typeof nested.trackName === 'string'
        ? nested.trackName
        : previous?.trackName ?? null,
    trackCatalogVersion: String(
      nested.trackCatalogVersion ??
        settingsSource.trackCatalogVersion ??
        previous?.trackCatalogVersion ??
        DEFAULT_TRACK_CATALOG_VERSION,
    ),
    physicsContractVersion: String(
      nested.physicsContractVersion ??
        settingsSource.physicsContractVersion ??
        previous?.physicsContractVersion ??
        DEFAULT_PHYSICS_CONTRACT_VERSION,
    ),
    participantCount: Number(nested.participantCount ?? players.length),
    limit: Number.isFinite(gridSize) ? gridSize : 22,
    state: normalizeState(nested.state ?? previous?.state),
    hasPassword: nested.hasPassword === true || settingsSource.passwordRequired === true,
    settingsLocked,
    settings: {
      trackId,
      trackCatalogVersion: String(
        settingsSource.trackCatalogVersion ??
          previous?.settings?.trackCatalogVersion ??
          DEFAULT_TRACK_CATALOG_VERSION,
      ),
      physicsContractVersion: String(
        settingsSource.physicsContractVersion ??
          previous?.settings?.physicsContractVersion ??
          DEFAULT_PHYSICS_CONTRACT_VERSION,
      ),
      gridSize: Number.isFinite(gridSize) ? gridSize : 22,
      botsEnabled:
        typeof settingsSource.botsEnabled === 'boolean'
          ? settingsSource.botsEnabled
          : previous?.settings?.botsEnabled === true,
      botDifficulty: normalizeDifficulty(
        settingsSource.botDifficulty ?? previous?.settings?.botDifficulty,
      ),
      visibility,
      settingsLocked,
      passwordRequired:
        nested.hasPassword === true || settingsSource.passwordRequired === true,
    },
    players,
  }
}
