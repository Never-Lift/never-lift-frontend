import { beforeEach, describe, expect, it, vi } from 'vitest'

const { drawVehicleShadowVisualMock, drawVehicleVisualMock } = vi.hoisted(() => ({
  drawVehicleShadowVisualMock: vi.fn(),
  drawVehicleVisualMock: vi.fn(),
}))

vi.mock('@/race/vehicle-visuals', () => ({
  drawVehicleShadowVisual: drawVehicleShadowVisualMock,
  drawVehicleVisual: drawVehicleVisualMock,
}))

import { VehicleSpriteCache } from '@/race/VehicleSpriteCache'

describe('dense-grid vehicle sprite cache', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    drawVehicleShadowVisualMock.mockClear()
    drawVehicleVisualMock.mockClear()
  })

  it('reuses a supersampled sprite inside the same two-degree pose bucket', () => {
    const spriteContext = { scale: vi.fn() } as unknown as CanvasRenderingContext2D
    const spriteCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => spriteContext),
    } as unknown as HTMLCanvasElement
    const createElement = vi
      .spyOn(document, 'createElement')
      .mockReturnValue(spriteCanvas)
    const drawImage = vi.fn()
    const output = { drawImage } as unknown as CanvasRenderingContext2D
    const cache = new VehicleSpriteCache()
    const options = {
      color: '#365f82',
      x: 100,
      y: 80,
      relativeYawRadians: 0.001,
      length: 60,
      width: 22,
      detail: 'race' as const,
      damage: 'none' as const,
      groundDepthScale: 0.74,
      shadowAngleRadians: 0.002,
      shadowDistanceToWidthRatio: 0.18,
      shadowOpacity: 0.22,
    }

    expect(cache.draw(output, options)).toBe(true)
    expect(cache.draw(output, {
      ...options,
      x: 120,
      relativeYawRadians: 0.01,
    })).toBe(true)

    expect(createElement).toHaveBeenCalledTimes(2)
    expect(drawVehicleVisualMock).toHaveBeenCalledTimes(1)
    expect(drawVehicleShadowVisualMock).toHaveBeenCalledTimes(1)
    expect(drawImage).toHaveBeenCalledTimes(4)
    expect(spriteCanvas.width).toBeGreaterThan(120)
    expect(spriteCanvas.height).toBe(spriteCanvas.width)
    expect(cache.getStats()).toMatchObject({
      entries: 2,
      hits: 2,
      misses: 2,
      evictions: 0,
    })
  })

  it('keeps damage and color in separate cached appearances', () => {
    const spriteContext = { scale: vi.fn() } as unknown as CanvasRenderingContext2D
    vi.spyOn(document, 'createElement').mockImplementation(
      () => ({
        width: 0,
        height: 0,
        getContext: () => spriteContext,
      }) as unknown as HTMLCanvasElement,
    )
    const output = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
    const cache = new VehicleSpriteCache()
    const base = {
      color: '#365f82',
      x: 100,
      y: 80,
      relativeYawRadians: 0,
      length: 60,
      width: 22,
      detail: 'race' as const,
      damage: 'none' as const,
    }

    cache.draw(output, base)
    cache.draw(output, { ...base, color: '#a84448' })
    cache.draw(output, { ...base, damage: 'total-loss' })

    expect(drawVehicleVisualMock).toHaveBeenCalledTimes(3)
    expect(drawVehicleShadowVisualMock).toHaveBeenCalledTimes(1)
    expect(cache.getStats().entries).toBe(4)
  })

  it('recycles evicted canvases and updates LRU age without reinserting hits', () => {
    const canvases: Array<HTMLCanvasElement> = []
    const createElement = vi.spyOn(document, 'createElement').mockImplementation(
      () => {
        const context = {
          clearRect: vi.fn(),
          scale: vi.fn(),
          setTransform: vi.fn(),
        } as unknown as CanvasRenderingContext2D
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => context,
        } as unknown as HTMLCanvasElement
        canvases.push(canvas)
        return canvas
      },
    )
    const output = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
    const cache = new VehicleSpriteCache(150_000)
    const base = {
      color: '#365f82',
      x: 100,
      y: 80,
      relativeYawRadians: 0,
      length: 60,
      width: 22,
      detail: 'race' as const,
      damage: 'none' as const,
    }

    cache.draw(output, base)
    cache.draw(output, base)
    cache.draw(output, { ...base, relativeYawRadians: Math.PI / 4 })
    cache.draw(output, { ...base, relativeYawRadians: Math.PI / 2 })

    const stats = cache.getStats()
    expect(createElement).toHaveBeenCalledTimes(3)
    expect(stats.canvasAllocations).toBe(3)
    expect(stats.canvasReuses).toBeGreaterThanOrEqual(3)
    expect(stats.evictions).toBeGreaterThanOrEqual(3)
    expect(stats.hits).toBeGreaterThanOrEqual(2)
  })
})
