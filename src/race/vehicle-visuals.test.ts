import { describe, expect, it } from 'vitest'

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

function paint(detail: 'race' | 'preview' = 'race') {
  const recording = createRecordingContext()
  drawVehicleVisual(recording.context, {
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

describe('single F1 visual painter', () => {
  it('draws the F1 silhouette with exposed tires and the selected paint', () => {
    const operations = paint().operations

    expect(operations).toContain('fill:#2d7dff')
    expect(
      operations.filter((operation) => operation.startsWith('fillRect:')),
    ).toHaveLength(6)
    expect(operations).toContain('ellipse')
    expect(operations).toContain('arc')
  })

  it('balances canvas state and preserves the caller paint state', () => {
    const { context, operations, getProperty } = createRecordingContext()
    context.fillStyle = '#abcdef'

    drawVehicleVisual(context, {
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
  })

  it('adds preview detail without changing the base F1 silhouette', () => {
    const raceOperations = paint('race').operations
    const previewOperations = paint('preview').operations

    expect(previewOperations.length).toBeGreaterThan(raceOperations.length)
    expect(previewOperations.slice(0, 16)).toEqual(raceOperations.slice(0, 16))
  })

  it('does not touch the canvas for invalid dimensions', () => {
    const { context, operations } = createRecordingContext()
    drawVehicleVisual(context, {
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
