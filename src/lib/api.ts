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

export type TrackEscapeObstacleRow = {
  from: TrackVector
  to: TrackVector
  blockLengthMeters: number
  palette: 'red-white'
}

export type TrackEscapeRoad = {
  id: string
  kind: 'slalom-block-rows'
  affectsPhysics: false
  elevationLayer: number
  widthMeters: number
  path: TrackVector[]
  obstacleRows: TrackEscapeObstacleRow[]
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
  catalogVersion: '2026.9'
  physicsContractVersion: '2.0.0'
  seasonReference: 2026
  calendarPolicy: 'original-24-round-freeze'
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
  visualStyle?: TrackInfrastructurePalette
  dimensions?: TrackInfrastructureDimensions
}

export type TrackInfrastructurePalette = {
  primaryColor: string
  secondaryColor: string
  accentColor: string
  roofColor: string
}

export type TrackInfrastructureDimensions = {
  lengthMeters: number
  depthMeters: number
  heightMeters: number
}

export type TrackPitVisualStyle = TrackInfrastructurePalette & {
  architecture:
    | 'temporary-modular'
    | 'permanent-modern'
    | 'desert-canopy'
    | 'stepped-modern'
    | 'urban-compact'
    | 'wing'
    | 'heritage'
    | 'exhibition'
    | 'stadium'
    | 'marina-canopy'
  garageCount: number
  buildingHeightMeters: number
  laneWidthMeters: number
  garageStartRatio: number
  garageEndRatio: number
  pitBoxLengthMeters: number
  pitBoxDepthMeters: number
  pitBoxCenterOffsetMeters: number
  garageDepthMeters: number
  garageCenterOffsetMeters: number
  pitWallHeightMeters: number
  canopyDepthMeters: number
}

export type TrackSurfaceMaterial = 'asphalt' | 'grass' | 'gravel'

export type TrackBarrierType =
  | 'concrete-wall'
  | 'guardrail'
  | 'tecpro'
  | 'tyre-barrier'

export type TrackFenceType = 'debris-fence'

export type TrackFenceVisualStyle = {
  heightMeters: number
  postSpacingMeters: number
  postColor: string
  meshColor: string
  meshOpacity: number
  cantileverMeters: number
}

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
  outerColor?: string
  outerWidthMeters?: number
}

export type TrackSideEnvironment = {
  zones: Array<{
    surface: TrackSurfaceMaterial
    widthMeters: number
  }>
  barrier: TrackBarrierType
  fence?: TrackFenceType
  fenceVisualStyle?: TrackFenceVisualStyle
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
  catalogVersion: '2026.9'
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
    visualStyle: TrackPitVisualStyle
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
    escapeRoads: TrackEscapeRoad[]
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

function isCompatibleTrackCatalogEntry(
  value: unknown,
): value is TrackCatalogEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'round' in value &&
    typeof value.round === 'number' &&
    Number.isInteger(value.round) &&
    value.round >= 1 &&
    value.round <= 24 &&
    'id' in value &&
    typeof value.id === 'string' &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id) &&
    'name' in value &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    'countryCode' in value &&
    typeof value.countryCode === 'string' &&
    /^[A-Z]{2}$/.test(value.countryCode) &&
    'countryName' in value &&
    typeof value.countryName === 'string' &&
    value.countryName.length > 0 &&
    'locality' in value &&
    typeof value.locality === 'string' &&
    value.locality.length > 0 &&
    'lengthMeters' in value &&
    typeof value.lengthMeters === 'number' &&
    Number.isInteger(value.lengthMeters) &&
    value.lengthMeters >= 2500 &&
    value.lengthMeters <= 8000 &&
    'definitionPath' in value &&
    typeof value.definitionPath === 'string' &&
    /^tracks\/[a-z0-9-]+\.json$/.test(value.definitionPath)
  )
}

function compatibleTrackCatalog(payload: unknown): TrackCatalog {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('schemaVersion' in payload) ||
    payload.schemaVersion !== '2.0.0' ||
    !('catalogVersion' in payload) ||
    payload.catalogVersion !== '2026.9' ||
    !('physicsContractVersion' in payload) ||
    payload.physicsContractVersion !== '2.0.0' ||
    !('seasonReference' in payload) ||
    payload.seasonReference !== 2026 ||
    !('calendarPolicy' in payload) ||
    payload.calendarPolicy !== 'original-24-round-freeze' ||
    !('tracks' in payload) ||
    !Array.isArray(payload.tracks) ||
    payload.tracks.length !== 24 ||
    payload.tracks.some((entry) => !isCompatibleTrackCatalogEntry(entry))
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
const TRACK_SCENERY_PRESETS = new Set<
  TrackDefinition['sceneryLayout']['preset']
>(['park', 'street', 'desert', 'coastal', 'classic', 'night-city'])

const TRACK_PIT_ARCHITECTURES = new Set<
  TrackPitVisualStyle['architecture']
>([
  'temporary-modular',
  'permanent-modern',
  'desert-canopy',
  'stepped-modern',
  'urban-compact',
  'wing',
  'heritage',
  'exhibition',
  'stadium',
  'marina-canopy',
])

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

function isFiniteNumberInRange(
  value: unknown,
  minimum: number,
  maximum: number,
) {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  )
}

