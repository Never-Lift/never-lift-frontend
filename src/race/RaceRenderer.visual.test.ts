import { describe, expect, it, vi } from 'vitest'

import type { TrackDefinition } from '@/lib/api'
import type { CameraTransform } from '@/race/camera'
import { RaceEngine } from '@/race/RaceEngine'
import { RaceRenderer } from '@/race/RaceRenderer'
import type { InterpolatedVehicleState } from '@/race/types'
import {
  AMBIENT_PARTICLE_BUDGET,
  HEADLIGHT_VISUAL_SETTINGS,
  VEHICLE_SHADOW_SETTINGS,
  type GraphicsQuality,
  type TimeOfDayPreset,
} from '@/race/visual-settings'
import { SHORT_TRACK } from '@/test/track-fixtures'

type ClipRect = { x: number; y: number; width: number; height: number }

function createRecordingContext() {
  let currentClip: ClipRect | null = null
  let latestRect: ClipRect | null = null
  const clipStack: Array<ClipRect | null> = []
  const linearGradientClips: Array<ClipRect | null> = []
  const fillRects: ClipRect[] = []
  let pathClipCount = 0
  let pathMoveCount = 0
  const noOperation = vi.fn()
  const context = new Proxy(
    {},
    {
      get: (_target, property) => {
        if (property === 'save') {
          return () => clipStack.push(currentClip ? { ...currentClip } : null)
        }
        if (property === 'restore') {
          return () => {
            currentClip = clipStack.pop() ?? null
          }
        }
        if (property === 'rect') {
          return (x: number, y: number, width: number, height: number) => {
            latestRect = { x, y, width, height }
          }
        }
        if (property === 'beginPath') {
          return () => {
            latestRect = null
          }
        }
        if (property === 'clip') {
          return () => {
            if (latestRect) currentClip = { ...latestRect }
            else pathClipCount += 1
          }
        }
        if (property === 'moveTo') {
          return () => {
            pathMoveCount += 1
          }
        }
        if (property === 'createLinearGradient') {
          return () => {
            linearGradientClips.push(currentClip ? { ...currentClip } : null)
            return { addColorStop: noOperation }
          }
        }
        if (property === 'fillRect') {
          return (x: number, y: number, width: number, height: number) => {
            fillRects.push({ x, y, width, height })
          }
        }
        if (property === 'createRadialGradient') {
          return () => ({ addColorStop: noOperation })
        }
        return noOperation
      },
      set: () => true,
    },
  ) as CanvasRenderingContext2D
  return {
    context,
    fillRects,
    linearGradientClips,
    getPathClipCount: () => pathClipCount,
    getPathMoveCount: () => pathMoveCount,
  }
}

function createCanvas(
  context: CanvasRenderingContext2D,
  width = 960,
  height = 640,
) {
  const canvas = document.createElement('canvas')
  Object.defineProperty(canvas, 'getContext', { value: () => context })
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    value: () => ({
      x: 0,
      y: 0,
      width,
      height,
      top: 0,
      right: width,
      bottom: height,
      left: 0,
      toJSON: () => ({}),
    }),
  })
  return canvas
}

function createEngine(track: TrackDefinition, mode: 'solo' | 'local' = 'local') {
  return new RaceEngine({
    track,
    mode,
    racers: [
      {
        id: 'player-1',
        name: 'Player 1',
        kind: 'human',
        color: '#31c7ff',
      },
      {
        id: 'player-2',
        name: 'Player 2',
        kind: 'human',
        color: '#ff2e88',
      },
    ],
  })
}

function raceState(engine: RaceEngine) {
  return ['player-1', 'player-2'].map((racerId) => {
    const vehicle = engine.getVehicleState(racerId)
    return {
      position: vehicle?.position,
      velocity: vehicle?.velocity,
      surface: vehicle?.surface,
      damage: vehicle?.damage,
      nextCheckpointIndex: vehicle?.nextCheckpointIndex,
      currentLap: vehicle?.currentLap,
      lapProgressMeters: vehicle?.lapProgressMeters,
      totalProgressMeters: vehicle?.totalProgressMeters,
      result: engine.getResults().find((entry) => entry.racerId === racerId),
    }
  })
}

function renderPreset(preset: TimeOfDayPreset) {
  const engine = createEngine(SHORT_TRACK)
  const before = raceState(engine)
  const { context } = createRecordingContext()
  const renderer = new RaceRenderer(createCanvas(context), SHORT_TRACK, {
    timeOfDay: preset,
    quality: 'medium',
  })
  renderer.render(engine, 1 / 60)
  renderer.render(engine, 1 / 30)
  return { before, after: raceState(engine) }
}

