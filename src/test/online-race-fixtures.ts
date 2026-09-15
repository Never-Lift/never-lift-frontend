import type { RoomParticipant } from '@/lib/api'
import { RaceEngine } from '@/race/RaceEngine'
import type { OnlineCarSnapshot, OnlineSnapshot } from '@/online/race-protocol'
import { SHORT_TRACK } from '@/test/track-fixtures'

export const ONLINE_SESSION_ID = '00000000-0000-4000-8000-000000000001'
export const onlinePlayers: RoomParticipant[] = [1, 2, 3].map((n) => ({
  id: `user-${n}`, userId: n === 3 ? null : `user-${n}`, displayName: `Piloto ${n}`,
  bot: n === 3, ready: false, connected: true, color: ['#365f82', '#a84448', '#3f704f'][n-1],
}))
export function onlineFrame(overrides: Partial<OnlineSnapshot> = {}): OnlineSnapshot {
  const engine = new RaceEngine({ track: SHORT_TRACK, mode: 'solo', racers: onlinePlayers.map((p) => ({ id: p.id, name: p.displayName!, kind: 'human', color: p.color! })) })
  const cars: OnlineCarSnapshot[] = onlinePlayers.map((p, i) => {
    const car = engine.getVehicleState(p.id)!
    return { playerId: p.id, x: car.position.x, y: car.position.y, velocityX: 0, velocityY: 0,
      angle: car.angle, speed: 0, physicsState: car.physicsState, damageState: { ...car.damage, totalLoss: false },
      trackDistanceMeters: 0, trackLayer: 0, lastProcessedClientSeq: -1,
      lap: 0, isGhost: false, inPit: false, falseStart: false, position: i+1,
      nextCheckpoint: 0, qualifyingAttempts: 0, currentLapTimeMs: 0, bestLapTimeMs: 0,
    }
  })
  return { sessionId: ONLINE_SESSION_ID, tick: 0, substep: 0, physicsSubstep: 0,
    serverTime: 1_000_000, trackId: SHORT_TRACK.id, trackCatalogVersion: '2026.12', physicsContractVersion: '2.0.3',
    phase: 'race', totalLaps: 2, raceTimeMs: 0, cars, ...overrides }
}
