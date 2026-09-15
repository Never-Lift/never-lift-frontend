import { z } from 'zod'
import type { RoomParticipant } from '@/lib/api'
import { createInitialVehiclePhysicsState } from '@/race/vehicle-physics'
import type { InterpolatedVehicleState } from '@/race/types'

// M3c fields follow the shared realtime-race-protocol.schema.json. Older 3b
// frames are not sufficient to start the online presentation safely.
const number = z.number().finite()
const integer = number.int().nonnegative()
export const phaseSchema = z.enum(['lobby', 'qualifying', 'qualifying_results', 'countdown', 'race', 'results'])
const id = z.string().min(1)
export const carSnapshotSchema = z.object({
  playerId: id, x: number, y: number, velocityX: number, velocityY: number,
  angle: number, speed: number.nonnegative(),
  physicsState: z.object({
    yawRate: number, steeringAngle: number, appliedThrottle: number.min(0).max(1),
    appliedBrake: number.min(0).max(1), frontWheelAngularSpeed: number,
    rearWheelAngularSpeed: number, gear: number.int().min(-1).max(8),
    engineRpm: number.nonnegative(), gearShiftTimeRemaining: number.nonnegative(),
    longitudinalAcceleration: number,
  }),
  damageState: z.object({
    kind: z.enum(['none', 'steering', 'engine', 'engine-and-steering', 'total-loss']),
    health: number.min(0).max(100), engineDamaged: z.boolean(), steeringDamaged: z.boolean(),
    steeringPull: z.union([z.literal(-1), z.literal(0), z.literal(1)]), totalLoss: z.boolean(),
    impactCount: integer, lastImpactSpeed: number.nonnegative(),
  }),
  trackDistanceMeters: number.nonnegative(), trackLayer: number.int(),
  lastProcessedClientSeq: number.int().min(-1), lap: integer,
  isGhost: z.boolean(), inPit: z.boolean(), falseStart: z.boolean(),
  position: integer.min(1).max(22), nextCheckpoint: integer,
  qualifyingAttempts: integer.max(2), currentLapTimeMs: integer, bestLapTimeMs: integer,
})
export const snapshotSchema = z.object({
  sessionId: z.uuid(), tick: integer, substep: integer, physicsSubstep: integer,
  serverTime: number.nonnegative(), trackId: id,
  trackCatalogVersion: z.literal('2026.12'), physicsContractVersion: z.literal('2.0.3'),
  phase: phaseSchema, totalLaps: integer.min(1).max(99), raceTimeMs: integer,
  cars: z.array(carSnapshotSchema).min(1).max(22),
}).refine((frame) => new Set(frame.cars.map((car) => car.playerId)).size === frame.cars.length)
const eventBase = { sessionId: z.uuid(), tick: integer, substep: integer, serverTime: number.nonnegative() }
const gridEntry = z.object({ playerId: id, position: integer.min(1).max(22), bestLapTimeMs: integer, valid: z.boolean() })
export const eventSchema = z.discriminatedUnion('type', [
  z.object({ ...eventBase, type: z.literal('start_light'), stage: integer.min(1).max(5) }),
  z.object({ ...eventBase, type: z.literal('lights_out'), stage: z.literal(0) }),
  z.object({ ...eventBase, type: z.literal('qualifying_start'), laps: z.literal(2), countdownSeconds: z.literal(3) }),
  z.object({ ...eventBase, type: z.literal('session_phase'), phase: phaseSchema }),
  z.object({ ...eventBase, type: z.literal('qualifying_result'), grid: z.array(gridEntry).min(2).max(22) }),
  z.object({ ...eventBase, type: z.literal('false_start'), playerId: id, blockedSubsteps: z.literal(600), penaltySeconds: z.literal(5) }),
  z.object({ ...eventBase, type: z.literal('finished'), playerId: id, position: integer.min(1).max(22), totalTimeMs: integer }),
])
export const resultSchema = z.object({
  sessionId: z.uuid(), trackId: id, trackCatalogVersion: z.literal('2026.12'), physicsContractVersion: z.literal('2.0.3'),
  standings: z.array(z.object({ playerId: id, userId: z.string().nullable(), displayName: z.string(),
    position: integer.min(1).max(22), totalTimeMs: integer, bestLapTimeMs: integer,
    finished: z.boolean(), laps: integer, progressMeters: number.nonnegative(),
  })).min(1).max(22),
})
export type OnlineSnapshot = z.infer<typeof snapshotSchema>
export type OnlineCarSnapshot = z.infer<typeof carSnapshotSchema>
export type OnlineRaceEvent = z.infer<typeof eventSchema>
export type OnlineResult = z.infer<typeof resultSchema>
export type OnlinePhase = z.infer<typeof phaseSchema>
export type QualifyingGrid = z.infer<typeof gridEntry>[]

export function snapshotVehicle(car: OnlineCarSnapshot, player?: RoomParticipant): InterpolatedVehicleState {
  const position = { x: car.x, y: car.y }
  return {
    id: car.playerId, name: player?.displayName ?? player?.gamertag ?? 'Piloto',
    color: player?.color ?? '#365f82', kind: player?.bot ? 'bot' : 'human',
    position, previousPosition: { ...position }, renderPosition: { ...position },
    velocity: { x: car.velocityX, y: car.velocityY }, angle: car.angle, previousAngle: car.angle,
    renderAngle: car.angle, yawRate: car.physicsState.yawRate,
    physicsState: { ...createInitialVehiclePhysicsState(), ...car.physicsState },
    damage: { ...car.damageState }, surface: car.inPit ? 'pit-lane' : 'asphalt',
    trackLayer: car.trackLayer, trackDistanceMeters: car.trackDistanceMeters,
    nextCheckpointIndex: car.nextCheckpoint, lapProgressMeters: car.trackDistanceMeters,
    totalProgressMeters: 0, currentLap: car.lap + 1, lapStartedAtSeconds: 0,
    bestLapTimeSeconds: car.bestLapTimeMs > 0 ? car.bestLapTimeMs / 1000 : null,
    finished: car.isGhost, finishTimeSeconds: null, renderOpacity: car.isGhost ? 0.4 : 1,
  }
}
