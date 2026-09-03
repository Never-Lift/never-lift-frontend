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
      elevationLayer: 0,
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
  const trackLimitSegments: TrackDefinition['trackLimits']['segments'] =
    id === 'monaco'
      ? [
          {
            index: 0,
            fromDistanceMeters: 0,
            toDistanceMeters: lengthMeters,
            left: { zones: [], barrier: 'concrete-wall' },
            right: { zones: [], barrier: 'concrete-wall' },
          },
        ]
      : [
          {
            index: 0,
            fromDistanceMeters: 0,
            toDistanceMeters: lengthMeters / 2,
            left: {
              zones: [{ surface: 'grass', widthMeters: 10 }],
              barrier: 'tyre-barrier',
            },
            right: {
              zones: [{ surface: 'grass', widthMeters: 10 }],
              barrier: 'tyre-barrier',
            },
          },
          {
            index: 1,
            fromDistanceMeters: lengthMeters / 2,
            toDistanceMeters: lengthMeters,
            left: { zones: [], barrier: 'concrete-wall' },
            right: {
              zones: [{ surface: 'grass', widthMeters: 10 }],
              barrier: 'tyre-barrier',
            },
          },
        ]
  const barrierGeometry: TrackDefinition['barrierGeometry'] = {
    segments: trackLimitSegments.flatMap((limitSegment) =>
      (['left', 'right'] as const).map((side, sideIndex) => {
        const environment = limitSegment[side]
        const environmentWidth = environment.zones.reduce(
          (sum, zone) => sum + zone.widthMeters,
          0,
        )
        const barrierRadius =
          radius +
          (side === 'left' ? -1 : 1) * (8 + environmentWidth)
        const path = centerline
          .filter(
            (point) =>
              point.distanceMeters >= limitSegment.fromDistanceMeters &&
              point.distanceMeters <= limitSegment.toDistanceMeters,
          )
          .map((point) => {
            const radialScale = barrierRadius / radius
            return {
              x: point.x * radialScale,
              y: point.y * radialScale,
              distanceMeters: point.distanceMeters,
              elevationLayer: point.elevationLayer,
            }
          })
        return {
          index: limitSegment.index * 2 + sideIndex,
          trackLimitSegmentIndex: limitSegment.index,
          side,
          fromDistanceMeters: limitSegment.fromDistanceMeters,
          toDistanceMeters: limitSegment.toDistanceMeters,
          material: environment.barrier,
          thicknessMeters:
            environment.barrier === 'concrete-wall' ? 0.4 : 0.8,
          collisionLayer: 'track-barrier' as const,
          chunkIndexes: chunks
            .filter(
              (chunk) =>
                chunk.toDistanceMeters >= limitSegment.fromDistanceMeters &&
                chunk.fromDistanceMeters <= limitSegment.toDistanceMeters,
            )
            .map((chunk) => chunk.index),
          path,
        }
      }),
    ),
  }
  const start = pointOnCircle(radius, 0)
  return {
    schemaVersion: '2.0.0',
    catalogVersion: '2026.12',
    physicsContractVersion: '2.0.1',
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
      garageBarrier: {
        side: 'left',
        material: 'concrete-wall',
        thicknessMeters: 0.35,
        path: [
          { x: radius - 42, y: -20 },
          { x: radius - 47, y: 0 },
          { x: radius - 42, y: 20 },
        ],
      },
      visualStyle: {
        architecture: 'permanent-modern',
        primaryColor: '#d9dcdf',
        secondaryColor: '#505a64',
        accentColor: '#8f2933',
        roofColor: '#eceeef',
        garageCount: 22,
        buildingHeightMeters: 4.8,
        laneWidthMeters: 11,
        garageStartRatio: 0.2,
        garageEndRatio: 0.8,
        pitBoxLengthMeters: 7,
        pitBoxDepthMeters: 2.4,
        pitBoxCenterOffsetMeters: 2.8,
        garageDepthMeters: 9,
        garageCenterOffsetMeters: 12,
        pitWallHeightMeters: 1,
        canopyDepthMeters: 1.5,
      },
    },
    surfaceModel: {
      onTrack: 'asphalt',
      pitLane: 'pit-lane',
    },
    curbs: [
      {
        index: 0,
        fromDistanceMeters: 100,
        toDistanceMeters: 140,
        side: 'left',
        widthMeters: 1,
        stripeLengthMeters: 2.5,
        palette: 'red-white',
        outerColor: '#2f8548',
        outerWidthMeters: 0.35,
      },
      {
        index: 1,
        fromDistanceMeters: 200,
        toDistanceMeters: 250,
        side: 'right',
        widthMeters: 1,
        stripeLengthMeters: 2.5,
        palette: id === 'monaco' ? 'red-white' : 'red-yellow',
        outerColor: id === 'monaco' ? '#2f8548' : '#1f4f37',
        outerWidthMeters: 0.35,
      },
    ],
    trackLimits: {
      segments: trackLimitSegments,
    },
    barrierOpenings: [],
    barrierGeometry,
    chunks,
    sceneryLayout: {
      preset: id === 'monaco' ? 'coastal' : 'classic',
      landmarks: [],
      staticObjects: [],
      escapeRoads: [],
      brakingMarkers: [],
    },
    source: {
      dataset: 'deterministic test fixture',
      license: 'test-only',
      url: 'https://never-lift.local/test-fixture',
      transformation: 'circular fixture preserving catalog length',
      environmentReferences: [
        {
          label: 'deterministic fixture',
          url: 'https://never-lift.local/test-fixture/environment',
          checkedAt: '2026-08-20',
        },
        {
          label: 'deterministic fixture cross-check',
          url: 'https://never-lift.local/test-fixture/environment-cross-check',
          checkedAt: '2026-08-20',
        },
      ],
    },
  }
}

export const SHORT_TRACK = createTrackFixture('monaco')
export const LONG_TRACK = createTrackFixture('spa-francorchamps')
