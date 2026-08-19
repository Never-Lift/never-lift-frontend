import physicsConstants from '../../contracts/module-2/v1/physics-constants.json'

export const PHYSICS_CONSTANTS = physicsConstants
export const PHYSICS_STEP_SECONDS =
  PHYSICS_CONSTANTS.simulation.physicsStepSeconds

export const DAMAGE_THRESHOLDS = PHYSICS_CONSTANTS.damage.thresholds
export const DAMAGE_EFFECTS = PHYSICS_CONSTANTS.damage.effects
export const TEST_OVAL = {
  trackId: 'albert-park',
  trackCatalogVersion: '2026.1',
  name: 'Oval técnico — geometria temporária 2a',
  centerline: { radiusX: 52, radiusY: 28 },
  asphalt: {
    innerRadiusX: 39,
    innerRadiusY: 15,
    outerRadiusX: 65,
    outerRadiusY: 41,
  },
  barriers: {
    innerRadiusX: 34,
    innerRadiusY: 10,
    outerRadiusX: 71,
    outerRadiusY: 47,
  },
} as const