describe('RaceRenderer Module 2c visuals', () => {
  it('uses distinct directional shadows for each lighting preset', () => {
    expect(VEHICLE_SHADOW_SETTINGS.day.worldAngleRadians).not.toBe(
      VEHICLE_SHADOW_SETTINGS.sunset.worldAngleRadians,
    )
    expect(VEHICLE_SHADOW_SETTINGS.sunset.distanceToWidthRatio).toBeGreaterThan(
      VEHICLE_SHADOW_SETTINGS.day.distanceToWidthRatio,
    )
    expect(VEHICLE_SHADOW_SETTINGS.night.opacity).toBeLessThan(
      VEHICLE_SHADOW_SETTINGS.day.opacity,
    )
  })

  it('keeps the jump-start warning clear of bottom telemetry', () => {
    const { context, fillRects } = createRecordingContext()
    const renderer = new RaceRenderer(createCanvas(context), SHORT_TRACK, {
      timeOfDay: 'day',
      quality: 'medium',
    })
    const rendererInternals = renderer as unknown as {
      drawStartProcedure: (
        viewport: { x: number; y: number; width: number; height: number },
        racerId: string,
        overlayState: {
          startLights: { stage: 'hidden'; redLights: number }
          penalties: Record<
            string,
            { jumpStarted: boolean; throttleLockTicksRemaining: number }
          >
        },
      ) => void
    }

    rendererInternals.drawStartProcedure(
      { x: 0, y: 0, width: 720, height: 820 },
      'player-1',
      {
        startLights: { stage: 'hidden', redLights: 0 },
        penalties: {
          'player-1': { jumpStarted: true, throttleLockTicksRemaining: 120 },
        },
      },
    )

    const warning = fillRects.find((rectangle) => rectangle.height === 36)
    expect(warning).toBeDefined()
    expect((warning?.y ?? 0) + (warning?.height ?? 0)).toBeLessThan(500)
  })

  it('keeps the night beam narrow and softly layered', () => {
    expect(HEADLIGHT_VISUAL_SETTINGS.widthToLengthRatio).toBeLessThanOrEqual(0.22)
    expect(HEADLIGHT_VISUAL_SETTINGS.colorStops).toEqual([
      { offset: 0, color: 'rgba(255, 244, 196, 0.18)' },
      { offset: 0.55, color: 'rgba(255, 236, 174, 0.07)' },
      { offset: 1, color: 'rgba(255, 229, 158, 0)' },
    ])
  })

  it('uses the visible beam width for elevated-layer occlusion', () => {
    const { context } = createRecordingContext()
    const renderer = new RaceRenderer(createCanvas(context), SHORT_TRACK, {
      timeOfDay: 'night',
      quality: 'medium',
    })
    const rendererInternals = renderer as unknown as {
      clipPolygonToHeadlightCone: (
        polygon: Array<{ forward: number; lateral: number }>,
        maximumDistanceMeters: number,
      ) => Array<{ forward: number; lateral: number }>
    }

    const insideVisibleBeam = rendererInternals.clipPolygonToHeadlightCone(
      [
        { forward: 10, lateral: 1.7 },
        { forward: 11, lateral: 1.7 },
        { forward: 11, lateral: 1.9 },
        { forward: 10, lateral: 1.9 },
      ],
      58,
    )
    const outsideVisibleBeam = rendererInternals.clipPolygonToHeadlightCone(
      [
        { forward: 10, lateral: 2.8 },
        { forward: 11, lateral: 2.8 },
        { forward: 11, lateral: 3 },
        { forward: 10, lateral: 3 },
      ],
      58,
    )

    expect(insideVisibleBeam.length).toBeGreaterThan(0)
    expect(outsideVisibleBeam).toEqual([])
  })

  it.each(['day', 'sunset', 'night'] as const)(
    'keeps %s strictly visual across physics and race state',
    (preset) => {
      const { before, after } = renderPreset(preset)
      expect(after).toEqual(before)
    },
  )

  it.each([
    [1_600, 900, [{ x: 0, y: 0, width: 800, height: 900 }, { x: 800, y: 0, width: 800, height: 900 }]],
    [900, 800, [{ x: 0, y: 0, width: 900, height: 400 }, { x: 0, y: 400, width: 900, height: 400 }]],
  ] as const)(
    'clips every night headlight to its split viewport at %ix%i',
    (width, height, expectedViewports) => {
      const { context, linearGradientClips, getPathClipCount } =
        createRecordingContext()
      const renderer = new RaceRenderer(
        createCanvas(context, width, height),
        SHORT_TRACK,
        { timeOfDay: 'night', quality: 'medium' },
      )
      renderer.render(createEngine(SHORT_TRACK), 1 / 60)

      expect(linearGradientClips).toHaveLength(4)
      expect(linearGradientClips.slice(0, 2)).toEqual([
        expectedViewports[0],
        expectedViewports[0],
      ])
      expect(linearGradientClips.slice(2)).toEqual([
        expectedViewports[1],
        expectedViewports[1],
      ])
      expect(getPathClipCount()).toBe(4)
    },
  )

  it.each(['low', 'medium', 'high'] as GraphicsQuality[])(
    'keeps visible ambient particles within the %s quality budget',
    (quality) => {
      const { context } = createRecordingContext()
      const renderer = new RaceRenderer(createCanvas(context), SHORT_TRACK, {
        timeOfDay: 'day',
        quality,
      })
      renderer.render(createEngine(SHORT_TRACK), 1 / 60)

      const counts = renderer.getRenderStats().ambientParticlesByViewport
      expect(counts).toHaveLength(2)
      expect(counts.some((count) => count > 0)).toBe(true)
      for (const count of counts) {
        expect(count).toBeLessThanOrEqual(AMBIENT_PARTICLE_BUDGET[quality])
      }
    },
  )

  it('stops a lower-layer headlight before the full elevated footprint', () => {
    const elevatedFootprintTrack: TrackDefinition = {
      ...SHORT_TRACK,
      trackLimits: {
        segments: [
          {
            index: 0,
            fromDistanceMeters: 0,
            toDistanceMeters: SHORT_TRACK.lengthMeters,
            left: {
              zones: [
                { surface: 'asphalt', widthMeters: 2 },
                { surface: 'gravel', widthMeters: 5 },
                { surface: 'grass', widthMeters: 3 },
              ],
              barrier: 'guardrail',
              fence: 'debris-fence',
            },
            right: {
              zones: [
                { surface: 'asphalt', widthMeters: 2 },
                { surface: 'gravel', widthMeters: 5 },
                { surface: 'grass', widthMeters: 3 },
              ],
              barrier: 'guardrail',
              fence: 'debris-fence',
            },
          },
        ],
      },
    }
    const { context } = createRecordingContext()
    const renderer = new RaceRenderer(
      createCanvas(context),
      elevatedFootprintTrack,
      { timeOfDay: 'night', quality: 'medium' },
    )
    const vehicle: InterpolatedVehicleState = {
      ...createEngine(elevatedFootprintTrack).getInterpolatedVehicles()[0],
      renderPosition: { x: 0, y: -20 },
      renderAngle: Math.PI / 2,
      trackLayer: 0,
    }
    const upperCenterline: TrackDefinition['centerline'] = [
      {
        x: -30,
        y: 0,
        distanceMeters: 100,
        halfWidthMeters: 8,
        elevationLayer: 1,
      },
      {
        x: 30,
        y: 0,
        distanceMeters: 160,
        halfWidthMeters: 8,
        elevationLayer: 1,
      },
    ]
    const rendererInternals = renderer as unknown as {
      getHeadlightOcclusionDistanceMeters: (
        currentVehicle: InterpolatedVehicleState,
        sections: Array<{
          elevationLayer: number
          points: TrackDefinition['centerline']
        }>,
        maximumDistanceMeters: number,
      ) => number
    }

    const lowerBeamDistance =
      rendererInternals.getHeadlightOcclusionDistanceMeters(
        vehicle,
        [{ elevationLayer: 1, points: upperCenterline }],
        58,
      )
    const upperBeamDistance =
      rendererInternals.getHeadlightOcclusionDistanceMeters(
        { ...vehicle, trackLayer: 1 },
        [{ elevationLayer: 1, points: upperCenterline }],
        58,
      )
    const beamDistanceUnderOverpass =
      rendererInternals.getHeadlightOcclusionDistanceMeters(
        { ...vehicle, renderPosition: { x: 0, y: 4 } },
        [{ elevationLayer: 1, points: upperCenterline }],
        58,
      )

    expect(lowerBeamDistance).toBeGreaterThan(0)
    expect(lowerBeamDistance).toBeLessThan(1)
    expect(beamDistanceUnderOverpass).toBe(0)
    expect(upperBeamDistance).toBe(58)
  })

  it('unifies adjacent visible sections in the headlight mask', () => {
    const { context, getPathClipCount, getPathMoveCount } =
      createRecordingContext()
    const renderer = new RaceRenderer(createCanvas(context), SHORT_TRACK, {
      timeOfDay: 'night',
      quality: 'medium',
    })
    const vehicle: InterpolatedVehicleState = {
      ...createEngine(SHORT_TRACK).getInterpolatedVehicles()[0],
      trackLayer: 0,
    }
    const firstSection = SHORT_TRACK.centerline.slice(0, 2)
    const secondSection = SHORT_TRACK.centerline.slice(1, 3)
    const transform: CameraTransform = {
      position: { x: 0, y: 0 },
      orientation: 0,
      pixelsPerMeter: 4,
      viewport: { x: 0, y: 0, width: 960, height: 640 },
      anchor: { x: 480, y: 320 },
    }
    const rendererInternals = renderer as unknown as {
      clipHeadlightToVisibleTrack: (
        currentVehicle: InterpolatedVehicleState,
        currentTransform: CameraTransform,
        sections: Array<{
          elevationLayer: number
          points: TrackDefinition['centerline']
        }>,
      ) => boolean
    }

    const clipped = rendererInternals.clipHeadlightToVisibleTrack(
      vehicle,
      transform,
      [
        { elevationLayer: 0, points: firstSection },
        { elevationLayer: 0, points: secondSection },
      ],
    )

    expect(clipped).toBe(true)
    expect(getPathMoveCount()).toBe(2)
    expect(getPathClipCount()).toBe(1)
  })
})
