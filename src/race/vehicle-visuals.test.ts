import { describe, expect, it } from 'vitest'

import type { VehicleProfileId } from '@/race/types'
import { drawVehicleVisual } from '@/race/vehicle-visuals'

function createRecordingContext() {
  let properties = new Map<PropertyKey, unknown>([
    ['fillStyle', '#000000'],
    ['strokeStyle', '#000000'],
    ['lineWidth', 1],
  ])
  const propertyStack: Array<Map<PropertyKey, unknown>> = []
  const operations: string[] = []
  const context = new Proxy(
    {},
    {
      get: (_target, property) => {
        if (property === 'save') {
          return () => {
            propertyStack.push(new Map(properties))
            operations.push('save')
          }
        }
        if (property === 'restore') {
          return () => {
            properties = propertyStack.pop() ?? properties
            operations.push('restore')
          }
        }
        if (property === 'fill') {
          return () => operations.push(`fill:${String(properties.get('fillStyle'))}`)
        }
        if (property === 'stroke') {
          return () =>
            operations.push(`stroke:${String(properties.get('strokeStyle'))}`)
        }
        if (property === 'fillRect') {
          return () => operations.push(`fillRect:${String(properties.get('fillStyle'))}`)
        }
        if (property === 'translate') {
          return (x: number, y: number) =>
            operations.push(`translate:${x.toFixed(2)},${y.toFixed(2)}`)
        }
        return (..._arguments: unknown[]) => operations.push(String(property))
      },
      set: (_target, property, value) => {
        properties.set(property, value)
        return true
      },
    },
  ) as CanvasRenderingContext2D

  return {
    context,
    operations,
    getProperty: (property: PropertyKey) => properties.get(property),
  }
}

function paint(profileId: VehicleProfileId, detail: 'race' | 'preview' = 'race') {
  const recording = createRecordingContext()
  drawVehicleVisual(recording.context, {
    profileId,
    color: '#2d7dff',
    x: 160,
    y: 90,
    angleRadians: -0.2,
    length: 180,
    width: 66,
    detail,
  })
  return recording
}

describe('vehicle visual painter', () => {
  it('draws immediately distinct optimized silhouettes for all three profiles', () => {
    const formula = paint('formula').operations
    const supercar = paint('supercar').operations
    const drift = paint('drift').operations

    const fingerprint = (operations: string[]) =>
      operations.filter((operation) =>
        /^(fillRect|ellipse|arc|bezierCurveTo|quadraticCurveTo|fill:|stroke:)/.test(
          operation,
        ),
      )

    expect(fingerprint(formula)).not.toEqual(fingerprint(supercar))
    expect(fingerprint(formula)).not.toEqual(fingerprint(drift))
    expect(fingerprint(supercar)).not.toEqual(fingerprint(drift))
    expect(formula.filter((operation) => operation.startsWith('fillRect:'))).toHaveLength(6)
    expect(supercar.some((operation) => operation === 'bezierCurveTo')).toBe(true)
    expect(drift.some((operation) => operation === 'quadraticCurveTo')).toBe(true)
  })

  it.each(['formula', 'supercar', 'drift'] as const)(
    'keeps the selected paint and balances canvas state for %s',
    (profileId) => {
      const { context, operations, getProperty } = createRecordingContext()
      context.fillStyle = '#abcdef'

      drawVehicleVisual(context, {
        profileId,
        color: '#2d7dff',
        x: 100,
        y: 80,
        angleRadians: 0.4,
        length: 150,
        width: 58,
      })

      expect(operations).toContain('fill:#2d7dff')
      expect(operations.filter((operation) => operation === 'save')).toHaveLength(4)
      expect(operations.filter((operation) => operation === 'restore')).toHaveLength(4)
      expect(getProperty('fillStyle')).toBe('#abcdef')
    },
  )

  it.each(['formula', 'supercar', 'drift'] as const)(
    'adds selection detail without changing the %s silhouette painter',
    (profileId) => {
      const raceOperations = paint(profileId, 'race').operations
      const previewOperations = paint(profileId, 'preview').operations

      expect(previewOperations.length).toBeGreaterThan(raceOperations.length)
      expect(previewOperations.slice(0, 16)).toEqual(raceOperations.slice(0, 16))
    },
  )

  it('does not touch the canvas for invalid dimensions', () => {
    const { context, operations } = createRecordingContext()
    drawVehicleVisual(context, {
      profileId: 'formula',
      color: '#2d7dff',
      x: 0,
      y: 0,
      angleRadians: 0,
      length: 0,
      width: 40,
    })

    expect(operations).toEqual([])
  })

  it('keeps contact shadow while applying the requested light direction', () => {
    const { context, operations } = createRecordingContext()
    drawVehicleVisual(context, {
      profileId: 'supercar',
      color: '#2d7dff',
      x: 100,
      y: 80,
      angleRadians: 0,
      length: 140,
      width: 50,
      shadowAngleRadians: 0,
      shadowDistanceToWidthRatio: 0.4,
      shadowOpacity: 0.3,
    })

    expect(operations).toContain('translate:120.00,80.00')
    expect(operations).toContain('translate:100.00,82.00')
  })
})
