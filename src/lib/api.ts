import type {
  Account,
  AccountChanges,
  LoginCredentials,
  RegisterCredentials,
  TokenResponse,
} from '@/lib/auth-types'

type ApiErrorPayload = {
  code?: string
  message?: string
  fieldErrors?: Record<string, string>
}

export class ApiError extends Error {
  status: number
  code?: string
  fieldErrors: Record<string, string>

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message || `A API respondeu com HTTP ${status}.`)
    this.name = 'ApiError'
    this.status = status
    this.code = payload.code
    this.fieldErrors = payload.fieldErrors ?? {}
  }
}

function apiBaseUrl() {
  const configuredUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, '')

  if (!configuredUrl) {
    throw new Error('VITE_API_URL não está configurada.')
  }

  return configuredUrl
}

async function parsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''

  if (response.status === 204 || !contentType.includes('application/json')) {
    return undefined
  }

  return response.json()
}

async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')

  if (init.body) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers,
  })
  const payload = await parsePayload(response)

  if (!response.ok) {
    const errorPayload =
      typeof payload === 'object' && payload !== null
        ? (payload as ApiErrorPayload)
        : {}
    throw new ApiError(response.status, errorPayload)
  }

  return payload as T
}

export const authApi = {
  guest: () =>
    apiRequest<TokenResponse>('/auth/guest', {
      method: 'POST',
    }),
  login: (credentials: LoginCredentials) =>
    apiRequest<TokenResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    }),
  register: (credentials: RegisterCredentials) =>
    apiRequest<TokenResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        gamertag: credentials.gamertag,
        displayName: credentials.displayName,
        password: credentials.password,
      }),
    }),
}

export const accountApi = {
  get: (token?: string) => apiRequest<Account>('/account/me', {}, token),
  update: (changes: AccountChanges, token?: string) =>
    apiRequest<Account>(
      '/account/me',
      {
        method: 'PATCH',
        body: JSON.stringify(changes),
      },
      token,
    ),
  delete: (currentPassword: string, token?: string) =>
    apiRequest<void>(
      '/account/me',
      {
        method: 'DELETE',
        body: JSON.stringify({ currentPassword }),
      },
      token,
    ),
}

export type LocalRaceResultRequest = {
  trackId: string
  trackCatalogVersion: string
  mode: 'solo' | 'local'
  results: Array<{
    userIdOrNull: string | null
    position: number
    totalTimeMs: number
    bestLapTimeMs: number
    finished: boolean
  }>
}

export type LocalRaceResultResponse = {
  persistedCount: number
  resultIds: string[]
}

export type TrackVector = {
  x: number
  y: number
}

export type TrackBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export type TrackCatalogEntry = {
  round: number
  id: string
  name: string
  countryCode: string
  countryName: string
  locality: string
  lengthMeters: number
  definitionPath: string
}

export type TrackCatalog = {
  schemaVersion: '1.2.0'
  catalogVersion: string
  seasonReference: 2026
  calendarPolicy?: 'original-24-round-freeze'
  tracks: TrackCatalogEntry[]
}

export type TrackPathPoint = TrackVector & {
  distanceMeters: number
  halfWidthMeters: number
  elevationLayer: number
}

export type TrackRacingPoint = TrackVector & {
  distanceMeters: number
  targetSpeedFactor: number
}

export type TrackGate = {
  index: number
  distanceMeters: number
  position: TrackVector
  forward: TrackVector
  halfWidthMeters: number
}

export type TrackGridSlot = {
  position: TrackVector
  angle: number
}

export type TrackChunk = {
  index: number
  fromDistanceMeters: number
  toDistanceMeters: number
  bounds: TrackBounds
}

export type TrackSceneryObject = {
  id: string
  kind: string
  position: TrackVector
  rotation: number
  scale: number
}

export type TrackSurfaceMaterial = 'asphalt' | 'grass' | 'gravel'

export type TrackBarrierType =
  | 'concrete-wall'
  | 'guardrail'
  | 'tecpro'
  | 'tyre-barrier'

export type TrackFenceType = 'debris-fence'

export type TrackSideEnvironment = {
  zones: Array<{
    surface: TrackSurfaceMaterial
    widthMeters: number
  }>
  barrier: TrackBarrierType
  fence?: TrackFenceType
}

export type TrackLimitSegment = {
  index: number
  fromDistanceMeters: number
  toDistanceMeters: number
  left: TrackSideEnvironment
  right: TrackSideEnvironment
}

export type TrackDefinition = {
  schemaVersion: '1.2.0'
  catalogVersion: string
  id: string
  name: string
  countryCode: string
  locality: string
  lengthMeters: number
  coordinateSystem: {
    unit: 'meter'
    xAxis: 'right'
    yAxis: 'up'
    angleUnit: 'radian'
    angleDirection: 'counterclockwise'
    angleOrigin: '+x'
  }
  bounds: TrackBounds
  centerline: TrackPathPoint[]
  racingLine: TrackRacingPoint[]
  startFinish: TrackGate
  gridSlots: TrackGridSlot[]
  checkpoints: TrackGate[]
  pitLane: {
    entryDistanceMeters: number
    exitDistanceMeters: number
    speedLimitMetersPerSecond: number
    path: TrackVector[]
  }
  surfaceModel: {
    onTrack: 'asphalt'
    pitLane: 'pit-lane'
  }
  trackLimits: {
    segments: TrackLimitSegment[]
  }
  chunks: TrackChunk[]
  sceneryLayout: {
    preset: 'park' | 'street' | 'desert' | 'coastal' | 'classic' | 'night-city'
    landmarks: TrackSceneryObject[]
    staticObjects: TrackSceneryObject[]
  }
  source: {
    dataset: string
    license: string
    url: string
    transformation: string
    environmentReferences: Array<{
      label: string
      url: string
      checkedAt: string
    }>
  }
}

