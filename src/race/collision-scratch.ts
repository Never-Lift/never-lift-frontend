import { resetPolygonGeometry } from './polygon-cache'
import type { Vector2 } from './types'
import type { WorldConvexCollider } from './vehicle-geometry'

/** Synchronous query-local arena. No scratch geometry may escape its owner. */
export class CollisionScratch {
  private readonly buckets = new Map<number, { buffers: Vector2[][]; cursor: number }>()
  private retainedBuffers = 0

  reset() {
    for (const bucket of this.buckets.values()) bucket.cursor = 0
  }

  vertices(count: number): Vector2[] {
    // Bound retained memory even after a pathological sweep.
    let bucket = this.buckets.get(count)
    if (!bucket) {
      if (this.retainedBuffers >= 4096) return Array.from({ length: count }, () => ({ x: 0, y: 0 }))
      bucket = { buffers: [], cursor: 0 }
      this.buckets.set(count, bucket)
    }
    const index = bucket.cursor++
    let vertices = bucket.buffers[index]
    if (!vertices) {
      vertices = Array.from({ length: count }, () => ({ x: 0, y: 0 }))
      if (this.retainedBuffers < 4096) {
        bucket.buffers[index] = vertices
        this.retainedBuffers++
      }
    }
    resetPolygonGeometry(vertices)
    return vertices
  }

  transform(collider: WorldConvexCollider, project: (vertex: Vector2, target: Vector2) => void): WorldConvexCollider {
    const vertices = this.vertices(collider.vertices.length)
    for (let index = 0; index < vertices.length; index++) project(collider.vertices[index], vertices[index])
    return { id: collider.id, collisionMaterial: collider.collisionMaterial, vertices }
  }
}
