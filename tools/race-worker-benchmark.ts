// Benchmark-only human autopilot. Never imported by the application.
import { LocalWorkerSimulation } from '../src/race/LocalWorkerSimulation'
import '../src/race/local-race.worker'
import type { DriverInput, VehicleState } from '../src/race/types'

const patched = new WeakSet<LocalWorkerSimulation>()
const tick = LocalWorkerSimulation.prototype.tick
LocalWorkerSimulation.prototype.tick = function(timestamp, maximumSliceSeconds) {
  if (!patched.has(this)) {
    patched.add(this)
    const engine = this.engine
    const planner = engine as unknown as { createBotInput(vehicle: VehicleState): DriverInput }
    const humans = engine.getInterpolatedVehicles().filter(vehicle => vehicle.kind === 'human')
    const step = engine.stepFixed.bind(engine)
    engine.stepFixed = () => {
      for (const human of humans) engine.setInput(human.id, planner.createBotInput(engine.getVehicleState(human.id)!))
      step()
    }
  }
  tick.call(this, timestamp, maximumSliceSeconds)
}
