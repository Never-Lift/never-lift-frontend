export { RaceEngine } from '../src/race/RaceEngine'
export { RaceRenderer } from '../src/race/RaceRenderer'
export { TrackGeometry } from '../src/race/TrackGeometry'
export * from '../src/race/visual-settings'
export { sweepCompoundCollidersWithRotation } from '../src/race/continuous-collision'
export { createVehicleWorldCollider } from '../src/race/vehicle-geometry'

import type { VehicleSetup, RaceMode } from '../src/race/types'

export function performanceRacers(mode: RaceMode, count: number): VehicleSetup[] {
  const humans = mode === 'local' ? 2 : 1
  if (!Number.isInteger(count) || count < humans || count > 22) {
    throw new Error('Benchmark grid must include its humans and at most 22 cars.')
  }
  return Array.from({ length: count }, (_, index) => ({
    id: index < humans ? `player-${index + 1}` : `bot-${index}`,
    name: `Car ${index}`,
    kind: index < humans ? 'human' : 'bot',
    botDifficulty: 'normal',
    color: ['#2d7dff', '#d63e44', '#327e4a'][index % 3],
  }))
}
