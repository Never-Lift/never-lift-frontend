import { createRoot } from 'react-dom/client'
import { RaceCanvas } from '../src/components/race/RaceCanvas'
import { RaceEngine } from '../src/race/RaceEngine'
import { LocalRaceRuntime } from '../src/race/LocalRaceRuntime'
import type { DriverInput } from '../src/race/types'
import { performanceRacers } from './race-performance-entry'
import type { TrackDefinition } from '../src/lib/api'
import '../src/index.css'

const state = { keys: [] as unknown[], sent: [] as unknown[], observed: [] as unknown[], snapshots: 0, simulationTime: 0, stopped: false }
const testingWindow = window as unknown as { probe: typeof state; probeTrack: TrackDefinition }
testingWindow.probe = state
const NativeWorker = window.Worker
window.Worker = class extends NativeWorker {
  postMessage(message: unknown) {
    const data = message as { type: string; inputs?: unknown }
    if (data.type === 'input') state.sent.push({ inputs: data.inputs, timestamp: performance.timeOrigin + performance.now() })
    super.postMessage(message)
  }
  constructor(_url: string | URL, options?: WorkerOptions) {
    super('/__input-probe-worker.js', options)
    this.addEventListener('message', event => {
      if (event.data.type === 'input-observed') {
        state.observed.push(event.data)
        event.stopImmediatePropagation()
      } else if (event.data.type === 'snapshot') {
        state.snapshots++
        state.simulationTime = event.data.simulationTimeSeconds
      }
    })
  }
}
// Observe the active direct path at the same fixed-step boundary as the
// experimental worker probe. These hooks are never imported by production.
const fixedStep = RaceEngine.prototype.stepFixed
const previousInputs = new WeakMap<RaceEngine, Map<string, string>>()
RaceEngine.prototype.stepFixed = function() {
  const inputs = (this as unknown as { inputs: Map<string, DriverInput> }).inputs
  const previous = previousInputs.get(this) ?? new Map<string, string>()
  previousInputs.set(this, previous)
  for (const [id, input] of inputs) {
    if (!id.startsWith('player-')) continue
    const value = JSON.stringify(input)
    if (previous.get(id) === value) continue
    previous.set(id, value)
    state.observed.push({ id, input: { ...input }, timestamp: performance.timeOrigin + performance.now() })
  }
  return fixedStep.call(this)
}
const advanceFrame = LocalRaceRuntime.prototype.advanceFrame
LocalRaceRuntime.prototype.advanceFrame = function(...args) {
  advanceFrame.apply(this, args)
  state.simulationTime = this.getSimulationTimeSeconds()
}
const setInputs = LocalRaceRuntime.prototype.setInputs
const previousSent = new Map<string, string>()
LocalRaceRuntime.prototype.setInputs = function(inputs) {
  if (!this.getDiagnostics().worker) {
    const changed: Record<string, DriverInput> = {}
    for (const [id, input] of Object.entries(inputs)) {
      const value = JSON.stringify(input)
      if (previousSent.get(id) === value) continue
      previousSent.set(id, value)
      changed[id] = { ...input }
    }
    if (Object.keys(changed).length) state.sent.push({ inputs: changed, timestamp: performance.timeOrigin + performance.now() })
  }
  setInputs.call(this, inputs)
}
for (const type of ['keydown', 'keyup']) window.addEventListener(type, event => {
  state.keys.push({ type, code: (event as KeyboardEvent).code,
    timestamp: performance.timeOrigin + event.timeStamp,
    receivedTimestamp: performance.timeOrigin + performance.now() })
})
const params = new URLSearchParams(location.search)
const mode = params.get('mode') === 'local' ? 'local' : 'solo'
const count = Number(params.get('cars') ?? (mode === 'local' ? 2 : 1))
const engine = new RaceEngine({ track: testingWindow.probeTrack, mode, racers: performanceRacers(mode, count) })
createRoot(document.getElementById('root')!).render(<RaceCanvas
  engine={engine} mode={mode} timeOfDay="day" controlSchemes={{ playerOne: 'arrows', playerTwo: 'wasd' }}
  onAbort={() => { state.stopped = true }} onRestart={() => {}} onFinished={() => {}}
/>)
