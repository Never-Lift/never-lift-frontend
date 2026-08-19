import { resolveVehicleCollision } from '@/race/collision'
import {
  PHYSICS_CONSTANTS,
  PHYSICS_STEP_SECONDS,
} from '@/race/constants'
import {
  clamp,
  lerp,
  lerpAngle,
  magnitude,
  normalize,
  normalizeAngle,
  signedAngleDelta,
  TAU,
} from '@/race/math'
import {
  getBarrierContacts,
  getCenterlinePoint,
  getSurfaceAt,
  getTrackAngle,
} from '@/race/test-oval'
import type {
  DriverInput,
  InterpolatedVehicleState,
  RaceEngineOptions,
  RaceResultEntry,
  RaceStatus,
  VehicleSetup,
  VehicleState,
} from '@/race/types'
import {
  applyBarrierResponse,
  getCollisionRadius,
  integrateVehicle,
} from '@/race/vehicle-physics'

const NEUTRAL_INPUT: DriverInput = {
  throttle: 0,
  brake: 0,
  steer: 0,
  nitro: false,
}
function cloneVehicle(vehicle: VehicleState): VehicleState {
  return {
    ...vehicle,
    position: { ...vehicle.position },
    previousPosition: { ...vehicle.previousPosition },
    velocity: { ...vehicle.velocity },
    damage: { ...vehicle.damage },
  }
}

function createVehicle(
  setup: VehicleSetup,
  index: number,
  handlingMode: RaceEngineOptions['handlingMode'],
): VehicleState {
  const startAngle = -0.07 - Math.floor(index / 2) * 0.11
  const centerline = getCenterlinePoint(startAngle)
  const radialNormal = normalize({
    x: centerline.x / (52 * 52),
    y: centerline.y / (28 * 28),
  })
  const rowOffset = index % 2 === 0 ? -2.1 : 2.1
  const position = {
    x: centerline.x + radialNormal.x * rowOffset,
    y: centerline.y + radialNormal.y * rowOffset,
  }

  return {
    ...setup,
    handlingMode,
    position,
    previousPosition: { ...position },
    velocity: { x: 0, y: 0 },
    angle: normalizeAngle(startAngle + Math.PI / 2),
    previousAngle: normalizeAngle(startAngle + Math.PI / 2),
    yawRate: 0,
    surface: 'asphalt',
    damage: {
      kind: 'none',
      health: PHYSICS_CONSTANTS.damage.thresholds.maximumHealth,
      engineDamaged: false,
      steeringDamaged: false,
      steeringPull: 0,
      impactCount: 0,
      lastImpactSpeed: 0,
    },
    progressRadians: 0,
    previousTrackAngle: normalizeAngle(getTrackAngle(position)),
    currentLap: 1,
    lapStartedAtSeconds: 0,
    bestLapTimeSeconds: null,
    finished: false,
    finishTimeSeconds: null,
  }
}

export class RaceEngine {
  readonly mode: RaceEngineOptions['mode']
  readonly handlingMode: RaceEngineOptions['handlingMode']
  readonly lapCount: number
  readonly maximumRaceSeconds: number

  private accumulatorSeconds = 0
  private simulationTimeSeconds = 0
  private status: RaceStatus = 'running'
  private readonly vehicles: VehicleState[]
  private readonly inputs = new Map<string, DriverInput>()

  constructor(options: RaceEngineOptions) {
    if (options.racers.length < 2 || options.racers.length > 4) {
      throw new Error('A corrida precisa ter entre 2 e 4 competidores.')
    }

    this.mode = options.mode
    this.handlingMode = options.handlingMode
    this.lapCount = options.lapCount ?? 1
    this.maximumRaceSeconds = options.maximumRaceSeconds ?? 60
    this.vehicles = options.racers.map((racer, index) =>
      createVehicle(racer, index, this.handlingMode),
    )
    for (const vehicle of this.vehicles) {
      this.inputs.set(vehicle.id, { ...NEUTRAL_INPUT })
    }
  }

  setInput(racerId: string, input: DriverInput) {
    if (!this.inputs.has(racerId)) return
    this.inputs.set(racerId, {
      throttle: clamp(input.throttle, 0, 1),
      brake: clamp(input.brake, 0, 1),
      steer: clamp(input.steer, -1, 1),
      nitro: input.nitro,
    })
  }

  advanceFrame(frameDeltaSeconds: number) {
    if (this.status === 'finished') return 0

    const simulation = PHYSICS_CONSTANTS.simulation
    this.accumulatorSeconds += clamp(
      frameDeltaSeconds,
      0,
      simulation.maxFrameCatchUpSeconds,
    )
    let steps = 0
    while (
      this.accumulatorSeconds + Number.EPSILON >= PHYSICS_STEP_SECONDS &&
      steps < simulation.maxSubstepsPerFrame
    ) {
      this.stepFixed()
      this.accumulatorSeconds -= PHYSICS_STEP_SECONDS
      steps += 1
    }

    if (
      steps === simulation.maxSubstepsPerFrame &&
      this.accumulatorSeconds >= PHYSICS_STEP_SECONDS
    ) {
      this.accumulatorSeconds %= PHYSICS_STEP_SECONDS
    }
    return steps
  }

