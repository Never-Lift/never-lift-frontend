import type { TrackDefinition } from '@/lib/api'

function pointOnCircle(radius: number, angle: number) {
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
}

export function createTrackFixture(
  id: 'monaco' | 'spa-francorchamps' = 'monaco',
): TrackDefinition {
  const lengthMeters = id === 'monaco' ? 3337 : 7004
  const radius = lengthMeters / (Math.PI * 2)
  const segmentCount = Math.ceil(lengthMeters / 20)
  const centerline = Array.from({ length: segmentCount + 1 }, (_, index) => {
    const progress = index / segmentCount
    const angle = progress * Math.PI * 2
    return {
      ...pointOnCircle(radius, angle),
      distanceMeters: progress * lengthMeters,
      halfWidthMeters: 8,
    }
  })
  const racingLine = centerline.map((point, index) => ({
    x: point.x,
    y: point.y,
    distanceMeters: point.distanceMeters,
    targetSpeedFactor: index % 8 === 0 ? 0.72 : 0.88,
  }))
  const checkpoints = Array.from({ length: 8 }, (_, index) => {
    const progress = (index + 1) / 9
    const angle = progress * Math.PI * 2
    return {
      index,
      distanceMeters: progress * lengthMeters,
      position: pointOnCircle(radius, angle),
      forward: { x: -Math.sin(angle), y: Math.cos(angle) },
      halfWidthMeters: 10,
    }
  })
  const chunkLength = 250
  const chunkCount = Math.ceil(lengthMeters / chunkLength)
  const chunks = Array.from({ length: chunkCount }, (_, index) => {
    const fromDistanceMeters = index * chunkLength
    const toDistanceMeters = Math.min(lengthMeters, (index + 1) * chunkLength)
    const points = centerline.filter(
      (point) =>
        point.distanceMeters >= Math.max(0, fromDistanceMeters - 20) &&
        point.distanceMeters <= Math.min(lengthMeters, toDistanceMeters + 20),
    )
    return {
      index,
      fromDistanceMeters,
      toDistanceMeters,
      bounds: {
        minX: Math.min(...points.map((point) => point.x)) - 16,
        minY: Math.min(...points.map((point) => point.y)) - 16,
        maxX: Math.max(...points.map((point) => point.x)) + 16,
        maxY: Math.max(...points.map((point) => point.y)) + 16,
      },
    }
  })
  const start = pointOnCircle(radius, 0)
  return {
    schemaVersion: '1.1.0',
    catalogVersion: '2026.2',
    id,
    name: id === 'monaco' ? 'Circuit de Monaco' : 'Circuit de Spa-Francorchamps',
    countryCode: id === 'monaco' ? 'MC' : 'BE',
    locality: id === 'monaco' ? 'Monaco' : 'Spa-Francorchamps',
    lengthMeters,
    coordinateSystem: {
      unit: 'meter',
      xAxis: 'right',
      yAxis: 'up',
      angleUnit: 'radian',
      angleDirection: 'counterclockwise',
      angleOrigin: '+x',
    },
    bounds: {
      minX: -radius - 16,
      minY: -radius - 16,
      maxX: radius + 16,
      maxY: radius + 16,
    },
    centerline,
    racingLine,
    startFinish: {
      index: 0,
      distanceMeters: 0,
      position: start,
      forward: { x: 0, y: 1 },
      halfWidthMeters: 10,
    },
    gridSlots: Array.from({ length: 4 }, (_, index) => ({
      position: {
        x: radius + (index % 2 === 0 ? -2 : 2),
        y: -8 - Math.floor(index / 2) * 8,
      },
      angle: Math.PI / 2,
    })),
    checkpoints,
    pitLane: {
      entryDistanceMeters: lengthMeters * 0.9,
      exitDistanceMeters: lengthMeters * 0.05,
      speedLimitMetersPerSecond: 22.222222,
      path: [
        { x: radius - 30, y: -30 },
        { x: radius - 35, y: 0 },
        { x: radius - 30, y: 30 },
      ],
    },
    surfaceModel: {
      onTrack: 'asphalt',
      offTrack: 'grass',
      pitLane: 'pit-lane',
    },
    trackLimits: {
      runoffWidthMeters: 10,
      segments:
        id === 'monaco'
          ? [
              {
                index: 0,
                fromDistanceMeters: 0,
                toDistanceMeters: lengthMeters,
                left: 'barrier',
                right: 'barrier',
              },
            ]
          : [
              {
                index: 0,
                fromDistanceMeters: 0,
                toDistanceMeters: lengthMeters / 2,
                left: 'runoff',
                right: 'runoff',
              },
              {
                index: 1,
                fromDistanceMeters: lengthMeters / 2,
                toDistanceMeters: lengthMeters,
                left: 'barrier',
                right: 'runoff',
              },
            ],
    },
    chunks,
    sceneryLayout: {
      preset: id === 'monaco' ? 'coastal' : 'classic',
      landmarks: [],
      staticObjects: [],
    },
    source: {
      dataset: 'deterministic test fixture',
      license: 'test-only',
      url: 'https://never-lift.local/test-fixture',
      transformation: 'circular fixture preserving catalog length',
    },
  }
}

export const SHORT_TRACK = createTrackFixture('monaco')
export const LONG_TRACK = createTrackFixture('spa-francorchamps')
