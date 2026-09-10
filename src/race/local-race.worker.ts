import { LocalWorkerSimulation } from './LocalWorkerSimulation'
import type { LocalWorkerRequest, LocalWorkerResponse } from './local-worker-protocol'
import { PHYSICS_STEP_SECONDS } from './constants'

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<LocalWorkerRequest>) => void
  postMessage(message: LocalWorkerResponse): void
}
let simulation: LocalWorkerSimulation | undefined
let pendingSnapshot = false
let timer: ReturnType<typeof setTimeout> | undefined
let physicsMilliseconds = 0
const now = () => performance.timeOrigin + performance.now()
// MessageChannel yields to input/snapshot messages without the 4ms minimum
// delay imposed on nested setTimeout(0). Never busy-spin or lower physics Hz.
const continuation = new MessageChannel()
continuation.port1.onmessage = () => tick()

function sendSnapshot() {
  if (!simulation) return
  const timestamp = now()
  // A sliced catch-up may still have wall time waiting to be simulated. Stamp
  // the pose with the instant it actually represents instead of pretending it
  // already reached `timestamp`; otherwise the following pose appears to jump.
  scope.postMessage(
    simulation.snapshot(
      simulation.getSnapshotTimestamp(timestamp),
      physicsMilliseconds,
    ),
  )
  physicsMilliseconds = 0
  pendingSnapshot = false
}

function fail(error: unknown) {
  clearTimeout(timer)
  scope.postMessage({ type: 'failure', message: error instanceof Error ? error.message : 'Simulation failed' })
  simulation = undefined
}

function tick() {
  if (!simulation) return
  const started = performance.now()
  try {
    simulation.tick(now(), PHYSICS_STEP_SECONDS)
    physicsMilliseconds += performance.now() - started
    if (pendingSnapshot) sendSnapshot()
    // 120 Hz remains in RaceEngine's accumulator, not in timer accuracy.
    // A delayed wake-up advances every due tick using the existing catch-up rule.
    const delay = 1000 / 120 - (performance.now() - started)
    if (simulation.hasPendingTick() || delay <= 0) continuation.port2.postMessage(null)
    else timer = setTimeout(tick, delay)
  } catch (error) { fail(error) }
}

scope.onmessage = ({ data }) => {
  try {
    if (data.type === 'init') {
      clearTimeout(timer)
      simulation = new LocalWorkerSimulation(data.options, data.humanIds, now())
      // Construction is not counted as race time.
      simulation.setPaused(false, now())
      sendSnapshot()
      timer = setTimeout(tick, 0)
    } else if (data.type === 'frame' && simulation) {
      simulation.setInputs(data.inputs)
      pendingSnapshot = true
    } else if (data.type === 'visibility' && simulation) {
      simulation.setPaused(data.paused, now())
    }
  } catch (error) { fail(error) }
}
