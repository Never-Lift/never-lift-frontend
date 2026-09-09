import { describe, expect, it } from 'vitest'
import { CollisionScratch } from './collision-scratch'
import { colliderBounds } from './rigid-body-collision'
import { sweepCompoundCollidersWithRotation } from './continuous-collision'
import { createVehicleWorldCollider } from './vehicle-geometry'
import { polygonGeometry } from './polygon-cache'

describe('bounded collision scratch storage', () => {
  it('reuses buffers but clears every pose-dependent cache before changing vertices', () => {
    const scratch = new CollisionScratch()
    const shape = { id: 'shape', vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }
    const first = scratch.transform(shape, (vertex, target) => { target.x = vertex.x; target.y = vertex.y })
    const cache = polygonGeometry(first.vertices)
    cache.axes = [{ x: 1, y: 0 }]; cache.sweepAxes = cache.axes
    cache.center = { x: 0, y: 0 }; cache.convex = true; cache.radius = { x: 0, y: 0, value: 1 }
    expect(colliderBounds(first).maxX).toBe(1)
    scratch.reset()
    const next = scratch.transform(shape, (vertex, target) => { target.x = vertex.x + 10; target.y = vertex.y + 10 })
    expect(next.vertices).toBe(first.vertices)
    expect(cache.axes).toBeUndefined(); expect(cache.sweepAxes).toBeUndefined()
    expect(cache.center).toBeUndefined(); expect(cache.convex).toBe(true); expect(cache.radius).toBeUndefined()
    expect(colliderBounds(next).minX).toBe(10)
    expect(shape.vertices[0].x).toBe(0)
    expect(Object.keys(next.vertices)).toEqual(['0', '1', '2'])
  })

  it('never mutates a published CCD manifold when later queries reuse the arena', () => {
    const body = (x: number) => ({ position: { x, y: 0 }, velocity: { x: 0, y: 0 }, angularVelocity: 1,
      colliders: createVehicleWorldCollider({ position: { x, y: 0 }, angle: 0 }) })
    const impact = sweepCompoundCollidersWithRotation(body(0), body(1), 1 / 120)
    expect(impact).not.toBeNull()
    const preserved = structuredClone(impact)
    for (let index = 0; index < 12; index++) sweepCompoundCollidersWithRotation(body(100 + index), body(101 + index), 1 / 120)
    expect(impact).toEqual(preserved)
  })
})
