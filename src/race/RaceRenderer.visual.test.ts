import { describe, expect, it, vi } from 'vitest'

import type { TrackDefinition } from '@/lib/api'
import type { CameraTransform } from '@/race/camera'
import { RaceEngine } from '@/race/RaceEngine'
import { RaceRenderer } from '@/race/RaceRenderer'
import type { InterpolatedVehicleState } from '@/race/types'
import {
  AMBIENT_PARTICLE_BUDGET,
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
    handlingMode: 'normal',
    racers: [
      {
        id: 'player-1',
        name: 'Player 1',
        kind: 'human',
        profileId: 'formula',
        color: '#31c7ff',
      },
      {
        id: 'player-2',
        name: 'Player 2',
        kind: 'human',
        profileId: 'drift',
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
