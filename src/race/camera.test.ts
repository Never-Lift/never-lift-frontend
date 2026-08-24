import { describe, expect, it } from 'vitest'

import type { TrackChunk } from '@/lib/api'
import {
  CAMERA_GROUND_DEPTH_SCALE,
  createCameraTransform,
  createMinimapTransform,
  createSplitViewports,
  getVisibleTrackChunks,
  MAXIMUM_CAR_HEIGHT_RATIO,
  projectedSegmentPixelsPerMeter,
  projectedTrackWidth,
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
    const vehicleRatio =
      (5.6 * transform.pixelsPerMeter * transform.groundDepthScale) /
      viewport.height
    expect(vehicleRatio).toBeCloseTo(TARGET_CAR_HEIGHT_RATIO, 8)
    expect(vehicleRatio).toBeLessThanOrEqual(MAXIMUM_CAR_HEIGHT_RATIO)
  })

  it('compresses distance ahead while preserving lateral scale', () => {
    const transform = createCameraTransform(
      { position: { x: 0, y: 0 }, orientation: 0 },
      { x: 0, y: 0, width: 1_000, height: 600 },
      5.6,
    )
    const origin = worldToCamera({ x: 0, y: 0 }, transform)
    const ahead = worldToCamera({ x: 1, y: 0 }, transform)
    const right = worldToCamera({ x: 0, y: -1 }, transform)

    expect(Math.abs(ahead.y - origin.y)).toBeCloseTo(
      transform.pixelsPerMeter * CAMERA_GROUND_DEPTH_SCALE,
      8,
    )
    expect(Math.abs(right.x - origin.x)).toBeCloseTo(
      transform.pixelsPerMeter,
      8,
    )
    expect(Math.abs(ahead.y - origin.y)).toBeLessThan(
      Math.abs(right.x - origin.x),
    )
  })

  it('projects ribbon width from each segment normal', () => {
    const transform = createCameraTransform(
      { position: { x: 0, y: 0 }, orientation: 0 },
      { x: 0, y: 0, width: 1_000, height: 600 },
      5.6,
    )
    const forwardTrackWidth = projectedTrackWidth(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      12,
      transform,
    )
    const lateralTrackWidth = projectedTrackWidth(
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      12,
      transform,
    )

    expect(forwardTrackWidth).toBeCloseTo(
      12 * transform.pixelsPerMeter,
      8,
    )
    expect(lateralTrackWidth).toBeCloseTo(
      12 * transform.pixelsPerMeter * transform.groundDepthScale,
      8,
    )
    expect(lateralTrackWidth).toBeLessThan(forwardTrackWidth)
  })

  it('projects metric dash length along each segment direction', () => {
    const transform = createCameraTransform(
      { position: { x: 0, y: 0 }, orientation: 0 },
      { x: 0, y: 0, width: 1_000, height: 600 },
      5.6,
    )
    const forwardScale = projectedSegmentPixelsPerMeter(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      transform,
    )
    const lateralScale = projectedSegmentPixelsPerMeter(
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      transform,
    )

    expect(forwardScale).toBeCloseTo(
      transform.pixelsPerMeter * transform.groundDepthScale,
      8,
    )
    expect(lateralScale).toBeCloseTo(transform.pixelsPerMeter, 8)
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
    const stopped = camera.update({ x: 1, y: 2 }, { x: 0, y: 0 }, 1 / 60)
    const reversing = camera.update({ x: 0, y: 0 }, { x: -20, y: 0 }, 1 / 60)

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

  it('restarts the reverse delay when the opposite movement is cancelled', () => {
    const camera = new RaceCamera({ x: 0, y: 0 }, 0)
    for (let frame = 0; frame < 12; frame += 1) {
      camera.update({ x: -frame, y: 0 }, { x: -20, y: 0 }, 1 / 60)
    }
    camera.update({ x: 0, y: 0 }, { x: 20, y: 0 }, 1 / 60)
    for (let frame = 0; frame < 14; frame += 1) {
      camera.update({ x: -frame, y: 0 }, { x: -20, y: 0 }, 1 / 60)
    }

    expect(camera.getState().orientation).toBeCloseTo(0, 8)

    for (let frame = 0; frame < 14; frame += 1) {
      camera.update({ x: -frame, y: 0 }, { x: -20, y: 0 }, 1 / 60)
    }
    expect(
      Math.abs(signedAngleDelta(0, camera.getState().orientation)),
    ).toBeGreaterThan(0)
  })

  it('follows only movement and never snaps when the trajectory turns', () => {
    const camera = new RaceCamera({ x: 0, y: 0 }, 0)
    const movingForward = camera.update(
      { x: 1, y: 0 },
      { x: 20, y: 0 },
      1 / 60,
    )
    expect(movingForward.orientation).toBeCloseTo(0, 8)

    const turning = camera.update(
      { x: 1, y: 1 },
      { x: 0, y: 20 },
      1 / 60,
    )
    expect(Math.abs(signedAngleDelta(0, turning.orientation))).toBeGreaterThan(0)
    expect(Math.abs(signedAngleDelta(0, turning.orientation))).toBeLessThan(0.1)
  })

  it('caps a long visual frame so returning to the tab cannot snap the camera', () => {
    const camera = new RaceCamera({ x: 0, y: 0 }, 0)
    const state = camera.update(
      { x: 0, y: 20 },
      { x: 0, y: 20 },
      5,
    )

    expect(Math.abs(signedAngleDelta(0, state.orientation))).toBeLessThanOrEqual(
      0.3 + 1e-8,
    )
  })

  it('takes the short angular path across the -pi/pi boundary', () => {
    const initialOrientation = Math.PI - 0.04
    const targetOrientation = -Math.PI + 0.04
    const camera = new RaceCamera({ x: 0, y: 0 }, initialOrientation)
    const state = camera.update(
      { x: -1, y: -0.04 },
      {
        x: Math.cos(targetOrientation) * 20,
        y: Math.sin(targetOrientation) * 20,
      },
      1 / 60,
    )

    const step = signedAngleDelta(initialOrientation, state.orientation)
    expect(step).toBeGreaterThan(0)
    expect(step).toBeLessThan(0.1)
  })

  it('converges consistently at 30, 60 and 120 FPS', () => {
    const runAtFps = (fps: number) => {
      const camera = new RaceCamera({ x: 0, y: 0 }, 0)
      for (let frame = 0; frame < fps; frame += 1) {
        camera.update(
          { x: 0, y: frame / fps },
          { x: 0, y: 20 },
          1 / fps,
        )
      }
      return camera.getState().orientation
    }

    const at30 = runAtFps(30)
    expect(runAtFps(60)).toBeCloseTo(at30, 4)
    expect(runAtFps(120)).toBeCloseTo(at30, 4)
  })

  it('keeps the documented reverse delay at 5 FPS', () => {
    const camera = new RaceCamera({ x: 0, y: 0 }, 0)
    const firstFrame = camera.update(
      { x: -4, y: 0 },
      { x: -20, y: 0 },
      0.2,
    )
    const secondFrame = camera.update(
      { x: -8, y: 0 },
      { x: -20, y: 0 },
      0.2,
    )

    expect(firstFrame.orientation).toBeCloseTo(0, 8)
    expect(
      Math.abs(signedAngleDelta(0, secondFrame.orientation)),
    ).toBeGreaterThan(0)
  })

  it('matches fixed-frame convergence under an irregular visual cadence', () => {
    const runWithSteps = (steps: number[]) => {
      const camera = new RaceCamera({ x: 0, y: 0 }, 0)
      let elapsed = 0
      let index = 0
      while (elapsed < 1) {
        const step = Math.min(steps[index % steps.length], 1 - elapsed)
        camera.update(
          { x: 0, y: elapsed * 20 },
          { x: 0, y: 20 },
          step,
        )
        elapsed += step
        index += 1
      }
      return camera.getState().orientation
    }

    const fixed = runWithSteps([1 / 60])
    const irregular = runWithSteps([1 / 120, 1 / 42, 1 / 75, 1 / 55])
    expect(irregular).toBeCloseTo(fixed, 3)
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

  it('uses the available window ratio instead of an artificial canvas ratio', () => {
    const horizontal = createSplitViewports(824, 515, 2, 1.125)
    const boundary = createSplitViewports(824, 515, 2, 1.35)

    expect(horizontal[0].height).toBe(257.5)
    expect(horizontal[1].y).toBe(257.5)
    expect(boundary[0].width).toBe(412)
    expect(boundary[1].x).toBe(412)
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
