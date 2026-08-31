import { describe, expect, it } from 'vitest'

import {
  classifyVehicleView,
  drawVehicleVisual,
  getFormulaWheelSpecs,
  projectVehiclePoint,
  vehicleYawRelativeToCamera,
} from '@/race/vehicle-visuals'

function createRecordingContext() {
  let properties = new Map<PropertyKey, unknown>([
    ['fillStyle', '#000000'],
    ['strokeStyle', '#000000'],
    ['lineWidth', 1],
  ])
  const propertyStack: Array<Map<PropertyKey, unknown>> = []
  const operations: string[] = []
  const coordinateOperation = (name: string) =>
    (...values: number[]) =>
      operations.push(
        `${name}:${values.map((value) => value.toFixed(2)).join(',')}`,
      )
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
        if (
          property === 'translate' ||
          property === 'moveTo' ||
          property === 'lineTo' ||
          property === 'arc' ||
          property === 'ellipse'
        ) {
          return coordinateOperation(String(property))
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

function paint(
  relativeYawRadians = -Math.PI / 4,
  detail: 'race' | 'preview' = 'race',
  damage: 'none' | 'total-loss' = 'none',
  length = 180,
  width = 66,
) {
  const recording = createRecordingContext()
  drawVehicleVisual(recording.context, {
    color: '#2d7dff',
    x: 160,
    y: 90,
    relativeYawRadians,
    length,
    width,
    detail,
    damage,
  })
  return recording
}

describe('multidirectional F1 view', () => {
  it('classifies rear, front, both sides and diagonal views', () => {
    expect(classifyVehicleView(0)).toBe('rear')
    expect(classifyVehicleView(Math.PI / 4)).toBe('rear-left')
    expect(classifyVehicleView(Math.PI / 2)).toBe('left-side')
    expect(classifyVehicleView(Math.PI)).toBe('front')
    expect(classifyVehicleView(-Math.PI / 2)).toBe('right-side')
    expect(classifyVehicleView(-Math.PI / 4)).toBe('rear-right')
  })

  it('paints continuously between two nearby angles', () => {
    const firstAngle = 0.01
    const secondAngle = 0.02

    const coordinates = (angle: number) =>
      paint(angle).operations.filter(
        (operation) =>
          operation.startsWith('moveTo:') || operation.startsWith('lineTo:'),
      )

    expect(coordinates(firstAngle)).not.toEqual(coordinates(secondAngle))
  })

  it('keeps every one-degree steering pose distinct across a full turn segment', () => {
    const poses = Array.from({ length: 21 }, (_, degrees) => {
      const angle = (degrees * Math.PI) / 180
      return paint(angle).operations
        .filter(
          (operation) =>
            operation.startsWith('moveTo:') || operation.startsWith('lineTo:'),
        )
        .join('|')
    })

    expect(new Set(poses).size).toBe(poses.length)
  })

  it('selects a separate relative view for each split-screen camera', () => {
    const vehicleOrientation = Math.PI / 2
    const firstCameraYaw = vehicleYawRelativeToCamera(0, vehicleOrientation)
    const secondCameraYaw = vehicleYawRelativeToCamera(
      Math.PI / 2,
      vehicleOrientation,
    )

    expect(classifyVehicleView(firstCameraYaw)).toBe('left-side')
    expect(classifyVehicleView(secondCameraYaw)).toBe('rear')
  })

  it('projects ground depth, lateral offset and height independently', () => {
    const projection = {
      relativeYawRadians: 0,
      length: 100,
      width: 40,
      groundDepthScale: 0.9,
      heightScale: 0.4,
    }
    const origin = projectVehiclePoint(
      { longitudinal: 0, lateral: 0, height: 0 },
      projection,
    )
    const front = projectVehiclePoint(
      { longitudinal: 0.5, lateral: 0, height: 0 },
      projection,
    )
    const right = projectVehiclePoint(
      { longitudinal: 0, lateral: 0.5, height: 0 },
      projection,
    )
    const raised = projectVehiclePoint(
      { longitudinal: 0, lateral: 0, height: 0.5 },
      projection,
    )

    expect(origin).toEqual({ x: 0, y: -0 })
    expect(front.y).toBeLessThan(origin.y)
    expect(right.x).toBeGreaterThan(origin.x)
    expect(raised.y).toBeLessThan(origin.y)
  })
})

describe('single F1 visual painter', () => {
  it('keeps tire envelopes inside the declared car width with plausible diameters', () => {
    const vehicleLengthMeters = 5.6
    const vehicleWidthMeters = 2

    for (const wheel of getFormulaWheelSpecs()) {
      const lateralCenter = 0.5 - wheel.lateralSize / 2
      expect(lateralCenter + wheel.lateralSize / 2).toBeLessThanOrEqual(0.5)

      const longitudinalDiameter =
        wheel.longitudinalSize * vehicleLengthMeters
      const verticalDiameter = wheel.heightSize * vehicleWidthMeters
      expect(verticalDiameter / longitudinalDiameter).toBeGreaterThan(0.85)
      expect(verticalDiameter / longitudinalDiameter).toBeLessThan(1.15)
    }
  })

  it('keeps the detailed F1 readable at its real race size', () => {
    const raceLength = 60
    const operations = paint(
      -Math.PI / 4,
      'race',
      'none',
      raceLength,
      raceLength / 2.8,
    ).operations

    expect(operations).toContain('fill:#2d7dff')
    expect(operations).toContain('fill:#2361c5')
    expect(operations).toContain('fill:#4c8efa')
    expect(operations).not.toContain('fill:#ff2e88')
    expect(operations).not.toContain('fill:#31c7ff')
    expect(
      operations.filter((operation) => operation === 'fill:#05070b').length,
    ).toBeGreaterThanOrEqual(4)
    expect(
      operations.filter((operation) => operation === 'stroke:#68727d').length,
    ).toBeGreaterThanOrEqual(4)
    expect(
      operations.filter((operation) => operation === 'stroke:#3a4857').length,
    ).toBeGreaterThanOrEqual(8)
    expect(
      operations.some((operation) => operation.startsWith('ellipse:')),
    ).toBe(true)
    expect(operations).toContain('fill:#07101b')
    expect(operations).toContain('fill:#718796')
    expect(operations).toContain('fill:#ff4055')
    expect(operations).toContain('stroke:#2d7dff')
  })

  it('derives restrained details from each approved base paint', () => {
    const approvedPaints = [
      { base: '#a84448', darkTone: '#81353a' },
      { base: '#365f82', darkTone: '#2a4a66' },
      { base: '#3f704f', darkTone: '#31573f' },
    ]

    for (const { base, darkTone } of approvedPaints) {
      const recording = createRecordingContext()
      drawVehicleVisual(recording.context, {
        color: base,
        x: 0,
        y: 0,
        relativeYawRadians: -Math.PI / 4,
        length: 60,
        width: 60 / 2.8,
      })

      expect(recording.operations).toContain(`fill:${base}`)
      expect(recording.operations).toContain(`fill:${darkTone}`)
      expect(recording.operations).not.toContain('fill:#ff2e88')
      expect(recording.operations).not.toContain('fill:#31c7ff')
      expect(recording.operations).not.toContain('stroke:#d8bd32')
    }
  })

  it('renders distinct rear, front and side silhouettes', () => {
    const coordinates = (angle: number) =>
      paint(angle).operations.filter(
        (operation) =>
          operation.startsWith('moveTo:') || operation.startsWith('lineTo:'),
      )

    const rear = coordinates(0)
    const front = coordinates(Math.PI)
    const left = coordinates(Math.PI / 2)
    const right = coordinates(-Math.PI / 2)

    expect(front).not.toEqual(rear)
    expect(left).not.toEqual(rear)
    expect(right).not.toEqual(left)
  })

  it('balances canvas state and preserves the caller paint state', () => {
    const { context, operations, getProperty } = createRecordingContext()
    context.fillStyle = '#abcdef'

    drawVehicleVisual(context, {
      color: '#2d7dff',
      x: 100,
      y: 80,
      relativeYawRadians: 0.4,
      length: 150,
      width: 58,
    })

    const saves = operations.filter((operation) => operation === 'save').length
    const restores = operations.filter((operation) => operation === 'restore').length
    expect(operations).toContain('fill:#2d7dff')
    expect(saves).toBeGreaterThan(0)
    expect(restores).toBe(saves)
    expect(getProperty('fillStyle')).toBe('#abcdef')
  })

  it('adds preview detail without changing the selected F1 paint', () => {
    const raceOperations = paint(0, 'race').operations
    const previewOperations = paint(0, 'preview').operations

    expect(previewOperations.length).toBeGreaterThan(raceOperations.length)
    expect(previewOperations).toContain('fill:#2d7dff')
  })

  it('adds damage marks and darkens the car on total loss', () => {
    const healthy = paint(0, 'race', 'none').operations
    const totalLoss = paint(0, 'race', 'total-loss').operations

    expect(totalLoss.length).toBeGreaterThan(healthy.length)
    expect(totalLoss).toContain('stroke:rgba(7, 11, 20, 0.88)')
    expect(totalLoss).not.toContain('fill:#2d7dff')
    expect(totalLoss).not.toContain('fill:#ff2e88')
  })

  it('does not touch the canvas for invalid dimensions', () => {
    const { context, operations } = createRecordingContext()
    drawVehicleVisual(context, {
      color: '#2d7dff',
      x: 0,
      y: 0,
      relativeYawRadians: 0,
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
      relativeYawRadians: 0,
      length: 140,
      width: 50,
      shadowAngleRadians: 0,
      shadowDistanceToWidthRatio: 0.4,
      shadowOpacity: 0.3,
    })

    expect(operations).toContain('translate:100.00,80.00')
    expect(operations).toContain('translate:20.00,0.00')
    expect(operations).toContain('fill:rgba(0, 0, 0, 0.3)')
  })
})
