import type { TrackDefinition } from '@/lib/api'

export type Vector2 = {
  x: number
  y: number
}
export type VehicleProfileId = 'formula' | 'supercar' | 'drift'
export type HandlingMode = 'normal' | 'drift'
export type SurfaceId = 'asphalt' | 'grass' | 'pit-lane'
export type RaceMode = 'solo' | 'local'
export type BotDifficulty = 'easy' | 'normal' | 'hard'
export type DamageKind =
  | 'none'
  | 'engine'
  | 'steering'
  | 'engine-and-steering'
  | 'total-loss'
export type SteeringPull = -1 | 0 | 1
export type RacerKind = 'human' | 'bot'

export type DriverInput = {
  throttle: number
  brake: number
  steer: number
  nitro: boolean
}

export type VehicleSetup = {
  id: string
  name: string
  kind: RacerKind
  profileId: VehicleProfileId
  color: string
  botDifficulty?: BotDifficulty
}

export type VehicleDamage = {
  kind: DamageKind
  health: number
  engineDamaged: boolean
  steeringDamaged: boolean
  steeringPull: SteeringPull
  impactCount: number
  lastImpactSpeed: number
}

export type VehicleState = VehicleSetup & {
  handlingMode: HandlingMode
  position: Vector2
  previousPosition: Vector2
  velocity: Vector2
  angle: number
  previousAngle: number
  yawRate: number
  surface: SurfaceId
  damage: VehicleDamage
  nextCheckpointIndex: number
  lapProgressMeters: number
  totalProgressMeters: number
  currentLap: number
  lapStartedAtSeconds: number
  bestLapTimeSeconds: number | null
  finished: boolean
  finishTimeSeconds: number | null
}

export type InterpolatedVehicleState = VehicleState & {
  renderPosition: Vector2
  renderAngle: number
}

export type RaceStatus = 'running' | 'finished'

export type RaceEngineOptions = {
  track: TrackDefinition
  mode: RaceMode
  handlingMode: HandlingMode
  racers: VehicleSetup[]
  lapCount?: number
  maximumRaceSeconds?: number
}

export type RaceResultEntry = {
  racerId: string
  racerName: string
  position: number
  totalTimeMs: number
  bestLapTimeMs: number
  finished: boolean
}
