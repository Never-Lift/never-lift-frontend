import {
  resolveVehicleBarrierCollisions,
  resolveVehicleCollision,
} from '@/race/collision'
import {
  PHYSICS_CONSTANTS,
  PHYSICS_STEP_SECONDS,
} from '@/race/constants'
import {
  clamp,
  lerp,
  lerpAngle,
  magnitude,
  normalizeAngle,
  signedAngleDelta,
} from '@/race/math'
import { crossesGate, TrackGeometry } from '@/race/TrackGeometry'
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
  createInitialVehiclePhysicsState,
  integrateVehicle,
} from '@/race/vehicle-physics'

const NEUTRAL_INPUT: DriverInput = {
  throttle: 0,
  brake: 0,
  steer: 0,
}
export const MAX_RACE_PARTICIPANTS = 22
const GRID_ROW_SPACING_METERS = 8
const GRID_LATERAL_OFFSET_METERS = 2.2

function cloneVehicle(vehicle: VehicleState): VehicleState {
  return {
    ...vehicle,
    position: { ...vehicle.position },
    previousPosition: { ...vehicle.previousPosition },
    velocity: { ...vehicle.velocity },
    damage: { ...vehicle.damage },
    physicsState: { ...vehicle.physicsState },
  }
}

function createVehicle(
  setup: VehicleSetup,
  index: number,
  geometry: TrackGeometry,
): VehicleState {
  const publishedGridSlot = geometry.definition.gridSlots[index]
  const row = Math.floor(index / 2) + 1
  const gridDistanceMeters =
    geometry.definition.lengthMeters - row * GRID_ROW_SPACING_METERS
  const centerlinePoint = geometry.getCenterlinePoint(gridDistanceMeters)
  const tangent = geometry.getCenterlineTangent(gridDistanceMeters)
  const lateralOffset =
    index % 2 === 0
      ? -GRID_LATERAL_OFFSET_METERS
      : GRID_LATERAL_OFFSET_METERS
  const generatedGridSlot = {
    position: {
      x: centerlinePoint.x - tangent.y * lateralOffset,
      y: centerlinePoint.y + tangent.x * lateralOffset,
    },
    angle: Math.atan2(tangent.y, tangent.x),
  }
  const gridSlot = publishedGridSlot ?? generatedGridSlot
  const position = { ...gridSlot.position }
  const startAngle = normalizeAngle(gridSlot.angle)

  return {
    ...setup,
    position,
    previousPosition: { ...position },
    velocity: { x: 0, y: 0 },
    angle: startAngle,
    previousAngle: startAngle,
    yawRate: 0,
    physicsState: createInitialVehiclePhysicsState(),
    surface: 'asphalt',
    trackLayer: geometry.getElevationLayerAt(position, 0),
    trackDistanceMeters: 0,
    damage: {
      kind: 'none',
      health: PHYSICS_CONSTANTS.damage.thresholds.maximumHealth,
      engineDamaged: false,
      steeringDamaged: false,
      steeringPull: 0,
      impactCount: 0,
      lastImpactSpeed: 0,
    },
    nextCheckpointIndex: 0,
    lapProgressMeters: 0,
    totalProgressMeters: 0,
    currentLap: 1,
    lapStartedAtSeconds: 0,
    bestLapTimeSeconds: null,
    finished: false,
    finishTimeSeconds: null,
  }
}

export class RaceEngine {
  readonly track: RaceEngineOptions['track']
  readonly mode: RaceEngineOptions['mode']
  readonly lapCount: number
  readonly maximumRaceSeconds: number

  private accumulatorSeconds = 0
  private simulationTimeSeconds = 0
  private status: RaceStatus = 'running'
  private readonly geometry: TrackGeometry
  private readonly vehicles: VehicleState[]
  private readonly inputs = new Map<string, DriverInput>()

