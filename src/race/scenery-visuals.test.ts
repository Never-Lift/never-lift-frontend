import { describe, expect, it } from 'vitest'

import type { TrackSceneryObject } from '@/lib/api'
import {
  classifySceneryKind,
  drawSceneryVisual,
  getSceneryRenderLayer,
  getSceneryRotationOffset,
} from '@/race/scenery-visuals'

describe('scenery visual registry', () => {
  it.each([
    ['forest-cluster', 'vegetation'],
    ['marina-yachts', 'boat'],
    ['ferris-wheel', 'round-landmark'],
    ['observation-tower', 'tower'],
    ['main-grandstand', 'grandstand'],
    ['city-blocks', 'building'],
    ['alpine-hills', 'terrain'],
    ['waterfront', 'water'],
    ['track-overpass', 'bridge'],
    ['start-gantry', 'gantry'],
    ['escape-bollard', 'escape-obstacle'],
    ['floodlights', 'floodlight'],
    ['waterfront-towers', 'building'],
    ['city-skyline', 'building'],
    ['desert-expanse', 'terrain'],
    ['open-infield', 'terrain'],
    ['urban-park', 'vegetation'],
    ['bull-sculpture', 'tower'],
    ['chalet', 'building'],
  ] as const)('maps %s to a %s drawing', (kind, category) => {
    expect(classifySceneryKind(kind)).toBe(category)
  })

  it('keeps an explicit fallback for future contract kinds', () => {
    expect(classifySceneryKind('future-object')).toBe('generic')
  })

  it('renders the start gantry overhead and perpendicular to the track tangent', () => {
    expect(getSceneryRenderLayer('start-gantry')).toBe('overhead')
    expect(getSceneryRotationOffset('start-gantry')).toBe(Math.PI / 2)
    expect(getSceneryRenderLayer('grandstand')).toBe('ground')
    expect(getSceneryRotationOffset('grandstand')).toBe(0)
  })

  it('keeps the gantry crossbar thin over the driving line', () => {
    const rectangles: Array<{ width: number; height: number }> = []
    const context = new Proxy(
      {},
      {
        get: (_target, property) => {
          if (property === 'fillRect') {
            return (_x: number, _y: number, width: number, height: number) =>
              rectangles.push({ width, height })
          }
          return () => undefined
        },
        set: () => true,
      },
    ) as CanvasRenderingContext2D
    const gantry: TrackSceneryObject = {
      id: 'start-gantry',
      kind: 'start-gantry',
      position: { x: 0, y: 0 },
      rotation: 0,
      scale: 10,
    }

    drawSceneryVisual({
      context,
      object: gantry,
      pixelsPerMeter: 2,
      preset: 'park',
    })

    expect(rectangles).toHaveLength(1)
    expect(rectangles[0].width / rectangles[0].height).toBeGreaterThan(6)
  })
})
