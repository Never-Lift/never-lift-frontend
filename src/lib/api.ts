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
  schemaVersion: '1.1.0'
  catalogVersion: string
  seasonReference: 2026
  calendarPolicy?: 'original-24-round-freeze'
  tracks: TrackCatalogEntry[]
}

export type TrackPathPoint = TrackVector & {
  distanceMeters: number
  halfWidthMeters: number
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

export type TrackLimitType = 'barrier' | 'runoff'

export type TrackLimitSegment = {
  index: number
  fromDistanceMeters: number
  toDistanceMeters: number
  left: TrackLimitType
  right: TrackLimitType
}

export type TrackDefinition = {
  schemaVersion: '1.1.0'
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
    offTrack: 'grass'
    pitLane: 'pit-lane'
  }
  trackLimits: {
    runoffWidthMeters: 10
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
  }
}

export const raceApi = {
  getTracks: () => apiRequest<TrackCatalog>('/tracks'),
  getTrack: (trackId: string) =>
    apiRequest<TrackDefinition>(`/tracks/${encodeURIComponent(trackId)}`),
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