  constructor(options: RaceEngineOptions) {
    if (
      options.racers.length < 1 ||
      options.racers.length > MAX_RACE_PARTICIPANTS
    ) {
      throw new Error(
        `A corrida precisa ter entre 1 e ${MAX_RACE_PARTICIPANTS} competidores.`,
      )
    }

    this.track = options.track
    this.geometry = new TrackGeometry(options.track)
    this.mode = options.mode
    this.lapCount = options.lapCount ?? 1
    this.maximumRaceSeconds =
      options.maximumRaceSeconds ??
      Math.max(
        PHYSICS_CONSTANTS.race.minimumRaceDurationSeconds,
        (options.track.lengthMeters * this.lapCount) /
          PHYSICS_CONSTANTS.race.raceDurationReferenceSpeedMetersPerSecond,
      )
    this.vehicles = options.racers.map((racer, index) =>
      createVehicle(racer, index, this.geometry),
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
      const surface = this.geometry.getSurfaceAt(
        vehicle.position,
        vehicle.trackDistanceMeters,
      )
      integrateVehicle(vehicle, input, surface, PHYSICS_STEP_SECONDS)
      resolveVehicleBarrierCollisions(
        vehicle,
        this.geometry,
        PHYSICS_STEP_SECONDS,
      )
      const trackProjection = this.geometry.project(
        vehicle.position,
        vehicle.trackDistanceMeters,
      )
      vehicle.trackDistanceMeters = trackProjection.distanceMeters
      vehicle.trackLayer = trackProjection.elevationLayer
    }

    for (let firstIndex = 0; firstIndex < this.vehicles.length; firstIndex += 1) {
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < this.vehicles.length;
        secondIndex += 1
      ) {
        if (
          this.vehicles[firstIndex].trackLayer !==
          this.vehicles[secondIndex].trackLayer
        ) {
          continue
        }
        resolveVehicleCollision(
          this.vehicles[firstIndex],
          this.vehicles[secondIndex],
          PHYSICS_STEP_SECONDS,
        )
      }
    }

    // A car-car impulse can move a vehicle into a nearby canonical wall face.
    // Resolve only the resulting overlap here; replaying the whole swept step
    // would apply the vehicle's already-consumed motion a second time.
    for (const vehicle of this.vehicles) {
      resolveVehicleBarrierCollisions(vehicle, this.geometry, 0)
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
    const planner = PHYSICS_CONSTANTS.bots.planner
    const speed = magnitude(vehicle.velocity)
    const projection = this.geometry.project(
      vehicle.position,
      vehicle.trackDistanceMeters,
    )
    const steeringLookAheadMeters =
      planner.steeringLookAheadBaseMeters +
      speed * planner.steeringLookAheadSpeedSeconds +
      Math.max(
        0,
        planner.steeringLookAheadReactionReferenceSeconds -
          difficulty.steeringLookAheadPenaltySeconds,
      ) * planner.steeringLookAheadReactionGainMetersPerSecond
    const target = this.geometry.getRacingLinePoint(
      projection.distanceMeters + steeringLookAheadMeters,
    )
    const desiredHeading = Math.atan2(
      target.y - vehicle.position.y,
      target.x - vehicle.position.x,
    )
    const headingError = signedAngleDelta(vehicle.angle, desiredHeading)
    const deterministicNoise =
      Math.sin(
        this.simulationTimeSeconds *
          planner.steeringNoiseFrequencyRadiansPerSecond +
          vehicle.id.split('').reduce((sum, letter) => sum + letter.charCodeAt(0), 0),
      ) * difficulty.steeringNoise
    const brakingHorizonMeters =
      planner.brakingLookAheadBaseMeters +
      speed *
        (planner.brakingLookAheadSpeedSeconds +
          difficulty.recoveryMultiplier *
            planner.brakingLookAheadRecoveryGainSeconds)
    let upcomingSpeedFactor = target.targetSpeedFactor
    for (
      let sample = 1;
      sample <= planner.brakingPreviewSampleCount;
      sample += 1
    ) {
      const preview = this.geometry.getRacingLinePoint(
        projection.distanceMeters +
          (brakingHorizonMeters * sample) /
            planner.brakingPreviewSampleCount,
      )
      upcomingSpeedFactor = Math.min(
        upcomingSpeedFactor,
        preview.targetSpeedFactor,
      )
    }
    const targetSpeed =
      PHYSICS_CONSTANTS.vehiclePerformance.maxForwardSpeed *
      upcomingSpeedFactor ** planner.racingLineSpeedFactorExponent *
      difficulty.paceMultiplier *
      planner.terminalSpeedTargetMultiplier
    const safeTargetSpeed =
      targetSpeed / difficulty.brakingSafetyMultiplier
    const isRecovering =
      vehicle.surface === 'grass' || vehicle.surface === 'gravel'
    const needsBraking =
      speed > safeTargetSpeed ||
      Math.abs(headingError) > planner.brakeHeadingErrorThresholdRadians
    const maximumBrake =
      planner.maximumBrakeBase +
      difficulty.recoveryMultiplier * planner.maximumBrakeRecoveryGain

    return {
      throttle: needsBraking
        ? isRecovering
          ? planner.brakingRecoveryThrottle
          : planner.brakingTrackThrottle
        : difficulty.paceMultiplier *
          (isRecovering
            ? planner.recoveryThrottleMultiplier
            : planner.trackThrottleMultiplier),
      brake: needsBraking
        ? clamp(
            planner.brakeDemandBase +
              Math.max(0, speed - safeTargetSpeed) /
                planner.brakeDemandSpeedScaleMetersPerSecond,
            0,
            maximumBrake,
          )
        : 0,
      steer: clamp(
        headingError / planner.steeringFullScaleHeadingErrorRadians +
          deterministicNoise,
        -1,
        1,
      ),
    }
  }

