import type { Vector2 } from './types'

type PolygonCache = {
  bounds?: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }
  axes?: Vector2[]
  sweepAxes?: Vector2[]
  center?: Vector2
  convex?: boolean
  radius?: { x: number; y: number; value: number }
}

const geometryKey = Symbol('immutable-polygon-geometry')
type CachedVertices = readonly Vector2[] & { [geometryKey]?: PolygonCache }
const frozenGeometry = new WeakMap<readonly Vector2[], PolygonCache>()

function createGeometry(): PolygonCache {
  // One stable object layout, independent of which query (bounds/axes/radius)
  // touches a new pose first. CCD creates many short-lived vertex arrays.
  return { bounds: undefined, axes: undefined, sweepAxes: undefined, center: undefined, convex: undefined, radius: undefined }
}

/**
 * Geometry lives as long as its immutable vertex array, with no global strong
 * references or cache flushes. The non-enumerable symbol never enters snapshots
 * or JSON. Frozen caller-owned arrays remain supported without being modified.
 */
export function polygonGeometry(vertices: readonly Vector2[]): PolygonCache {
  const cached = (vertices as CachedVertices)[geometryKey]
  if (cached) return cached
  if (!Object.isExtensible(vertices)) {
    const existing = frozenGeometry.get(vertices)
    if (existing) return existing
    const geometry = createGeometry()
    frozenGeometry.set(vertices, geometry)
    return geometry
  }
  const geometry = createGeometry()
  Object.defineProperty(vertices, geometryKey, { value: geometry })
  return geometry
}
