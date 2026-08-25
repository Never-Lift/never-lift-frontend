import physicsConstants from '../../contracts/module-2/v2/physics-constants.json'
import vehicleDefinition from '../../contracts/module-2/v2/vehicle-definition.json'

export const VEHICLE_DEFINITION = vehicleDefinition

const terminalSpeedMetersPerSecond = Math.cbrt(
  (2 *
    physicsConstants.powertrain.maxPowerWatts *
    physicsConstants.powertrain.drivetrainEfficiency) /
    (physicsConstants.environment.airDensityKgPerCubicMeter *
      physicsConstants.vehicle.dragAreaM2),
)

/**
 * Compatibility facade used by the existing renderer/race shell. Every value
 * is mapped from the published v2 contract; v1 is never imported or mutated.
 */
export const PHYSICS_CONSTANTS = {
  version: physicsConstants.version,
  simulation: physicsConstants.simulation,
  environment: physicsConstants.environment,
  vehicle: physicsConstants.vehicle,
  vehiclePerformance: {
    massKg: physicsConstants.vehicle.massKg,
    maxForwardSpeed: terminalSpeedMetersPerSecond,
  },
  vehicleVisual: {
    lengthMeters: vehicleDefinition.dimensions.lengthMeters,
    widthMeters: vehicleDefinition.dimensions.widthMeters,
  },
  collision: physicsConstants.collision,
  damage: {
    thresholds: {
      minimumImpactSpeed:
        physicsConstants.damage.minimumDeltaVMetersPerSecond,
      mediumImpactSpeed:
        physicsConstants.damage.mediumDeltaVMetersPerSecond,
      combinedImpactSpeed:
        physicsConstants.damage.combinedDeltaVMetersPerSecond,
      totalLossImpactSpeed:
        physicsConstants.damage.totalLossDeltaVMetersPerSecond,
      maximumHealth: physicsConstants.damage.maximumHealth,
      healthDamagePerImpactSpeed:
        physicsConstants.damage.healthDamagePerDeltaV,
    },
    effects: {
      engineTorqueMultiplier:
        physicsConstants.damage.engineTorqueMultiplier,
      enginePowerMultiplier:
        physicsConstants.damage.enginePowerMultiplier,
      steeringPullStrength:
        physicsConstants.damage.steeringPullStrength,
      totalLossDragMultiplier:
        physicsConstants.damage.totalLossDragMultiplier,
      totalLossLinearDragNewtonSecondsPerMeter:
        physicsConstants.damage.totalLossLinearDragNewtonSecondsPerMeter,
    },
  },
  race: physicsConstants.race,
  bots: physicsConstants.bots,
} as const

export const PHYSICS_STEP_SECONDS =
  physicsConstants.simulation.physicsStepSeconds
export const DAMAGE_THRESHOLDS = PHYSICS_CONSTANTS.damage.thresholds
export const DAMAGE_EFFECTS = PHYSICS_CONSTANTS.damage.effects
export const GRAVITY_METERS_PER_SECOND_SQUARED =
  physicsConstants.environment.gravityMetersPerSecondSquared
export const NUMERIC_SPEED_EPSILON_METERS_PER_SECOND =
  physicsConstants.simulation.numericSpeedEpsilonMetersPerSecond

export const VEHICLE_DYNAMICS = {
  massKg: physicsConstants.vehicle.massKg,
  wheelbaseMeters: physicsConstants.vehicle.wheelbaseMeters,
  centerOfMassToFrontAxleMeters:
    physicsConstants.vehicle.frontAxleDistanceFromComMeters,
  centerOfMassToRearAxleMeters:
    physicsConstants.vehicle.rearAxleDistanceFromComMeters,
  centerOfMassHeightMeters:
    physicsConstants.vehicle.centerOfMassHeightMeters,
  yawInertiaKgMetersSquared: physicsConstants.vehicle.yawInertiaKgM2,
  wheelRadiusMeters: physicsConstants.vehicle.wheelRadiusMeters,
  frontalAerodynamicAreaCoefficient:
    physicsConstants.vehicle.dragAreaM2,
  downforceAreaCoefficient: physicsConstants.vehicle.liftAreaM2,
  aerodynamicBalanceFront: physicsConstants.vehicle.aeroBalanceFront,
  airDensityKgPerCubicMeter:
    physicsConstants.environment.airDensityKgPerCubicMeter,
  rollingResistanceCoefficient:
    physicsConstants.vehicle.rollingResistanceCoefficient,
  maximumSteeringAngleRadians:
    physicsConstants.vehicle.maxSteeringAngleRadians,
  totalLossDragMultiplier:
    physicsConstants.damage.totalLossDragMultiplier,
} as const

