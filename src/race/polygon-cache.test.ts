import { describe, expect, it } from 'vitest'

import { polygonGeometry } from './polygon-cache'

describe('immutable polygon geometry cache', () => {
  it('reuses geometry without entering snapshots or changing coordinates', () => {
    const vertices = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }]
    const original = structuredClone(vertices)
    const cache = polygonGeometry(vertices)
    cache.convex = true
    expect(polygonGeometry(vertices)).toBe(cache)
    expect(vertices).toEqual(original)
    expect(JSON.stringify(vertices)).toBe(JSON.stringify(original))
    expect(structuredClone(vertices)).toEqual(original)
    expect(polygonGeometry(structuredClone(vertices))).not.toBe(cache)
  })

  it('also caches frozen arrays without attaching any properties', () => {
    const vertices = Object.freeze([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }])
    expect(polygonGeometry(vertices)).toBe(polygonGeometry(vertices))
    expect(Object.getOwnPropertySymbols(vertices)).toHaveLength(0)
  })
})
