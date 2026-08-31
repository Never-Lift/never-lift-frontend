import { describe, expect, it } from 'vitest'

import { resolveVehicleAgainstStaticColliders } from '@/race/collision'
import { PHYSICS_STEP_SECONDS } from '@/race/constants'
import {
  evaluatePhysicsReferenceScenario,
  PHYSICS_REFERENCE_SCENARIOS,
  runPhysicsReferenceScenario,
} from '@/race/physics-reference-runner'
import { F1_VEHICLE_COLLIDER } from '@/race/vehicle-geometry'

const VEHICLE_SCENARIOS = PHYSICS_REFERENCE_SCENARIOS.filter(
  (scenario) => !scenario.environment?.barrier,
)
const COLLISION_SCENARIOS = PHYSICS_REFERENCE_SCENARIOS.filter(
  (scenario) => scenario.environment?.barrier,
)

describe('published v2 vehicle reference scenarios', () => {
  it.each(VEHICLE_SCENARIOS)('$id satisfies every published range', (scenario) => {
    const { metrics } = runPhysicsReferenceScenario(scenario)
    const failures = evaluatePhysicsReferenceScenario(scenario, metrics)

    expect(failures, JSON.stringify({ metrics, failures }, null, 2)).toEqual(
      [],
    )
  })

  it.each(COLLISION_SCENARIOS)(
    '$id satisfies every published collision range',
    (scenario) => {
      const barrier = scenario.environment!.barrier!
      const thicknessMeters = 0.4
      const wall = {
        id: `reference-${barrier.material}`,
        collisionMaterial: barrier.material,
        vertices: [
          barrier.from,
          barrier.to,
          { x: barrier.to.x + thicknessMeters, y: barrier.to.y },
          { x: barrier.from.x + thicknessMeters, y: barrier.from.y },
        ],
      }
      const { metrics } = runPhysicsReferenceScenario(scenario, {
        afterVehicleStep: ({ vehicle }) => {
          resolveVehicleAgainstStaticColliders(
            vehicle,
            PHYSICS_STEP_SECONDS,
            () => [wall],
          )
          return {
            tunnelingObserved:
              vehicle.position.x - F1_VEHICLE_COLLIDER.lengthMeters / 2 >
              barrier.from.x + thicknessMeters,
          }
        },
      })
      const failures = evaluatePhysicsReferenceScenario(scenario, metrics)

      expect(failures, JSON.stringify({ metrics, failures }, null, 2)).toEqual(
        [],
      )
    },
  )
})
