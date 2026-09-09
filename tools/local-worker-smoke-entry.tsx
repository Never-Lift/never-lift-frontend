import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { RaceCanvas } from '../src/components/race/RaceCanvas'
import { RaceEngine } from '../src/race/RaceEngine'
import { SHORT_TRACK } from '../src/test/track-fixtures'
import '../src/index.css'

const state = { started: 0, stopped: 0, messages: 0, finished: 0, aborted: 0, last: null }
const testingWindow = window as unknown as { smoke: typeof state; smokeFinish: () => void }
testingWindow.smoke = state
const NativeWorker = window.Worker
window.Worker = class extends NativeWorker {
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options)
    state.started++
    this.addEventListener('message', event => { state.messages++; state.last = event.data })
  }
  terminate() { state.stopped++; super.terminate() }
}
const options = { track: SHORT_TRACK, mode: 'local' as const, maximumRaceSeconds: 60, racers: [
  { id: 'player-1', name: 'P1', kind: 'human' as const, color: '#2d7dff' },
  { id: 'player-2', name: 'P2', kind: 'human' as const, color: '#ff2e88' },
] }
export function App() {
  const [engine, setEngine] = useState(() => new RaceEngine(options))
  const [visible, setVisible] = useState(true)
  testingWindow.smokeFinish = () => { setEngine(new RaceEngine({ ...options, maximumRaceSeconds: 0.05 })); setVisible(true) }
  if (!visible) return <p>Stopped</p>
  return <RaceCanvas engine={engine} mode="local" timeOfDay="day"
    onRestart={() => setEngine(new RaceEngine(options))}
    onAbort={() => { state.aborted++; setVisible(false) }}
    onFinished={() => { state.finished++; setVisible(false) }} />
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
