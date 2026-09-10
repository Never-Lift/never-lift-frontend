import { createRoot } from 'react-dom/client'
import { RaceCanvas } from '../src/components/race/RaceCanvas'
import { RaceEngine } from '../src/race/RaceEngine'
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
