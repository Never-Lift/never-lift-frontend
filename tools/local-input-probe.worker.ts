// Test-only observation at the actual fixed physics step. Not imported by app.
import { RaceEngine } from '../src/race/RaceEngine'
import type { DriverInput } from '../src/race/types'
import '../src/race/local-race.worker'

const step = RaceEngine.prototype.stepFixed
const observed = new WeakMap<RaceEngine, Map<string, string>>()
RaceEngine.prototype.stepFixed = function() {
  const inputs = (this as unknown as { inputs: Map<string, DriverInput> }).inputs
  const previous = observed.get(this) ?? new Map<string, string>()
  observed.set(this, previous)
  const timestamp = performance.timeOrigin + performance.now()
  for (const [id, input] of inputs) {
    if (!id.startsWith('player-')) continue
    const value = JSON.stringify(input)
    if (previous.get(id) !== value) {
      previous.set(id, value)
      ;(globalThis as unknown as { postMessage(data: unknown): void }).postMessage({ type: 'input-observed', id, input, timestamp,
        longitudinalSpeed: this.getVehicleState(id)?.physicsState.longitudinalSpeed })
    }
  }
  return step.call(this)
}
