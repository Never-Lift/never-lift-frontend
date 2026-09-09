import { polygonGeometry, resetPolygonGeometry } from './polygon-cache'
import type { Vector2 } from './types'
import type { WorldConvexCollider } from './vehicle-geometry'

/** Synchronous query-local arena. No scratch geometry may escape its owner. */
export class CollisionScratch {
  private readonly buckets = new Map<number, {
    buffers: Array<{ vertices: Vector2[]; collider: WorldConvexCollider }>
    cursor: number
  }>()
  private retainedBuffers = 0

  reset() {
    for (const bucket of this.buckets.values()) bucket.cursor = 0
  }

  private take(count: number) {
    // Bound retained memory even after a pathological sweep.
    let bucket = this.buckets.get(count)
    if (!bucket) {
      if (this.retainedBuffers >= 4096) {
        const vertices = Array.from({ length: count }, () => ({ x: 0, y: 0 }))
        return { vertices, collider: { id: '', vertices } }
      }
      bucket = { buffers: [], cursor: 0 }
      this.buckets.set(count, bucket)
    }
    const index = bucket.cursor++
    let buffer = bucket.buffers[index]
    if (!buffer) {
      const vertices = Array.from({ length: count }, () => ({ x: 0, y: 0 }))
      buffer = { vertices, collider: { id: '', vertices } }
      if (this.retainedBuffers < 4096) {
        bucket.buffers[index] = buffer
        this.retainedBuffers++
      }
    }
    resetPolygonGeometry(buffer.vertices)
    return buffer
  }

  vertices(count: number): Vector2[] {
    return this.take(count).vertices
  }

  transform(collider: WorldConvexCollider, project: (vertex: Vector2, target: Vector2) => void): WorldConvexCollider {
    const buffer = this.take(collider.vertices.length)
    const vertices = buffer.vertices
    for (let index = 0; index < vertices.length; index++) project(collider.vertices[index], vertices[index])
    polygonGeometry(vertices).convex = true
    buffer.collider.id = collider.id
    buffer.collider.collisionMaterial = collider.collisionMaterial
    return buffer.collider
  }
}
