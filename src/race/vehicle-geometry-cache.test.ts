import { describe, expect, it } from 'vitest'

import { polygonGeometry } from './polygon-cache'
import {
  createVehicleWorldCollider,
  updateVehicleWorldCollider,
} from './vehicle-geometry'

describe('collision-owned vehicle pose cache', () => {
  it('rewrites the same geometry buffers with the canonical rigid transform', () => {
    const colliders = createVehicleWorldCollider({
      position: { x: 18, y: -7 },
      angle: 0.25,
    })
    const colliderArrays = colliders.map((collider) => collider.vertices)
    const transform = {
      position: { x: -32, y: 41 },
      angle: 1.75,
    }

    const updated = updateVehicleWorldCollider(colliders, transform)
    const expected = createVehicleWorldCollider(transform)

    expect(updated).toBe(colliders)
    updated.forEach((collider, index) => {
      expect(collider.vertices).toBe(colliderArrays[index])
    })
    expect(updated).toEqual(expected)
    for (const collider of updated) {
      expect(polygonGeometry(collider.vertices).convex).toBe(true)
    }
  })

  it('retains a rigid collider radius while invalidating pose-dependent data', () => {
    const colliders = createVehicleWorldCollider({
      position: { x: 4, y: 9 },
      angle: 0.5,
    })
    const geometry = polygonGeometry(colliders[0].vertices)
    geometry.bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 }
    geometry.axes = [{ x: 1, y: 0 }]
    geometry.center = { x: 0.5, y: 0.5 }
    geometry.radius = { x: 4, y: 9, value: 2.75 }

    updateVehicleWorldCollider(colliders, {
      position: { x: 50, y: -20 },
      angle: 2.25,
    })

    expect(geometry.bounds).toBeUndefined()
    expect(geometry.axes).toBeUndefined()
    expect(geometry.center).toBeUndefined()
    expect(geometry.convex).toBe(true)
    expect(geometry.radius).toEqual({ x: 50, y: -20, value: 2.75 })
  })
})
