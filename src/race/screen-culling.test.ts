import { describe, expect, it } from 'vitest'
import { screenBoundsVisible, screenPathVisible } from './screen-culling'

const viewport = { x: 100, y: 100, width: 100, height: 100 }
describe('conservative primitive screen culling', () => {
  it('keeps lines that cross the viewport even with both endpoints outside', () => {
    expect(screenPathVisible([{ x: 0, y: 150 }, { x: 300, y: 150 }], viewport)).toBe(true)
    expect(screenPathVisible([{ x: 150, y: 0 }, { x: 150, y: 300 }], viewport)).toBe(true)
  })
  it('keeps polygons surrounding the screen, thick lines and exact borders', () => {
    expect(screenPathVisible([{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }], viewport)).toBe(true)
    expect(screenBoundsVisible(80, 120, 90, 180, viewport, 10)).toBe(true)
    expect(screenBoundsVisible(90, 120, 100, 180, viewport)).toBe(true)
    expect(screenBoundsVisible(90, 120, 99, 180, viewport)).toBe(false)
  })
  it('handles split viewports independently without discarding effects at their edge', () => {
    const first = { x: 0, y: 0, width: 960, height: 1080 }
    const second = { ...first, x: 960 }
    expect(screenBoundsVisible(1300, 0, 1310, 100, first, 2)).toBe(false)
    expect(screenBoundsVisible(1300, 0, 1310, 100, second, 2)).toBe(true)
    expect(screenBoundsVisible(959, 0, 962, 100, first, 2)).toBe(true)
    expect(screenBoundsVisible(959, 0, 962, 100, second, 2)).toBe(true)
    expect(screenBoundsVisible(NaN, 0, 0, 0, first)).toBe(true)
    expect(screenPathVisible([{ x: -1000, y: -1000 }], undefined)).toBe(true)
  })
})
