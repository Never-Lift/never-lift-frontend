import type { TrackBounds, TrackChunk } from '@/lib/api'
import { clamp, normalizeAngle, signedAngleDelta } from '@/race/math'
import type { Vector2 } from '@/race/types'

export type Viewport = {
  x: number
  y: number
  width: number
  height: number
}

export type CameraState = {
  position: Vector2
  orientation: number
}

export type CameraTransform = CameraState & {
  pixelsPerMeter: number
  groundDepthScale: number
  viewport: Viewport
  anchor: Vector2
}

export type MinimapTransform = {
  bounds: TrackBounds
  viewport: Viewport
  padding: number
  scale: number
  offset: Vector2
}

const CAMERA_SMOOTHING_SECONDS = 0.25
const MINIMUM_DIRECTION_SPEED = 1.5
const MAXIMUM_CAMERA_TURN_RADIANS_PER_SECOND = 3
const REVERSE_ORIENTATION_DELAY_SECONDS = 0.4
const MAXIMUM_CONTINUOUS_FRAME_SECONDS = 0.25
const TAB_RESUME_VISUAL_DELTA_SECONDS = 0.1
export const MAXIMUM_CAR_HEIGHT_RATIO = 0.06
// A 42-degree tilt away from a true overhead view keeps the roof readable,
// while making the car sides and the ground foreshortening unmistakable.
export const CAMERA_TILT_FROM_OVERHEAD_RADIANS = (42 * Math.PI) / 180
export const CAMERA_GROUND_DEPTH_SCALE = Math.cos(
  CAMERA_TILT_FROM_OVERHEAD_RADIANS,
)
export const CAMERA_ELEVATION_RADIANS =
  Math.PI / 2 - CAMERA_TILT_FROM_OVERHEAD_RADIANS
export const CAMERA_HEIGHT_SCALE = Math.sin(
  CAMERA_TILT_FROM_OVERHEAD_RADIANS,
)
// The focused car sits low enough to expose a little over twice as much track
// ahead as behind, without hiding cars approaching from the rear.
export const CAMERA_VERTICAL_ANCHOR_RATIO = 0.68

export class RaceCamera {
  private state: CameraState
  private reverseMovementSeconds = 0

  constructor(position: Vector2, orientation: number) {
    this.state = {
      position: { ...position },
      orientation: normalizeAngle(orientation),
    }
  }

  update(
    position: Vector2,
    velocity: Vector2,
    deltaSeconds: number,
  ): CameraState {
    this.state.position = { ...position }
    const speed = Math.hypot(velocity.x, velocity.y)
    if (speed < MINIMUM_DIRECTION_SPEED || deltaSeconds <= 0) {
      this.reverseMovementSeconds = 0
      return this.getState()
    }
    const visualDeltaSeconds =
      deltaSeconds > MAXIMUM_CONTINUOUS_FRAME_SECONDS
        ? TAB_RESUME_VISUAL_DELTA_SECONDS
        : deltaSeconds

    const movementOrientation = Math.atan2(velocity.y, velocity.x)
    const difference = signedAngleDelta(
      this.state.orientation,
      movementOrientation,
    )
    const movementCameraDot = Math.cos(difference)
    if (movementCameraDot < -0.2) {
      this.reverseMovementSeconds += visualDeltaSeconds
      if (this.reverseMovementSeconds < REVERSE_ORIENTATION_DELAY_SECONDS) {
        return this.getState()
      }
    } else {
      this.reverseMovementSeconds = 0
    }

    const smoothing =
      1 - Math.exp(-visualDeltaSeconds / CAMERA_SMOOTHING_SECONDS)
    const maximumStep =
      MAXIMUM_CAMERA_TURN_RADIANS_PER_SECOND * visualDeltaSeconds
    this.state.orientation = normalizeAngle(
      this.state.orientation +
        clamp(difference * smoothing, -maximumStep, maximumStep),
    )
    return this.getState()
  }

  getState(): CameraState {
    return {
      position: { ...this.state.position },
      orientation: this.state.orientation,
    }
  }
}

export function createCameraTransform(
  camera: CameraState,
  viewport: Viewport,
  focusedVehicleLengthMeters: number,
): CameraTransform {
  return {
    ...camera,
    viewport,
    groundDepthScale: CAMERA_GROUND_DEPTH_SCALE,
    pixelsPerMeter:
      (viewport.height * MAXIMUM_CAR_HEIGHT_RATIO) /
      focusedVehicleLengthMeters,
    anchor: {
      x: viewport.x + viewport.width * 0.5,
      y: viewport.y + viewport.height * CAMERA_VERTICAL_ANCHOR_RATIO,
    },
  }
}

export function createSplitViewports(
  width: number,
  height: number,
  playerCount: 1 | 2,
  layoutAspectRatio = width / height,
): Viewport[] {
  if (playerCount === 1) return [{ x: 0, y: 0, width, height }]
  if (layoutAspectRatio >= 1.35) {
    const halfWidth = width / 2
    return [
      { x: 0, y: 0, width: halfWidth, height },
      { x: halfWidth, y: 0, width: width - halfWidth, height },
    ]
  }
  const halfHeight = height / 2
  return [
    { x: 0, y: 0, width, height: halfHeight },
    { x: 0, y: halfHeight, width, height: height - halfHeight },
  ]
}