function isCompatibleInfrastructurePalette(
  value: unknown,
): value is TrackInfrastructurePalette {
  return (
    typeof value === 'object' &&
    value !== null &&
    'primaryColor' in value &&
    isHexColor(value.primaryColor) &&
    'secondaryColor' in value &&
    isHexColor(value.secondaryColor) &&
    'accentColor' in value &&
    isHexColor(value.accentColor) &&
    'roofColor' in value &&
    isHexColor(value.roofColor)
  )
}

function isCompatibleInfrastructureDimensions(
  value: unknown,
): value is TrackInfrastructureDimensions {
  return (
    typeof value === 'object' &&
    value !== null &&
    'lengthMeters' in value &&
    isFiniteNumberInRange(value.lengthMeters, Number.MIN_VALUE, 400) &&
    'depthMeters' in value &&
    isFiniteNumberInRange(value.depthMeters, Number.MIN_VALUE, 120) &&
    'heightMeters' in value &&
    isFiniteNumberInRange(value.heightMeters, Number.MIN_VALUE, 80)
  )
}

function isCompatibleSceneryObject(value: unknown): value is TrackSceneryObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    'kind' in value &&
    typeof value.kind === 'string' &&
    value.kind.length > 0 &&
    'position' in value &&
    typeof value.position === 'object' &&
    value.position !== null &&
    'x' in value.position &&
    typeof value.position.x === 'number' &&
    Number.isFinite(value.position.x) &&
    'y' in value.position &&
    typeof value.position.y === 'number' &&
    Number.isFinite(value.position.y) &&
    'rotation' in value &&
    typeof value.rotation === 'number' &&
    Number.isFinite(value.rotation) &&
    'scale' in value &&
    typeof value.scale === 'number' &&
    Number.isFinite(value.scale) &&
    value.scale > 0 &&
    (!('visualStyle' in value) ||
      isCompatibleInfrastructurePalette(value.visualStyle)) &&
    (!('dimensions' in value) ||
      isCompatibleInfrastructureDimensions(value.dimensions))
  )
}

function isCompatibleTrackVector(value: unknown): value is TrackVector {
  return (
    typeof value === 'object' &&
    value !== null &&
    'x' in value &&
    typeof value.x === 'number' &&
    Number.isFinite(value.x) &&
    'y' in value &&
    typeof value.y === 'number' &&
    Number.isFinite(value.y)
  )
}

function isCompatibleEscapeRoad(value: unknown): value is TrackEscapeRoad {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    'kind' in value &&
    value.kind === 'slalom-block-rows' &&
    'affectsPhysics' in value &&
    value.affectsPhysics === false &&
    'elevationLayer' in value &&
    typeof value.elevationLayer === 'number' &&
    Number.isInteger(value.elevationLayer) &&
    value.elevationLayer >= 0 &&
    value.elevationLayer <= 3 &&
    'widthMeters' in value &&
    isFiniteNumberInRange(value.widthMeters, 4, 16) &&
    'path' in value &&
    Array.isArray(value.path) &&
    value.path.length >= 2 &&
    value.path.every(isCompatibleTrackVector) &&
    'obstacleRows' in value &&
    Array.isArray(value.obstacleRows) &&
    value.obstacleRows.length >= 3 &&
    value.obstacleRows.every(
      (row) =>
        typeof row === 'object' &&
        row !== null &&
        'from' in row &&
        isCompatibleTrackVector(row.from) &&
        'to' in row &&
        isCompatibleTrackVector(row.to) &&
        'blockLengthMeters' in row &&
        isFiniteNumberInRange(row.blockLengthMeters, 0.4, 4) &&
        'palette' in row &&
        row.palette === 'red-white',
    )
  )
}

function hasUniqueSceneryIds(value: {
  landmarks: TrackSceneryObject[]
  staticObjects: TrackSceneryObject[]
  escapeRoads: TrackEscapeRoad[]
}) {
  const ids = [
    ...value.landmarks.map((object) => object.id),
    ...value.staticObjects.map((object) => object.id),
    ...value.escapeRoads.map((road) => road.id),
  ]
  return new Set(ids).size === ids.length
}