  private updateProgress(vehicle: VehicleState) {
    if (vehicle.finished) return

    const checkpoints = this.track.checkpoints
    const gateMargin = PHYSICS_CONSTANTS.race.checkpointGateMarginMeters
    const nextCheckpoint = checkpoints[vehicle.nextCheckpointIndex]
    if (
      nextCheckpoint &&
      crossesGate(
        vehicle.previousPosition,
        vehicle.position,
        nextCheckpoint,
        gateMargin,
      )
    ) {
      vehicle.nextCheckpointIndex += 1
      vehicle.lapProgressMeters = Math.max(
        vehicle.lapProgressMeters,
        nextCheckpoint.distanceMeters,
      )
    }

    const projection = this.geometry.project(
      vehicle.position,
      vehicle.trackDistanceMeters,
    )
    const previousGateDistance =
      vehicle.nextCheckpointIndex === 0
        ? 0
        : checkpoints[vehicle.nextCheckpointIndex - 1].distanceMeters
    const nextGateDistance =
      checkpoints[vehicle.nextCheckpointIndex]?.distanceMeters ??
      this.track.lengthMeters
    if (
      projection.distanceMeters >=
        previousGateDistance -
          PHYSICS_CONSTANTS.race.progressProjectionMarginMeters &&
      projection.distanceMeters <=
        nextGateDistance + PHYSICS_CONSTANTS.race.progressProjectionMarginMeters
    ) {
      vehicle.lapProgressMeters = Math.max(
        vehicle.lapProgressMeters,
        clamp(projection.distanceMeters, previousGateDistance, nextGateDistance),
      )
    }

    const completedAllCheckpoints =
      vehicle.nextCheckpointIndex === checkpoints.length
    if (
      completedAllCheckpoints &&
      crossesGate(
        vehicle.previousPosition,
        vehicle.position,
        this.track.startFinish,
        gateMargin,
      )
    ) {
      const lapTime = this.simulationTimeSeconds - vehicle.lapStartedAtSeconds
      vehicle.bestLapTimeSeconds = Math.min(
        vehicle.bestLapTimeSeconds ?? lapTime,
        lapTime,
      )
      if (vehicle.currentLap >= this.lapCount) {
        vehicle.finished = true
        vehicle.finishTimeSeconds = this.simulationTimeSeconds
        vehicle.lapProgressMeters = this.track.lengthMeters
      } else {
        vehicle.currentLap += 1
        vehicle.nextCheckpointIndex = 0
        vehicle.lapProgressMeters = 0
        vehicle.lapStartedAtSeconds = this.simulationTimeSeconds
      }
    }

    vehicle.totalProgressMeters =
      (vehicle.currentLap - 1) * this.track.lengthMeters +
      vehicle.lapProgressMeters
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
        return second.totalProgressMeters - first.totalProgressMeters
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
