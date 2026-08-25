import referenceScenarios from '../../contracts/module-2/v2/physics-reference-scenarios.json'

import {
  PHYSICS_STEP_SECONDS,
  TIRE_MODEL,
  VEHICLE_DYNAMICS,
} from '@/race/constants'
import { dot, magnitude, signedAngleDelta } from '@/race/math'
import { bodyAxes } from '@/race/physics-utils'
import type {
  DriverInput,
  SurfaceId,
  VehicleState,
} from '@/race/types'
import { integrateVehicle } from '@/race/vehicle-physics'

export type PhysicsReferenceInitialState = {
  x: number
  y: number
  velocityX: number
  velocityY: number
  angle: number
  yawRate: number
  steeringAngle: number
  appliedThrottle: number
  appliedBrake: number
  frontWheelAngularSpeed: number
  rearWheelAngularSpeed: number
  gear: number
  engineRpm: number
  gearShiftTimeRemaining: number
}

export type PhysicsReferenceScenario = {
  id: string
  category: string
  description: string
  surface: SurfaceId
  steps: number
  initialState: PhysicsReferenceInitialState
  inputSegments: Array<{
    fromStep: number
    toStep: number
    input: DriverInput
  }>
  environment?: {
    barrier?: {
      from: { x: number; y: number }
      to: { x: number; y: number }
      material:
        | 'concrete-wall'
        | 'guardrail'
        | 'tecpro'
        | 'tyre-barrier'
    }
  }
  expectedRanges: PhysicsReferenceExpectedRange[]
}

export type PhysicsReferenceExpectedRange = {
  metric: string
  minimum?: number
  maximum?: number
  expectedBoolean?: boolean
}

export type PhysicsReferenceMetricValue = number | boolean
export type PhysicsReferenceMetrics = Record<
  string,
  PhysicsReferenceMetricValue
>

export type PhysicsReferenceStepContext = {
  scenario: PhysicsReferenceScenario
  step: number
  input: DriverInput
  previousVehicle: VehicleState
  vehicle: VehicleState
}

export type PhysicsReferenceEnvironmentAdapter = {
  afterVehicleStep: (
    context: PhysicsReferenceStepContext,
  ) => Partial<PhysicsReferenceMetrics> | void
}

export type PhysicsReferenceFailure = {
  metric: string
  actual: PhysicsReferenceMetricValue | undefined
  expected: PhysicsReferenceExpectedRange
  reason: 'missing' | 'minimum' | 'maximum' | 'boolean'
}

export const PHYSICS_REFERENCE_SCENARIOS =
  referenceScenarios.scenarios as PhysicsReferenceScenario[]