function isCompatibleFenceVisualStyle(
  value: unknown,
): value is TrackFenceVisualStyle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'heightMeters' in value &&
    isFiniteNumberInRange(value.heightMeters, 2, 6) &&
    'postSpacingMeters' in value &&
    isFiniteNumberInRange(value.postSpacingMeters, 1.5, 5) &&
    'postColor' in value &&
    isHexColor(value.postColor) &&
    'meshColor' in value &&
    isHexColor(value.meshColor) &&
    'meshOpacity' in value &&
    isFiniteNumberInRange(value.meshOpacity, 0.05, 0.5) &&
    'cantileverMeters' in value &&
    isFiniteNumberInRange(value.cantileverMeters, 0, 1.2)
  )
}

function isCompatiblePitVisualStyle(
  value: unknown,
): value is TrackPitVisualStyle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'architecture' in value &&
    TRACK_PIT_ARCHITECTURES.has(
      value.architecture as TrackPitVisualStyle['architecture'],
    ) &&
    'garageCount' in value &&
    typeof value.garageCount === 'number' &&
    Number.isInteger(value.garageCount) &&
    value.garageCount >= 8 &&
    value.garageCount <= 16 &&
    'buildingHeightMeters' in value &&
    typeof value.buildingHeightMeters === 'number' &&
    value.buildingHeightMeters >= 3 &&
    value.buildingHeightMeters <= 24 &&
    'laneWidthMeters' in value &&
    isFiniteNumberInRange(value.laneWidthMeters, 6, 16) &&
    'garageStartRatio' in value &&
    isFiniteNumberInRange(value.garageStartRatio, 0.05, 0.8) &&
    'garageEndRatio' in value &&
    isFiniteNumberInRange(value.garageEndRatio, 0.2, 0.95) &&
    Number(value.garageStartRatio) < Number(value.garageEndRatio) &&
    'pitBoxLengthMeters' in value &&
    isFiniteNumberInRange(value.pitBoxLengthMeters, 3, 12) &&
    'pitBoxDepthMeters' in value &&
    isFiniteNumberInRange(value.pitBoxDepthMeters, 1.5, 4) &&
    'pitBoxCenterOffsetMeters' in value &&
    isFiniteNumberInRange(value.pitBoxCenterOffsetMeters, 1, 5) &&
    'garageDepthMeters' in value &&
    isFiniteNumberInRange(value.garageDepthMeters, 3, 16) &&
    'garageCenterOffsetMeters' in value &&
    isFiniteNumberInRange(value.garageCenterOffsetMeters, 6, 24) &&
    'pitWallHeightMeters' in value &&
    isFiniteNumberInRange(value.pitWallHeightMeters, 0.6, 1.5) &&
    'canopyDepthMeters' in value &&
    isFiniteNumberInRange(value.canopyDepthMeters, 0, 5) &&
    isCompatibleInfrastructurePalette(value)
  )
}

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
    TRACK_CURB_PALETTES.has(value.palette as TrackCurbPalette) &&
    (!('outerColor' in value) || isHexColor(value.outerColor)) &&
    (!('outerWidthMeters' in value) ||
      isFiniteNumberInRange(value.outerWidthMeters, 0.1, 1.5))
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
        !TRACK_FENCE_TYPES.has(value.fence as TrackFenceType))) ||
    ('fenceVisualStyle' in value &&
      !isCompatibleFenceVisualStyle(value.fenceVisualStyle))
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
    payload.catalogVersion !== '2026.9' ||
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
    !('pitLane' in payload) ||
    typeof payload.pitLane !== 'object' ||
    payload.pitLane === null ||
    !('visualStyle' in payload.pitLane) ||
    !isCompatiblePitVisualStyle(payload.pitLane.visualStyle) ||
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
    !('sceneryLayout' in payload) ||
    typeof payload.sceneryLayout !== 'object' ||
    payload.sceneryLayout === null ||
    !('preset' in payload.sceneryLayout) ||
    typeof payload.sceneryLayout.preset !== 'string' ||
    !TRACK_SCENERY_PRESETS.has(
      payload.sceneryLayout.preset as TrackDefinition['sceneryLayout']['preset'],
    ) ||
    !('landmarks' in payload.sceneryLayout) ||
    !Array.isArray(payload.sceneryLayout.landmarks) ||
    payload.sceneryLayout.landmarks.some(
      (object) => !isCompatibleSceneryObject(object),
    ) ||
    !('staticObjects' in payload.sceneryLayout) ||
    !Array.isArray(payload.sceneryLayout.staticObjects) ||
    payload.sceneryLayout.staticObjects.some(
      (object) => !isCompatibleSceneryObject(object),
    ) ||
    !('escapeRoads' in payload.sceneryLayout) ||
    !Array.isArray(payload.sceneryLayout.escapeRoads) ||
    payload.sceneryLayout.escapeRoads.some(
      (road) => !isCompatibleEscapeRoad(road),
    ) ||
    !hasUniqueSceneryIds(
      payload.sceneryLayout as TrackDefinition['sceneryLayout'],
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
