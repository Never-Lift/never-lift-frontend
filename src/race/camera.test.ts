import { describe, expect, it } from 'vitest'

import type { TrackChunk } from '@/lib/api'
import {
  createCameraTransform,
  createMinimapTransform,
  createSplitViewports,
  getVisibleTrackChunks,
  MAXIMUM_CAR_HEIGHT_RATIO,
  RaceCamera,
  TARGET_CAR_HEIGHT_RATIO,
  worldToCamera,
  worldToMinimap,
} from '@/race/camera'
import { signedAngleDelta } from '@/race/math'

describe('camera and minimap transforms', () => {
  it('maps the focused car to 60% height and keeps its visual size below 6%', () => {
    const viewport = { x: 0, y: 0, width: 1_000, height: 600 }
    const transform = createCameraTransform(
      { position: { x: 10, y: 20 }, orientation: 0 },
      viewport,
      5.6,
    )

    expect(worldToCamera({ x: 10, y: 20 }, transform)).toEqual({
      x: 500,
      y: 360,
    })
    expect(worldToCamera({ x: 20, y: 20 }, transform).y).toBeLessThan(360)
    expect(worldToCamera({ x: 10, y: 10 }, transform).x).toBeGreaterThan(500)
    const vehicleRatio = (5.6 * transform.pixelsPerMeter) / viewport.height
    expect(vehicleRatio).toBeCloseTo(TARGET_CAR_HEIGHT_RATIO, 8)
    expect(vehicleRatio).toBeLessThanOrEqual(MAXIMUM_CAR_HEIGHT_RATIO)
  })

  it('normalizes world coordinates into a fixed, non-rotating minimap', () => {
    const transform = createMinimapTransform(
      { minX: -100, minY: -50, maxX: 300, maxY: 150 },
      { x: 20, y: 30, width: 220, height: 120 },
      10,
    )
    const topLeft = worldToMinimap({ x: -100, y: 150 }, transform)
    const bottomRight = worldToMinimap({ x: 300, y: -50 }, transform)

    expect(topLeft.x).toBeGreaterThanOrEqual(30)
    expect(topLeft.y).toBeGreaterThanOrEqual(40)
    expect(bottomRight.x).toBeLessThanOrEqual(230)
    expect(bottomRight.y).toBeLessThanOrEqual(140)
    expect(topLeft.x).toBeLessThan(bottomRight.x)
    expect(topLeft.y).toBeLessThan(bottomRight.y)
  })
})

describe('dynamic camera stability', () => {
  it('keeps its last orientation while stopped and at the start of reversing', () => {
    const camera = new RaceCamera({ x: 0, y: 0 }, 0.4)
    const stopped = camera.update({ x: 1, y: 2 }, { x: 0, y: 0 }, 1.7, 1 / 60)
    const reversing = camera.update({ x: 0, y: 0 }, { x: -20, y: 0 }, 0, 1 / 60)

    expect(stopped.orientation).toBeCloseTo(0.4, 8)
    expect(reversing.orientation).toBeCloseTo(0.4, 8)
  })

  it('turns smoothly toward movement after reverse is sustained', () => {
    const camera = new RaceCamera({ x: 0, y: 0 }, 0)
    let previousOrientation = 0
    let largestStep = 0
    for (let frame = 0; frame < 90; frame += 1) {
      const state = camera.update(
        { x: -frame / 3, y: 0 },
        { x: -20, y: 0 },
        0,
        1 / 60,
      )
      largestStep = Math.max(
        largestStep,
        Math.abs(signedAngleDelta(previousOrientation, state.orientation)),
      )
      previousOrientation = state.orientation
    }

    expect(Math.abs(signedAngleDelta(0, previousOrientation))).toBeGreaterThan(1)
    expect(largestStep).toBeLessThanOrEqual(3 / 60 + 1e-8)
  })

  it('follows movement instead of a spinning body and never snaps 180 degrees', () => {
    const camera = new RaceCamera({ x: 0, y: 0 }, 0)
    const bodySpinning = camera.update(
      { x: 1, y: 0 },
      { x: 20, y: 0 },
      Math.PI,
      1 / 60,
    )
    expect(bodySpinning.orientation).toBeCloseTo(0, 8)

    const turning = camera.update(
      { x: 1, y: 1 },
      { x: 0, y: 20 },
      Math.PI / 2,
      1 / 60,
    )
    expect(Math.abs(signedAngleDelta(0, turning.orientation))).toBeGreaterThan(0)
    expect(Math.abs(signedAngleDelta(0, turning.orientation))).toBeLessThan(0.1)
  })

  it('converges consistently at 30, 60 and 120 FPS', () => {
    const runAtFps = (fps: number) => {
      const camera = new RaceCamera({ x: 0, y: 0 }, 0)
      for (let frame = 0; frame < fps; frame += 1) {
        camera.update(
          { x: 0, y: frame / fps },
          { x: 0, y: 20 },
          Math.PI / 2,
          1 / fps,
        )
      }
      return camera.getState().orientation
    }

    const at30 = runAtFps(30)
    expect(runAtFps(60)).toBeCloseTo(at30, 4)
    expect(runAtFps(120)).toBeCloseTo(at30, 4)
  })
})

describe('split-screen and chunk culling', () => {
  it('uses a vertical split on wide screens and a horizontal split below 1.35', () => {
    expect(createSplitViewports(1_600, 900, 2)).toEqual([
      { x: 0, y: 0, width: 800, height: 900 },
      { x: 800, y: 0, width: 800, height: 900 },
    ])
    expect(createSplitViewports(900, 800, 2)).toEqual([
      { x: 0, y: 0, width: 900, height: 400 },
      { x: 0, y: 400, width: 900, height: 400 },
    ])
  })

  it('keeps a chunk whose thick track edge is visible and rejects distant chunks', () => {
    const transform = createCameraTransform(
      { position: { x: 0, y: 0 }, orientation: Math.PI / 2 },
      { x: 0, y: 0, width: 800, height: 600 },
      5.6,
    )
    const chunks: TrackChunk[] = [
      {
        index: 0,
        fromDistanceMeters: 0,
        toDistanceMeters: 250,
        bounds: { minX: -20, minY: -20, maxX: 20, maxY: 20 },
      },
      {
        index: 1,
        fromDistanceMeters: 250,
        toDistanceMeters: 500,
        bounds: { minX: 70, minY: -10, maxX: 80, maxY: 10 },
      },
      {
        index: 2,
        fromDistanceMeters: 500,
        toDistanceMeters: 750,
        bounds: { minX: 2_000, minY: 2_000, maxX: 2_100, maxY: 2_100 },
      },
    ]

    expect(getVisibleTrackChunks(chunks, transform, 80).map((chunk) => chunk.index)).toEqual([
      0,
      1,
    ])
  })
})
