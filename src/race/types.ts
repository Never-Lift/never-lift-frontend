import type { TrackDefinition } from '@/lib/api'

export type Vector2 = {
  x: number
  y: number
}
export type SurfaceId = 'asphalt' | 'curb' | 'grass' | 'gravel' | 'pit-lane'
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
}

/**
 * Canonical state that must be reconciled together with position/velocity in
 * online races. Values are advanced only by the fixed physics tick.
 */
export type VehiclePhysicsState = {
  yawRate: number
  steeringAngle: number
  appliedThrottle: number
  appliedBrake: number
  frontWheelAngularSpeed: number
  rearWheelAngularSpeed: number
  gear: number
  engineRpm: number
  gearShiftTimeRemaining: number
  longitudinalSpeed: number
  lateralSpeed: number
  longitudinalAcceleration: number
  lateralAcceleration: number
  frontSlipAngle: number
  rearSlipAngle: number
  frontGripUtilization: number
  rearGripUtilization: number
}

export type VehicleSetup = {
  id: string
  name: string
  kind: RacerKind
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
  position: Vector2
  previousPosition: Vector2
  velocity: Vector2
  angle: number
  previousAngle: number
  /** @deprecated Read physicsState.yawRate in new code. */
  yawRate: number
  physicsState: VehiclePhysicsState
  surface: SurfaceId
  trackLayer: number
  trackDistanceMeters: number
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