  stepFixed() {
    if (this.status === 'finished') return

    for (const vehicle of this.vehicles) {
      vehicle.previousPosition = { ...vehicle.position }
      vehicle.previousAngle = vehicle.angle

      const input = vehicle.finished
        ? { ...NEUTRAL_INPUT }
        : vehicle.kind === 'bot'
          ? this.createBotInput(vehicle)
          : (this.inputs.get(vehicle.id) ?? NEUTRAL_INPUT)
      const surface = getSurfaceAt(vehicle.position)
      integrateVehicle(vehicle, input, surface, PHYSICS_STEP_SECONDS)

      for (const contact of getBarrierContacts(
        vehicle.position,
        getCollisionRadius(),
      )) {
        applyBarrierResponse(
          vehicle,
          contact.pushNormal,
          contact.penetrationMeters,
        )
      }
    }

    for (let firstIndex = 0; firstIndex < this.vehicles.length; firstIndex += 1) {
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < this.vehicles.length;
        secondIndex += 1
      ) {
        resolveVehicleCollision(
          this.vehicles[firstIndex],
          this.vehicles[secondIndex],
        )
      }
    }

    this.simulationTimeSeconds += PHYSICS_STEP_SECONDS
    for (const vehicle of this.vehicles) this.updateProgress(vehicle)

    const humanRacers = this.vehicles.filter((vehicle) => vehicle.kind === 'human')
    if (
      humanRacers.every((vehicle) => vehicle.finished) ||
      this.simulationTimeSeconds >= this.maximumRaceSeconds
    ) {
      this.status = 'finished'
    }
  }

  private createBotInput(vehicle: VehicleState): DriverInput {
    const difficultyId = vehicle.botDifficulty ?? 'normal'
    const difficulty = PHYSICS_CONSTANTS.bots[difficultyId]
    const trackAngle = getTrackAngle(vehicle.position)
    const speed = magnitude(vehicle.velocity)
    const lookAhead = 0.16 + speed * 0.0025
    const target = getCenterlinePoint(trackAngle + lookAhead)
    const desiredHeading = Math.atan2(
      target.y - vehicle.position.y,
      target.x - vehicle.position.x,
    )
    const headingError = signedAngleDelta(vehicle.angle, desiredHeading)
    const deterministicNoise =
      Math.sin(
        this.simulationTimeSeconds * 2.1 +
          vehicle.id.split('').reduce((sum, letter) => sum + letter.charCodeAt(0), 0),
      ) * difficulty.steeringNoise
    const steer = clamp(headingError / 0.6 + deterministicNoise, -1, 1)
    const needsBraking = Math.abs(headingError) > 0.72 && speed > 34

    return {
      throttle: needsBraking ? 0.15 : difficulty.paceMultiplier,
      brake: needsBraking ? 0.55 * difficulty.brakingSafetyMultiplier : 0,
      steer,
      nitro: false,
    }
  }

  private updateProgress(vehicle: VehicleState) {
    if (vehicle.finished) return

    const nextTrackAngle = normalizeAngle(getTrackAngle(vehicle.position))
    const delta = signedAngleDelta(vehicle.previousTrackAngle, nextTrackAngle)
    vehicle.previousTrackAngle = nextTrackAngle
    if (Math.abs(delta) < 0.35) {
      vehicle.progressRadians = Math.max(0, vehicle.progressRadians + delta)
    }

    const completedLaps = Math.floor(vehicle.progressRadians / TAU)
    const nextLap = Math.min(this.lapCount, completedLaps + 1)
    if (nextLap > vehicle.currentLap) {
      const lapTime = this.simulationTimeSeconds - vehicle.lapStartedAtSeconds
      vehicle.bestLapTimeSeconds = Math.min(
        vehicle.bestLapTimeSeconds ?? lapTime,
        lapTime,
      )
      vehicle.lapStartedAtSeconds = this.simulationTimeSeconds
      vehicle.currentLap = nextLap
    }

    if (vehicle.progressRadians >= this.lapCount * TAU) {
      const lapTime = this.simulationTimeSeconds - vehicle.lapStartedAtSeconds
      vehicle.bestLapTimeSeconds = Math.min(
        vehicle.bestLapTimeSeconds ?? lapTime,
        lapTime,
      )
      vehicle.finished = true
      vehicle.finishTimeSeconds = this.simulationTimeSeconds
    }
  }

  getStatus() {
    return this.status
  }

  getSimulationTimeSeconds() {
    return this.simulationTimeSeconds
  }

  getInterpolationAlpha() {
    return clamp(this.accumulatorSeconds / PHYSICS_STEP_SECONDS, 0, 1)
  }

  getVehicleState(racerId: string) {
    const vehicle = this.vehicles.find((candidate) => candidate.id === racerId)
    return vehicle ? cloneVehicle(vehicle) : null
  }

  getInterpolatedVehicles(): InterpolatedVehicleState[] {
    const alpha = this.getInterpolationAlpha()
    return this.vehicles.map((vehicle) => ({
      ...cloneVehicle(vehicle),
      renderPosition: {
        x: lerp(vehicle.previousPosition.x, vehicle.position.x, alpha),
        y: lerp(vehicle.previousPosition.y, vehicle.position.y, alpha),
      },
      renderAngle: lerpAngle(vehicle.previousAngle, vehicle.angle, alpha),
    }))
  }

  getResults(): RaceResultEntry[] {
    return [...this.vehicles]
      .sort((first, second) => {
        if (first.finished !== second.finished) return first.finished ? -1 : 1
        if (first.finished && second.finished) {
          return (
            (first.finishTimeSeconds ?? Number.POSITIVE_INFINITY) -
            (second.finishTimeSeconds ?? Number.POSITIVE_INFINITY)
          )
        }
        return second.progressRadians - first.progressRadians
      })
      .map((vehicle, index) => ({
        racerId: vehicle.id,
        racerName: vehicle.name,
        position: index + 1,
        totalTimeMs: vehicle.finished
          ? Math.max(1, Math.round((vehicle.finishTimeSeconds ?? 0) * 1000))
          : 0,
        bestLapTimeMs: vehicle.finished
          ? Math.max(1, Math.round((vehicle.bestLapTimeSeconds ?? 0) * 1000))
          : 0,
        finished: vehicle.finished,
      }))
  }
}