export function worldToCamera(
  point: Vector2,
  transform: CameraTransform,
): Vector2 {
  const relativeX = point.x - transform.position.x
  const relativeY = point.y - transform.position.y
  const projected = worldVectorToCamera(
    { x: relativeX, y: relativeY },
    transform,
  )
  return {
    x: transform.anchor.x + projected.x,
    y: transform.anchor.y + projected.y,
  }
}

export function worldVectorToCamera(
  vector: Vector2,
  transform: CameraTransform,
): Vector2 {
  const forward = {
    x: Math.cos(transform.orientation),
    y: Math.sin(transform.orientation),
  }
  const right = { x: forward.y, y: -forward.x }
  return {
    x: (vector.x * right.x + vector.y * right.y) * transform.pixelsPerMeter,
    y:
      -(vector.x * forward.x + vector.y * forward.y) *
      transform.pixelsPerMeter *
      transform.groundDepthScale,
  }
}

export function projectedTrackWidth(
  from: Vector2,
  to: Vector2,
  widthMeters: number,
  transform: CameraTransform,
) {
  const worldTangent = { x: to.x - from.x, y: to.y - from.y }
  const tangentLength = Math.hypot(worldTangent.x, worldTangent.y)
  if (tangentLength <= Number.EPSILON || widthMeters <= 0) return 0

  const unitTangent = {
    x: worldTangent.x / tangentLength,
    y: worldTangent.y / tangentLength,
  }
  const unitNormal = { x: -unitTangent.y, y: unitTangent.x }
  const screenTangent = worldVectorToCamera(unitTangent, transform)
  const screenNormal = worldVectorToCamera(unitNormal, transform)
  const screenTangentLength = Math.hypot(screenTangent.x, screenTangent.y)
  if (screenTangentLength <= Number.EPSILON) return 0

  const perpendicular = {
    x: -screenTangent.y / screenTangentLength,
    y: screenTangent.x / screenTangentLength,
  }
  return (
    Math.abs(
      screenNormal.x * perpendicular.x +
        screenNormal.y * perpendicular.y,
    ) * widthMeters
  )
}

export function projectedSegmentPixelsPerMeter(
  from: Vector2,
  to: Vector2,
  transform: CameraTransform,
) {
  const tangent = { x: to.x - from.x, y: to.y - from.y }
  const length = Math.hypot(tangent.x, tangent.y)
  if (length <= Number.EPSILON) return 0
  const projected = worldVectorToCamera(
    { x: tangent.x / length, y: tangent.y / length },
    transform,
  )
  return Math.hypot(projected.x, projected.y)
}

export function createMinimapTransform(
  bounds: TrackBounds,
  viewport: Viewport,
  padding = 10,
): MinimapTransform {
  const worldWidth = Math.max(1, bounds.maxX - bounds.minX)
  const worldHeight = Math.max(1, bounds.maxY - bounds.minY)
  const availableWidth = Math.max(1, viewport.width - padding * 2)
  const availableHeight = Math.max(1, viewport.height - padding * 2)
  const scale = Math.min(availableWidth / worldWidth, availableHeight / worldHeight)
  const drawnWidth = worldWidth * scale
  const drawnHeight = worldHeight * scale
  return {
    bounds,
    viewport,
    padding,
    scale,
    offset: {
      x: viewport.x + (viewport.width - drawnWidth) / 2,
      y: viewport.y + (viewport.height - drawnHeight) / 2,
    },
  }
}

export function worldToMinimap(
  point: Vector2,
  transform: MinimapTransform,
): Vector2 {
  return {
    x: transform.offset.x + (point.x - transform.bounds.minX) * transform.scale,
    y: transform.offset.y + (transform.bounds.maxY - point.y) * transform.scale,
  }
}

function projectedBounds(
  bounds: TrackBounds,
  transform: CameraTransform,
) {
  const corners = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.minX, y: bounds.maxY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
  ].map((corner) => worldToCamera(corner, transform))
  return {
    minX: Math.min(...corners.map((corner) => corner.x)),
    minY: Math.min(...corners.map((corner) => corner.y)),
    maxX: Math.max(...corners.map((corner) => corner.x)),
    maxY: Math.max(...corners.map((corner) => corner.y)),
  }
}

export function isChunkVisible(
  chunk: TrackChunk,
  transform: CameraTransform,
  marginPixels = 24,
) {
  const projected = projectedBounds(chunk.bounds, transform)
  const viewport = transform.viewport
  return !(
    projected.maxX < viewport.x - marginPixels ||
    projected.minX > viewport.x + viewport.width + marginPixels ||
    projected.maxY < viewport.y - marginPixels ||
    projected.minY > viewport.y + viewport.height + marginPixels
  )
}

export function getVisibleTrackChunks(
  chunks: TrackChunk[],
  transform: CameraTransform,
  marginPixels = 24,
) {
  return chunks.filter((chunk) => isChunkVisible(chunk, transform, marginPixels))
}
