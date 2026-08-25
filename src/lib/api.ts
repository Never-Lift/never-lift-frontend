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
  physicsContractVersion: string
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
  schemaVersion: '2.0.0'
  catalogVersion: '2026.6'
  physicsContractVersion: '2.0.0'
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

export type TrackCurbPalette =
  | 'red-white'
  | 'orange-white'
  | 'red-white-blue'
  | 'green-white-red'
  | 'red-yellow'
  | 'green-yellow'
  | 'maroon-white'
  | 'blue-white'

export type TrackCurbSegment = {
  index: number
  fromDistanceMeters: number
  toDistanceMeters: number
  side: 'left' | 'right'
  widthMeters: number
  stripeLengthMeters: number
  palette: TrackCurbPalette
}

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

export type TrackBarrierPathPoint = TrackVector & {
  distanceMeters: number
  elevationLayer: number
}

export type TrackBarrierGeometrySegment = {
  index: number
  trackLimitSegmentIndex: number
  side: 'left' | 'right'
  fromDistanceMeters: number
  toDistanceMeters: number
  material: TrackBarrierType
  thicknessMeters: number
  collisionLayer: 'track-barrier'
  chunkIndexes: number[]
  path: TrackBarrierPathPoint[]
}

export type TrackDefinition = {
  schemaVersion: '2.0.0'
  catalogVersion: '2026.6'
  physicsContractVersion: '2.0.0'
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
  curbs: TrackCurbSegment[]
  trackLimits: {
    segments: TrackLimitSegment[]
  }
  barrierGeometry: {
    segments: TrackBarrierGeometrySegment[]
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
    payload.schemaVersion !== '2.0.0' ||
    !('catalogVersion' in payload) ||
    payload.catalogVersion !== '2026.6' ||
    !('physicsContractVersion' in payload) ||
    payload.physicsContractVersion !== '2.0.0' ||
    !('seasonReference' in payload) ||
    payload.seasonReference !== 2026 ||
    !('tracks' in payload) ||
    !Array.isArray(payload.tracks) ||
    payload.tracks.length !== 24
  ) {
    throw new Error(
      'A lista de circuitos não é compatível com esta versão do jogo.',
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
const TRACK_CURB_PALETTES = new Set<TrackCurbPalette>([
  'red-white',
  'orange-white',
  'red-white-blue',
  'green-white-red',
  'red-yellow',
  'green-yellow',
  'maroon-white',
  'blue-white',
])

function isCompatibleTrackCurb(
  value: unknown,
  index: number,
  lengthMeters: number,
): value is TrackCurbSegment {
  return (
    typeof value === 'object' &&
    value !== null &&
    'index' in value &&
    value.index === index &&
    'fromDistanceMeters' in value &&
    typeof value.fromDistanceMeters === 'number' &&
    Number.isFinite(value.fromDistanceMeters) &&
    value.fromDistanceMeters >= 0 &&
    'toDistanceMeters' in value &&
    typeof value.toDistanceMeters === 'number' &&
    Number.isFinite(value.toDistanceMeters) &&
    value.toDistanceMeters > value.fromDistanceMeters &&
    value.toDistanceMeters <= lengthMeters &&
    'side' in value &&
    (value.side === 'left' || value.side === 'right') &&
    'widthMeters' in value &&
    typeof value.widthMeters === 'number' &&
    Number.isFinite(value.widthMeters) &&
    value.widthMeters >= 0.3 &&
    value.widthMeters <= 2.5 &&
    'stripeLengthMeters' in value &&
    typeof value.stripeLengthMeters === 'number' &&
    Number.isFinite(value.stripeLengthMeters) &&
    value.stripeLengthMeters >= 0.5 &&
    value.stripeLengthMeters <= 8 &&
    'palette' in value &&
    typeof value.palette === 'string' &&
    TRACK_CURB_PALETTES.has(value.palette as TrackCurbPalette)
  )
}

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

function isCompatibleBarrierGeometrySegment(
  value: unknown,
  index: number,
  lengthMeters: number,
  trackLimitCount: number,
  chunkCount: number,
): value is TrackBarrierGeometrySegment {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('index' in value) ||
    value.index !== index ||
    !('trackLimitSegmentIndex' in value) ||
    typeof value.trackLimitSegmentIndex !== 'number' ||
    !Number.isInteger(value.trackLimitSegmentIndex) ||
    value.trackLimitSegmentIndex < 0 ||
    value.trackLimitSegmentIndex >= trackLimitCount ||
    !('side' in value) ||
    (value.side !== 'left' && value.side !== 'right') ||
    !('fromDistanceMeters' in value) ||
    typeof value.fromDistanceMeters !== 'number' ||
    !Number.isFinite(value.fromDistanceMeters) ||
    value.fromDistanceMeters < 0 ||
    !('toDistanceMeters' in value) ||
    typeof value.toDistanceMeters !== 'number' ||
    !Number.isFinite(value.toDistanceMeters) ||
    value.toDistanceMeters <= value.fromDistanceMeters ||
    value.toDistanceMeters > lengthMeters ||
    !('material' in value) ||
    typeof value.material !== 'string' ||
    !TRACK_BARRIER_TYPES.has(value.material as TrackBarrierType) ||
    !('thicknessMeters' in value) ||
    typeof value.thicknessMeters !== 'number' ||
    !Number.isFinite(value.thicknessMeters) ||
    value.thicknessMeters <= 0 ||
    value.thicknessMeters > 2 ||
    !('collisionLayer' in value) ||
    value.collisionLayer !== 'track-barrier' ||
    !('chunkIndexes' in value) ||
    !Array.isArray(value.chunkIndexes) ||
    value.chunkIndexes.length === 0 ||
    value.chunkIndexes.some(
      (chunkIndex) =>
        typeof chunkIndex !== 'number' ||
        !Number.isInteger(chunkIndex) ||
        chunkIndex < 0 ||
        chunkIndex >= chunkCount,
    ) ||
    !('path' in value) ||
    !Array.isArray(value.path) ||
    value.path.length < 2
  ) {
    return false
  }

  const fromDistanceMeters = value.fromDistanceMeters as number
  const toDistanceMeters = value.toDistanceMeters as number
  return value.path.every(
    (point) =>
      typeof point === 'object' &&
      point !== null &&
      'x' in point &&
      typeof point.x === 'number' &&
      Number.isFinite(point.x) &&
      'y' in point &&
      typeof point.y === 'number' &&
      Number.isFinite(point.y) &&
      'distanceMeters' in point &&
      typeof point.distanceMeters === 'number' &&
      Number.isFinite(point.distanceMeters) &&
      point.distanceMeters >= fromDistanceMeters - 0.5 &&
      point.distanceMeters <= toDistanceMeters + 0.5 &&
      'elevationLayer' in point &&
      typeof point.elevationLayer === 'number' &&
      Number.isInteger(point.elevationLayer) &&
      point.elevationLayer >= 0 &&
      point.elevationLayer <= 3,
  )
}

function hasCompleteBarrierCoverage(
  barriers: readonly TrackBarrierGeometrySegment[],
  limits: readonly TrackLimitSegment[],
) {
  const toleranceMeters = 1e-6
  return limits.every((limit) =>
    (['left', 'right'] as const).every((side) => {
      const coverage = barriers
        .filter(
          (barrier) =>
            barrier.trackLimitSegmentIndex === limit.index &&
            barrier.side === side,
        )
        .sort(
          (first, second) =>
            first.fromDistanceMeters - second.fromDistanceMeters,
        )
      if (coverage.length === 0) return false
      let expectedFrom = limit.fromDistanceMeters
      for (const barrier of coverage) {
        if (
          Math.abs(barrier.fromDistanceMeters - expectedFrom) >
            toleranceMeters ||
          barrier.toDistanceMeters > limit.toDistanceMeters + toleranceMeters ||
          barrier.material !== limit[side].barrier ||
          Math.abs(
            barrier.path[0].distanceMeters - barrier.fromDistanceMeters,
          ) > toleranceMeters ||
          Math.abs(
            barrier.path.at(-1)!.distanceMeters - barrier.toDistanceMeters,
          ) > toleranceMeters
        ) {
          return false
        }
        expectedFrom = barrier.toDistanceMeters
      }
      return Math.abs(expectedFrom - limit.toDistanceMeters) <= toleranceMeters
    }),
  )
}

function compatibleTrackDefinition(payload: unknown): TrackDefinition {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('schemaVersion' in payload) ||
    payload.schemaVersion !== '2.0.0' ||
    !('catalogVersion' in payload) ||
    payload.catalogVersion !== '2026.6' ||
    !('physicsContractVersion' in payload) ||
    payload.physicsContractVersion !== '2.0.0' ||
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
    !('lengthMeters' in payload) ||
    typeof payload.lengthMeters !== 'number' ||
    !Number.isFinite(payload.lengthMeters) ||
    !('curbs' in payload) ||
    !Array.isArray(payload.curbs) ||
    payload.curbs.length === 0 ||
    payload.curbs.some(
      (curb, index) =>
        !isCompatibleTrackCurb(
          curb,
          index,
          payload.lengthMeters as number,
        ),
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
    !('chunks' in payload) ||
    !Array.isArray(payload.chunks) ||
    payload.chunks.length === 0 ||
    !('barrierGeometry' in payload) ||
    typeof payload.barrierGeometry !== 'object' ||
    payload.barrierGeometry === null ||
    !('segments' in payload.barrierGeometry) ||
    !Array.isArray(payload.barrierGeometry.segments) ||
    payload.barrierGeometry.segments.length <
      payload.trackLimits.segments.length * 2 ||
    payload.barrierGeometry.segments.some(
      (segment, index) =>
        !isCompatibleBarrierGeometrySegment(
          segment,
          index,
          payload.lengthMeters as number,
          (payload.trackLimits as { segments: unknown[] }).segments.length,
          (payload.chunks as unknown[]).length,
        ),
    ) ||
    !hasCompleteBarrierCoverage(
      payload.barrierGeometry.segments as TrackBarrierGeometrySegment[],
      payload.trackLimits.segments as TrackLimitSegment[],
    ) ||
    !('source' in payload) ||
    typeof payload.source !== 'object' ||
    payload.source === null ||
    !('environmentReferences' in payload.source) ||
    !Array.isArray(payload.source.environmentReferences) ||
    payload.source.environmentReferences.length < 2
  ) {
    throw new Error(
      'Os dados desta pista não são compatíveis com esta versão do jogo.',
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