function createReferenceVehicle(
  initialState: PhysicsReferenceInitialState,
): VehicleState {
  const position = { x: initialState.x, y: initialState.y }
  return {
    id: 'physics-reference',
    name: 'Physics reference',
    kind: 'human',
    color: '#2d7dff',
    position,
    previousPosition: { ...position },
    velocity: {
      x: initialState.velocityX,
      y: initialState.velocityY,
    },
    angle: initialState.angle,
    previousAngle: initialState.angle,
    yawRate: initialState.yawRate,
    physicsState: {
      yawRate: initialState.yawRate,
      steeringAngle: initialState.steeringAngle,
      appliedThrottle: initialState.appliedThrottle,
      appliedBrake: initialState.appliedBrake,
      frontWheelAngularSpeed: initialState.frontWheelAngularSpeed,
      rearWheelAngularSpeed: initialState.rearWheelAngularSpeed,
      gear: initialState.gear,
      engineRpm: initialState.engineRpm,
      gearShiftTimeRemaining: initialState.gearShiftTimeRemaining,
      longitudinalSpeed: initialState.velocityX,
      lateralSpeed: initialState.velocityY,
      longitudinalAcceleration: 0,
      lateralAcceleration: 0,
      frontSlipAngle: 0,
      rearSlipAngle: 0,
      frontGripUtilization: 0,
      rearGripUtilization: 0,
    },
    surface: 'asphalt',
    trackLayer: 0,
    trackDistanceMeters: 0,
    damage: {
      kind: 'none',
      health: 100,
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

function cloneVehicle(vehicle: VehicleState): VehicleState {
  return {
    ...vehicle,
    position: { ...vehicle.position },
    previousPosition: { ...vehicle.previousPosition },
    velocity: { ...vehicle.velocity },
    physicsState: { ...vehicle.physicsState },
    damage: { ...vehicle.damage },
  }
}

function inputAtStep(scenario: PhysicsReferenceScenario, step: number) {
  return (
    scenario.inputSegments.find(
      (segment) => step >= segment.fromStep && step < segment.toStep,
    )?.input ?? { throttle: 0, brake: 0, steer: 0 }
  )
}

function allStateNumbersAreFinite(vehicle: VehicleState) {
  return [
    vehicle.position.x,
    vehicle.position.y,
    vehicle.velocity.x,
    vehicle.velocity.y,
    vehicle.angle,
    vehicle.yawRate,
    ...Object.values(vehicle.physicsState),
  ].every(Number.isFinite)
}

function mergeAdapterMetrics(
  target: PhysicsReferenceMetrics,
  update: Partial<PhysicsReferenceMetrics> | void,
) {
  if (!update) return
  for (const [metric, value] of Object.entries(update)) {
    if (value === undefined) continue
    const current = target[metric]
    target[metric] =
      typeof value === 'boolean' && typeof current === 'boolean'
        ? current || value
        : value
  }
}

function executeFixedSteps(
  scenario: PhysicsReferenceScenario,
  adapter?: PhysicsReferenceEnvironmentAdapter,
) {
  const vehicle = createReferenceVehicle(scenario.initialState)
  const initialPosition = { ...vehicle.position }
  let distanceMeters = 0
  let maximumSpeedMetersPerSecond = magnitude(vehicle.velocity)
  let maximumAbsoluteYawRate = Math.abs(vehicle.physicsState.yawRate)
  let maximumFrontCombinedGripUsage = 0
  let maximumRearCombinedGripUsage = 0
  let minimumFrontWheelSlipRatio = Number.POSITIVE_INFINITY
  let maximumFrontWheelSlipRatio = Number.NEGATIVE_INFINITY
  let minimumRearWheelSlipRatio = Number.POSITIVE_INFINITY
  let maximumRearWheelSlipRatio = Number.NEGATIVE_INFINITY
  let maximumEngineRpm = vehicle.physicsState.engineRpm
  let maximumGear = vehicle.physicsState.gear
  let timeTo100KphSeconds = -1
  let timeTo200KphSeconds = -1
  let timeTo300KphSeconds = -1
  let stateIsFinite = true
  let repeatedExactDrivenSpeeds = 0
  let hardSpeedClampObserved = false
  const adapterMetrics: PhysicsReferenceMetrics = {}

  for (let step = 0; step < scenario.steps; step += 1) {
    const input = inputAtStep(scenario, step)
    const previousVehicle = cloneVehicle(vehicle)
    vehicle.previousPosition = { ...vehicle.position }
    vehicle.previousAngle = vehicle.angle
    const previousSpeed = magnitude(vehicle.velocity)
    integrateVehicle(
      vehicle,
      input,
      scenario.surface,
      PHYSICS_STEP_SECONDS,
    )
    mergeAdapterMetrics(
      adapterMetrics,
      adapter?.afterVehicleStep({
        scenario,
        step,
        input,
        previousVehicle,
        vehicle,
      }),
    )

    distanceMeters += Math.hypot(
      vehicle.position.x - previousVehicle.position.x,
      vehicle.position.y - previousVehicle.position.y,
    )
    const speed = magnitude(vehicle.velocity)
    maximumSpeedMetersPerSecond = Math.max(
      maximumSpeedMetersPerSecond,
      speed,
    )
    maximumAbsoluteYawRate = Math.max(
      maximumAbsoluteYawRate,
      Math.abs(vehicle.physicsState.yawRate),
    )
    maximumFrontCombinedGripUsage = Math.max(
      maximumFrontCombinedGripUsage,
      vehicle.physicsState.frontGripUtilization,
    )
    maximumRearCombinedGripUsage = Math.max(
      maximumRearCombinedGripUsage,
      vehicle.physicsState.rearGripUtilization,
    )
    maximumEngineRpm = Math.max(
      maximumEngineRpm,
      vehicle.physicsState.engineRpm,
    )
    maximumGear = Math.max(maximumGear, vehicle.physicsState.gear)
    const { forward } = bodyAxes(vehicle.angle)
    const longitudinalSpeed = dot(vehicle.velocity, forward)
    const slipReference = Math.max(
      Math.abs(longitudinalSpeed),
      TIRE_MODEL.minimumSlipSpeedMetersPerSecond,
    )
    const frontSlip =
      (vehicle.physicsState.frontWheelAngularSpeed *
        VEHICLE_DYNAMICS.wheelRadiusMeters -
        longitudinalSpeed) /
      slipReference
    const rearSlip =
      (vehicle.physicsState.rearWheelAngularSpeed *
        VEHICLE_DYNAMICS.wheelRadiusMeters -
        longitudinalSpeed) /
      slipReference
    minimumFrontWheelSlipRatio = Math.min(
      minimumFrontWheelSlipRatio,
      frontSlip,
    )
    maximumFrontWheelSlipRatio = Math.max(
      maximumFrontWheelSlipRatio,
      frontSlip,
    )
    minimumRearWheelSlipRatio = Math.min(
      minimumRearWheelSlipRatio,
      rearSlip,
    )
    maximumRearWheelSlipRatio = Math.max(
      maximumRearWheelSlipRatio,
      rearSlip,
    )
    const elapsedSeconds = (step + 1) * PHYSICS_STEP_SECONDS
    if (timeTo100KphSeconds < 0 && speed >= 100 / 3.6) {
      timeTo100KphSeconds = elapsedSeconds
    }
    if (timeTo200KphSeconds < 0 && speed >= 200 / 3.6) {
      timeTo200KphSeconds = elapsedSeconds
    }
    if (timeTo300KphSeconds < 0 && speed >= 300 / 3.6) {
      timeTo300KphSeconds = elapsedSeconds
    }
    stateIsFinite &&= allStateNumbersAreFinite(vehicle)
    repeatedExactDrivenSpeeds =
      input.throttle > 0 && speed === previousSpeed
        ? repeatedExactDrivenSpeeds + 1
        : 0
    hardSpeedClampObserved ||= repeatedExactDrivenSpeeds > 1
  }

  return {
    vehicle,
    metrics: {
      maximumSpeedMetersPerSecond,
      finalSpeedMetersPerSecond: magnitude(vehicle.velocity),
      distanceMeters,
      displacementMeters: Math.hypot(
        vehicle.position.x - initialPosition.x,
        vehicle.position.y - initialPosition.y,
      ),
      absoluteYawRateAtEnd: Math.abs(vehicle.physicsState.yawRate),
      maximumAbsoluteYawRate,
      maximumFrontCombinedGripUsage,
      maximumRearCombinedGripUsage,
      minimumFrontWheelSlipRatio,
      maximumFrontWheelSlipRatio,
      minimumRearWheelSlipRatio,
      maximumRearWheelSlipRatio,
      maximumEngineRpm,
      maximumGear,
      timeTo100KphSeconds,
      timeTo200KphSeconds,
      timeTo300KphSeconds,
      stateIsFinite,
      hardSpeedClampObserved,
      surfaceSpeedClampObserved: hardSpeedClampObserved,
      absInterventionObserved: false,
      tractionControlInterventionObserved: false,
      ...adapterMetrics,
    } as PhysicsReferenceMetrics,
  }
}

export function mirrorPhysicsReferenceScenario(
  scenario: PhysicsReferenceScenario,
): PhysicsReferenceScenario {
  return {
    ...scenario,
    initialState: {
      ...scenario.initialState,
      y: -scenario.initialState.y,
      velocityY: -scenario.initialState.velocityY,
      angle: -scenario.initialState.angle,
      yawRate: -scenario.initialState.yawRate,
      steeringAngle: -scenario.initialState.steeringAngle,
    },
    inputSegments: scenario.inputSegments.map((segment) => ({
      ...segment,
      input: { ...segment.input, steer: -segment.input.steer },
    })),
  }
}

function statesMatchWithinContractTolerance(
  first: VehicleState,
  second: VehicleState,
  mirrored: boolean,
) {
  const tolerance = referenceScenarios.tolerance
  const mirror = mirrored ? -1 : 1
  const firstPhysics = first.physicsState
  const secondPhysics = second.physicsState
  return (
    Math.abs(first.position.x - second.position.x) <=
      tolerance.positionMeters &&
    Math.abs(first.position.y - mirror * second.position.y) <=
      tolerance.positionMeters &&
    Math.abs(first.velocity.x - second.velocity.x) <=
      tolerance.velocityMetersPerSecond &&
    Math.abs(first.velocity.y - mirror * second.velocity.y) <=
      tolerance.velocityMetersPerSecond &&
    Math.abs(
      signedAngleDelta(first.angle, mirror * second.angle),
    ) <=
      tolerance.angleRadians &&
    Math.abs(
      firstPhysics.yawRate - mirror * secondPhysics.yawRate,
    ) <= tolerance.angleRadians &&
    Math.abs(
      firstPhysics.steeringAngle -
        mirror * secondPhysics.steeringAngle,
    ) <= tolerance.angleRadians &&
    Math.abs(
      firstPhysics.frontWheelAngularSpeed -
        secondPhysics.frontWheelAngularSpeed,
    ) <= tolerance.wheelRadiansPerSecond &&
    Math.abs(
      firstPhysics.rearWheelAngularSpeed -
        secondPhysics.rearWheelAngularSpeed,
    ) <= tolerance.wheelRadiansPerSecond &&
    Math.abs(firstPhysics.engineRpm - secondPhysics.engineRpm) <=
      tolerance.engineRpm &&
    firstPhysics.gear === secondPhysics.gear &&
    Math.abs(
      firstPhysics.gearShiftTimeRemaining -
        secondPhysics.gearShiftTimeRemaining,
    ) <= PHYSICS_STEP_SECONDS + Number.EPSILON &&
    Math.abs(firstPhysics.appliedThrottle - secondPhysics.appliedThrottle) <=
      Number.EPSILON &&
    Math.abs(firstPhysics.appliedBrake - secondPhysics.appliedBrake) <=
      Number.EPSILON
  )
}

function executeWithRenderFrames(
  scenario: PhysicsReferenceScenario,
  framesPerSecond: number,
) {
  const vehicle = createReferenceVehicle(scenario.initialState)
  let accumulator = 0
  let step = 0
  const durationSeconds = scenario.steps * PHYSICS_STEP_SECONDS
  const frameCount = Math.round(durationSeconds * framesPerSecond)
  for (let frame = 0; frame < frameCount; frame += 1) {
    accumulator += 1 / framesPerSecond
    while (
      accumulator + Number.EPSILON >= PHYSICS_STEP_SECONDS &&
      step < scenario.steps
    ) {
      integrateVehicle(
        vehicle,
        inputAtStep(scenario, step),
        scenario.surface,
        PHYSICS_STEP_SECONDS,
      )
      accumulator -= PHYSICS_STEP_SECONDS
      step += 1
    }
  }
  return vehicle
}

export function runPhysicsReferenceScenario(
  scenario: PhysicsReferenceScenario,
  adapter?: PhysicsReferenceEnvironmentAdapter,
) {
  const execution = executeFixedSteps(scenario, adapter)
  if (scenario.id === 'left-right-symmetry') {
    const mirrored = executeFixedSteps(
      mirrorPhysicsReferenceScenario(scenario),
    )
    execution.metrics.mirrorSymmetryWithinTolerance =
      statesMatchWithinContractTolerance(
        execution.vehicle,
        mirrored.vehicle,
        true,
      )
    const at30 = executeWithRenderFrames(scenario, 30)
    const at60 = executeWithRenderFrames(scenario, 60)
    const at120 = executeWithRenderFrames(scenario, 120)
    execution.metrics.renderFpsIndependent =
      statesMatchWithinContractTolerance(at30, at60, false) &&
      statesMatchWithinContractTolerance(at30, at120, false)
  }
  return execution
}

/**
 * Evaluates a scenario without encoding any scenario id in the test suite.
 * Adding a range to the published JSON automatically makes it mandatory here.
 */
export function evaluatePhysicsReferenceScenario(
  scenario: PhysicsReferenceScenario,
  metrics: PhysicsReferenceMetrics,
) {
  const failures: PhysicsReferenceFailure[] = []
  for (const expected of scenario.expectedRanges) {
    const actual = metrics[expected.metric]
    if (actual === undefined) {
      failures.push({
        metric: expected.metric,
        actual,
        expected,
        reason: 'missing',
      })
      continue
    }
    if (
      expected.expectedBoolean !== undefined &&
      actual !== expected.expectedBoolean
    ) {
      failures.push({
        metric: expected.metric,
        actual,
        expected,
        reason: 'boolean',
      })
    }
    if (
      expected.minimum !== undefined &&
      (typeof actual !== 'number' || actual < expected.minimum)
    ) {
      failures.push({
        metric: expected.metric,
        actual,
        expected,
        reason: 'minimum',
      })
    }
    if (
      expected.maximum !== undefined &&
      (typeof actual !== 'number' || actual > expected.maximum)
    ) {
      failures.push({
        metric: expected.metric,
        actual,
        expected,
        reason: 'maximum',
      })
    }
  }
  return failures
}
