import {
  CAMERA_GROUND_DEPTH_SCALE,
  CAMERA_HEIGHT_SCALE,
} from '@/race/camera'
import {
  drawVehicleShadowVisual,
  drawVehicleVisual,
  type DrawVehicleShadowOptions,
  type DrawVehicleVisualOptions,
} from '@/race/vehicle-visuals'
import { VEHICLE_SHADOW_SETTINGS } from '@/race/visual-settings'

type CachedVehicleOptions = Omit<DrawVehicleVisualOptions, 'x' | 'y'>

type VehicleSprite = {
  canvas: HTMLCanvasElement
  logicalSize: number
  pixelCount: number
  lastUsed: number
}

export type VehicleSpriteCacheStats = {
  entries: number
  hits: number
  misses: number
  evictions: number
  pixels: number
  canvasAllocations: number
  canvasReuses: number
}

const FULL_CIRCLE = Math.PI * 2
const ANGLE_BUCKETS = 180
const ANGLE_STEP = FULL_CIRCLE / ANGLE_BUCKETS
const SUPERSAMPLE = 2
const MAX_CACHED_PIXELS = 16_000_000

function angleBucket(angleRadians: number) {
  const bucket = Math.round(angleRadians / ANGLE_STEP)
  return ((bucket % ANGLE_BUCKETS) + ANGLE_BUCKETS) % ANGLE_BUCKETS
}

function bucketAngle(bucket: number) {
  const angle = bucket * ANGLE_STEP
  return angle > Math.PI ? angle - FULL_CIRCLE : angle
}

function finiteKey(value: number, precision = 3) {
  return Number.isFinite(value) ? value.toFixed(precision) : 'invalid'
}

/**
 * High-density races reuse supersampled sprites for non-focused cars. The
 * focused car remains on the continuous vector painter, while two-degree
 * buckets keep the maximum remote-car pose displacement around one pixel at
 * the approved race scale.
 */
export class VehicleSpriteCache {
  private readonly sprites = new Map<string, VehicleSprite>()
  private readonly canvasPool: HTMLCanvasElement[] = []
  private readonly maximumCachedPixels: number
  private pixelCount = 0
  private hits = 0
  private misses = 0
  private evictions = 0
  private canvasAllocations = 0
  private canvasReuses = 0
  private accessSequence = 0

  constructor(maximumCachedPixels = MAX_CACHED_PIXELS) {
    this.maximumCachedPixels = maximumCachedPixels
  }

  draw(
    output: CanvasRenderingContext2D,
    options: DrawVehicleVisualOptions,
  ) {
    if (options.length <= 0 || options.width <= 0) return false
    if (typeof document === 'undefined') return false

    const yawBucket = angleBucket(options.relativeYawRadians)
    const cachedOptions: CachedVehicleOptions = {
      color: options.color,
      relativeYawRadians: bucketAngle(yawBucket),
      length: options.length,
      width: options.width,
      detail: options.detail,
      damage: options.damage,
      groundDepthScale: options.groundDepthScale,
      heightScale: options.heightScale,
      drawShadow: false,
    }
    const key = [
      cachedOptions.color,
      cachedOptions.damage ?? 'none',
      cachedOptions.detail ?? 'race',
      yawBucket,
      finiteKey(cachedOptions.length),
      finiteKey(cachedOptions.width),
      finiteKey(
        cachedOptions.groundDepthScale ?? CAMERA_GROUND_DEPTH_SCALE,
      ),
      finiteKey(cachedOptions.heightScale ?? CAMERA_HEIGHT_SCALE),
    ].join(':')

    const defaultShadow = VEHICLE_SHADOW_SETTINGS.day
    const shadowOpacity = options.shadowOpacity ?? defaultShadow.opacity
    const shadowKey = [
      'shadow',
      yawBucket,
      finiteKey(options.length),
      finiteKey(options.width),
      finiteKey(options.groundDepthScale ?? CAMERA_GROUND_DEPTH_SCALE),
      finiteKey(options.heightScale ?? CAMERA_HEIGHT_SCALE),
      finiteKey(shadowOpacity),
    ].join(':')
    const shadow = shadowOpacity > 0
      ? this.getOrCreate(shadowKey, () => this.createShadowSprite({
          ...options,
          relativeYawRadians: bucketAngle(yawBucket),
          shadowAngleRadians: 0,
          shadowDistanceToWidthRatio: 0,
          shadowDistancePixels: 0,
        }))
      : undefined
    const sprite = this.getOrCreate(key, () => this.createSprite(cachedOptions))
    if (!sprite) return false

    if (shadow) {
      const shadowDistance = Math.max(
        1.5,
        options.width *
          (options.shadowDistanceToWidthRatio ??
            defaultShadow.distanceToWidthRatio),
      )
      const shadowAngle =
        options.shadowAngleRadians ?? defaultShadow.worldAngleRadians
      output.drawImage(
        shadow.canvas,
        options.x + Math.cos(shadowAngle) * shadowDistance - shadow.logicalSize / 2,
        options.y + Math.sin(shadowAngle) * shadowDistance - shadow.logicalSize / 2,
        shadow.logicalSize,
        shadow.logicalSize,
      )
    }
    output.drawImage(
      sprite.canvas,
      options.x - sprite.logicalSize / 2,
      options.y - sprite.logicalSize / 2,
      sprite.logicalSize,
      sprite.logicalSize,
    )
    return true
  }