export const CONTROL_RAMP_RATES = {
  throttleRisePerSecond: physicsConstants.controls.throttleRisePerSecond,
  throttleFallPerSecond: physicsConstants.controls.throttleFallPerSecond,
  brakeRisePerSecond: physicsConstants.controls.brakeRisePerSecond,
  brakeFallPerSecond: physicsConstants.controls.brakeFallPerSecond,
  steeringActuationRadiansPerSecond:
    physicsConstants.controls.steeringActuationRadiansPerSecond,
  steeringReturnRadiansPerSecond:
    physicsConstants.controls.steeringReturnRadiansPerSecond,
} as const

export const POWERTRAIN = {
  idleRpm: physicsConstants.powertrain.idleRpm,
  upshiftRpm: physicsConstants.powertrain.upshiftRpm,
  automaticUpshiftWheelSlipAllowance:
    physicsConstants.powertrain.automaticUpshiftWheelSlipAllowance,
  downshiftRpm: physicsConstants.powertrain.downshiftRpm,
  redlineRpm: physicsConstants.powertrain.redlineRpm,
  maximumTorqueNewtonMeters: physicsConstants.powertrain.maxTorqueNm,
  maximumPowerWatts: physicsConstants.powertrain.maxPowerWatts,
  finalDriveRatio: physicsConstants.powertrain.finalDriveRatio,
  forwardGearRatios: physicsConstants.powertrain.gearRatios,
  reverseGearRatio: physicsConstants.powertrain.reverseGearRatio,
  reverseEngageSpeedMetersPerSecond:
    physicsConstants.powertrain.reverseEngageSpeedMetersPerSecond,
  reverseInputThreshold:
    physicsConstants.powertrain.reverseInputThreshold,
  drivetrainEfficiency: physicsConstants.powertrain.drivetrainEfficiency,
  gearShiftDurationSeconds:
    physicsConstants.powertrain.shiftDurationSeconds,
  maximumBrakeForceNewtons:
    physicsConstants.powertrain.maximumBrakeForceNewtons,
  frontBrakeBias: physicsConstants.powertrain.frontBrakeBias,
  frontWheelAssemblyMassKg:
    physicsConstants.powertrain.frontWheelAssemblyMassKg,
  rearWheelAssemblyMassKg:
    physicsConstants.powertrain.rearWheelAssemblyMassKg,
  wheelAssemblyInertiaFactor:
    physicsConstants.powertrain.wheelAssemblyInertiaFactor,
  rearDrivelineRotationalInertiaKgMetersSquared:
    physicsConstants.powertrain.rearDrivelineRotationalInertiaKgM2,
  frontAxleRotationalInertiaKgMetersSquared:
    physicsConstants.powertrain.frontAxleRotationalInertiaKgM2,
  rearAxleRotationalInertiaKgMetersSquared:
    physicsConstants.powertrain.rearAxleRotationalInertiaKgM2,
} as const

export const TIRE_MODEL = {
  peakFrictionCoefficient:
    physicsConstants.tires.referenceFrictionCoefficient,
  loadSensitivityExponent:
    physicsConstants.tires.loadSensitivityExponent,
  frontCorneringStiffnessNewtonsPerRadian:
    physicsConstants.tires.frontCorneringStiffnessNPerRadian,
  rearCorneringStiffnessNewtonsPerRadian:
    physicsConstants.tires.rearCorneringStiffnessNPerRadian,
  longitudinalStiffnessNewtonsPerSlip:
    physicsConstants.tires.longitudinalStiffnessNPerSlip,
  minimumSlipSpeedMetersPerSecond:
    physicsConstants.tires.minimumSlipSpeedMetersPerSecond,
} as const

export const SURFACE_DYNAMICS = Object.fromEntries(
  Object.entries(physicsConstants.surfaces).map(([surfaceId, surface]) => [
    surfaceId,
    {
      gripMultiplier: surface.gripMultiplier,
      corneringStiffnessMultiplier: surface.corneringMultiplier,
      rollingResistanceMultiplier: surface.rollingResistanceMultiplier,
      roughnessDragNewtonSecondsPerMeter:
        surface.roughnessDragNewtonSecondsPerMeter,
    },
  ]),
) as {
  [SurfaceId in keyof typeof physicsConstants.surfaces]: {
    gripMultiplier: number
    corneringStiffnessMultiplier: number
    rollingResistanceMultiplier: number
    roughnessDragNewtonSecondsPerMeter: number
  }
}