function compatibleTrackCatalog(payload: unknown): TrackCatalog {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('schemaVersion' in payload) ||
    payload.schemaVersion !== '1.2.0' ||
    !('catalogVersion' in payload) ||
    payload.catalogVersion !== '2026.3' ||
    !('seasonReference' in payload) ||
    payload.seasonReference !== 2026 ||
    !('tracks' in payload) ||
    !Array.isArray(payload.tracks) ||
    payload.tracks.length !== 24
  ) {
    throw new Error(
      'Contrato de pistas incompatível: o frontend exige TrackDefinition 1.2.0.',
    )
  }
  return payload as TrackCatalog
}

const TRACK_SURFACE_MATERIALS = new Set<TrackSurfaceMaterial>([
  'asphalt',
  'grass',
  'gravel',
])
const TRACK_BARRIER_TYPES = new Set<TrackBarrierType>([
  'concrete-wall',
  'guardrail',
  'tecpro',
  'tyre-barrier',
])
const TRACK_FENCE_TYPES = new Set<TrackFenceType>(['debris-fence'])

function isCompatibleTrackSide(value: unknown): value is TrackSideEnvironment {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('zones' in value) ||
    !Array.isArray(value.zones) ||
    value.zones.length > 4 ||
    !('barrier' in value) ||
    typeof value.barrier !== 'string' ||
    !TRACK_BARRIER_TYPES.has(value.barrier as TrackBarrierType) ||
    ('fence' in value &&
      (typeof value.fence !== 'string' ||
        !TRACK_FENCE_TYPES.has(value.fence as TrackFenceType)))
  ) {
    return false
  }
  return value.zones.every(
    (zone) =>
      typeof zone === 'object' &&
      zone !== null &&
      'surface' in zone &&
      typeof zone.surface === 'string' &&
      TRACK_SURFACE_MATERIALS.has(zone.surface as TrackSurfaceMaterial) &&
      'widthMeters' in zone &&
      typeof zone.widthMeters === 'number' &&
      Number.isFinite(zone.widthMeters) &&
      zone.widthMeters > 0 &&
      zone.widthMeters <= 60,
  )
}

function compatibleTrackDefinition(payload: unknown): TrackDefinition {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('schemaVersion' in payload) ||
    payload.schemaVersion !== '1.2.0' ||
    !('catalogVersion' in payload) ||
    payload.catalogVersion !== '2026.3' ||
    !('centerline' in payload) ||
    !Array.isArray(payload.centerline) ||
    payload.centerline.length < 2 ||
    payload.centerline.some(
      (point) =>
        typeof point !== 'object' ||
        point === null ||
        !('halfWidthMeters' in point) ||
        typeof point.halfWidthMeters !== 'number' ||
        !Number.isFinite(point.halfWidthMeters) ||
        point.halfWidthMeters < 3.5 ||
        point.halfWidthMeters > 13 ||
        !('elevationLayer' in point) ||
        typeof point.elevationLayer !== 'number' ||
        !Number.isInteger(point.elevationLayer) ||
        point.elevationLayer < 0 ||
        point.elevationLayer > 3,
    ) ||
    !('trackLimits' in payload) ||
    typeof payload.trackLimits !== 'object' ||
    payload.trackLimits === null ||
    !('segments' in payload.trackLimits) ||
    !Array.isArray(payload.trackLimits.segments) ||
    payload.trackLimits.segments.length === 0 ||
    payload.trackLimits.segments.some(
      (segment) =>
        typeof segment !== 'object' ||
        segment === null ||
        !('left' in segment) ||
        !('right' in segment) ||
        !isCompatibleTrackSide(segment.left) ||
        !isCompatibleTrackSide(segment.right),
    ) ||
    !('source' in payload) ||
    typeof payload.source !== 'object' ||
    payload.source === null ||
    !('environmentReferences' in payload.source) ||
    !Array.isArray(payload.source.environmentReferences) ||
    payload.source.environmentReferences.length < 2
  ) {
    throw new Error(
      'Definição de pista incompatível: faça o deploy do backend com o catálogo 2026.3.',
    )
  }
  return payload as TrackDefinition
}

export const raceApi = {
  getTracks: async () => compatibleTrackCatalog(await apiRequest('/tracks')),
  getTrack: async (trackId: string) =>
    compatibleTrackDefinition(
      await apiRequest(`/tracks/${encodeURIComponent(trackId)}`),
    ),
  submitLocalResult: (result: LocalRaceResultRequest, token?: string) =>
    apiRequest<LocalRaceResultResponse>(
      '/races/local-result',
      {
        method: 'POST',
        body: JSON.stringify(result),
      },
      token,
    ),
}