  getStats(): VehicleSpriteCacheStats {
    return {
      entries: this.sprites.size,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      pixels: this.pixelCount,
      canvasAllocations: this.canvasAllocations,
      canvasReuses: this.canvasReuses,
    }
  }

  private createSprite(options: CachedVehicleOptions): VehicleSprite | undefined {
    const logicalSize = Math.ceil(
      Math.max(options.length, options.width) * 2 + 16,
    )
    const canvas = this.acquireCanvas(logicalSize * SUPERSAMPLE)
    const context = this.prepareContext(canvas)
    if (!context) return undefined
    drawVehicleVisual(context, {
      ...options,
      x: logicalSize / 2,
      y: logicalSize / 2,
    })
    return {
      canvas,
      logicalSize,
      pixelCount: canvas.width * canvas.height,
      lastUsed: ++this.accessSequence,
    }
  }

  private createShadowSprite(
    options: DrawVehicleShadowOptions,
  ): VehicleSprite | undefined {
    const logicalSize = Math.ceil(
      Math.max(options.length, options.width) * 2 + 16,
    )
    const canvas = this.acquireCanvas(logicalSize * SUPERSAMPLE)
    const context = this.prepareContext(canvas)
    if (!context) return undefined
    drawVehicleShadowVisual(context, {
      ...options,
      x: logicalSize / 2,
      y: logicalSize / 2,
    })
    return {
      canvas,
      logicalSize,
      pixelCount: canvas.width * canvas.height,
      lastUsed: ++this.accessSequence,
    }
  }

  private getOrCreate(
    key: string,
    create: () => VehicleSprite | undefined,
  ) {
    const cached = this.sprites.get(key)
    if (cached) {
      this.hits += 1
      cached.lastUsed = ++this.accessSequence
      return cached
    }
    this.misses += 1
    const sprite = create()
    if (!sprite) return undefined
    this.makeRoom(sprite.pixelCount)
    this.sprites.set(key, sprite)
    this.pixelCount += sprite.pixelCount
    return sprite
  }

  private makeRoom(incomingPixels: number) {
    while (
      this.sprites.size > 0 &&
      this.pixelCount + incomingPixels > this.maximumCachedPixels
    ) {
      let oldestKey: string | undefined
      let oldestUse = Number.POSITIVE_INFINITY
      for (const [key, sprite] of this.sprites) {
        if (sprite.lastUsed < oldestUse) {
          oldestKey = key
          oldestUse = sprite.lastUsed
        }
      }
      if (!oldestKey) break
      const oldest = this.sprites.get(oldestKey)
      this.sprites.delete(oldestKey)
      if (oldest) {
        this.pixelCount -= oldest.pixelCount
        this.recycleCanvas(oldest.canvas)
      }
      this.evictions += 1
    }
  }

  private acquireCanvas(backingSize: number) {
    const pooledIndex = this.canvasPool.findIndex(
      (canvas) =>
        canvas.width === backingSize && canvas.height === backingSize,
    )
    if (pooledIndex >= 0) {
      this.canvasReuses += 1
      return this.canvasPool.splice(pooledIndex, 1)[0]
    }
    const canvas = document.createElement('canvas')
    canvas.width = backingSize
    canvas.height = backingSize
    this.canvasAllocations += 1
    return canvas
  }

  private prepareContext(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d')
    if (!context) return undefined
    // Recycled canvases retain their bitmap and transform. Reset both without
    // resizing the backing store, which would allocate another large surface.
    context.setTransform?.(1, 0, 0, 1, 0, 0)
    context.clearRect?.(0, 0, canvas.width, canvas.height)
    if (context.setTransform) {
      context.setTransform(SUPERSAMPLE, 0, 0, SUPERSAMPLE, 0, 0)
    } else {
      context.scale(SUPERSAMPLE, SUPERSAMPLE)
    }
    return context
  }

  private recycleCanvas(canvas: HTMLCanvasElement) {
    // One spare is enough for the miss/evict cycle and keeps actual memory
    // bounded close to the advertised cache budget.
    if (this.canvasPool.length === 0) this.canvasPool.push(canvas)
  }
}
