import type { LocalRaceOverlayState } from './LocalRaceSession'
import type { DriverInput, InterpolatedVehicleState, RaceEngineOptions, RaceResultEntry, RaceStatus } from './types'

// Browser-local transport only. This is NOT an online authority/protocol.
export type LocalWorkerRequest =
  | { type: 'init'; options: RaceEngineOptions; humanIds: string[] }
  | { type: 'frame'; inputs: Record<string, DriverInput> }
  | { type: 'visibility'; paused: boolean }

export type LocalWorkerSnapshot = {
  type: 'snapshot'
  timestamp: number
  simulationTimeSeconds: number
  physicsMilliseconds: number
  vehicles: InterpolatedVehicleState[]
  overlay: LocalRaceOverlayState
  status: RaceStatus
  results: RaceResultEntry[]
}

export type LocalWorkerResponse = LocalWorkerSnapshot | { type: 'failure'; message: string }

export interface RaceWorkerPort {
  postMessage(message: LocalWorkerRequest): void
  terminate(): void
  onmessage: ((event: MessageEvent<LocalWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent) => void) | null
}
