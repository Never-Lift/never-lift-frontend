import type { VehicleProfileId } from '@/race/types'
import { VEHICLE_SHADOW_SETTINGS } from '@/race/visual-settings'

export type VehicleVisualDetail = 'race' | 'preview'

export type DrawVehicleVisualOptions = {
  profileId: VehicleProfileId
  color: string
  x: number
  y: number
  angleRadians: number
  length: number
  width: number
  detail?: VehicleVisualDetail
  shadowAngleRadians?: number
  shadowDistanceToWidthRatio?: number
  shadowOpacity?: number
}

const FULL_CIRCLE = Math.PI * 2
const GLASS_COLOR = '#101b2a'
const TIRE_COLOR = '#070b11'
const LIGHT_COLOR = '#e6f7ff'
const REAR_LIGHT_COLOR = '#ff355d'

function parseHexColor(color: string) {
  const normalized = color.trim().replace(/^#/, '')
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((character) => character + character)
          .join('')
      : normalized

  if (!/^[0-9a-f]{6}$/i.test(expanded)) return null

  return {
    red: Number.parseInt(expanded.slice(0, 2), 16),
    green: Number.parseInt(expanded.slice(2, 4), 16),
    blue: Number.parseInt(expanded.slice(4, 6), 16),
  }
}

function mixHexColor(color: string, target: string, amount: number) {
  const sourceChannels = parseHexColor(color)
  const targetChannels = parseHexColor(target)
  if (!sourceChannels || !targetChannels) return color

  const channel = (source: number, destination: number) =>
    Math.round(source + (destination - source) * amount)
      .toString(16)
      .padStart(2, '0')

  return `#${channel(sourceChannels.red, targetChannels.red)}${channel(
    sourceChannels.green,
    targetChannels.green,
  )}${channel(sourceChannels.blue, targetChannels.blue)}`
}

function traceFormulaOutline(
  context: CanvasRenderingContext2D,
  length: number,
  width: number,
) {
  context.beginPath()
  context.moveTo(length * 0.5, -width * 0.47)
  context.lineTo(length * 0.5, width * 0.47)
  context.lineTo(length * 0.34, width * 0.47)
  context.lineTo(length * 0.3, width * 0.29)
  context.lineTo(length * 0.03, width * 0.3)
  context.lineTo(-length * 0.2, width * 0.5)
  context.lineTo(-length * 0.43, width * 0.5)
  context.lineTo(-length * 0.5, width * 0.38)
  context.lineTo(-length * 0.5, -width * 0.38)
  context.lineTo(-length * 0.43, -width * 0.5)
  context.lineTo(-length * 0.2, -width * 0.5)
  context.lineTo(length * 0.03, -width * 0.3)
  context.lineTo(length * 0.3, -width * 0.29)
  context.lineTo(length * 0.34, -width * 0.47)
  context.closePath()
}

function traceSupercarBody(
  context: CanvasRenderingContext2D,
  length: number,
  width: number,
) {
  context.beginPath()
  context.moveTo(length * 0.5, 0)
  context.bezierCurveTo(
    length * 0.46,
    -width * 0.34,
    length * 0.35,
    -width * 0.45,
    length * 0.17,
    -width * 0.48,
  )
  context.bezierCurveTo(
    -length * 0.08,
    -width * 0.51,
    -length * 0.38,
    -width * 0.44,
    -length * 0.48,
    -width * 0.3,
  )
  context.quadraticCurveTo(-length * 0.51, 0, -length * 0.48, width * 0.3)
  context.bezierCurveTo(
    -length * 0.38,
    width * 0.44,
    -length * 0.08,
    width * 0.51,
    length * 0.17,
    width * 0.48,
  )
  context.bezierCurveTo(
    length * 0.35,
    width * 0.45,
    length * 0.46,
    width * 0.34,
    length * 0.5,
    0,
  )
  context.closePath()
}

function traceDriftBody(
  context: CanvasRenderingContext2D,
  length: number,
  width: number,
) {
  context.beginPath()
  context.moveTo(length * 0.48, -width * 0.3)
  context.quadraticCurveTo(length * 0.49, 0, length * 0.48, width * 0.3)
  context.lineTo(length * 0.33, width * 0.43)
  context.lineTo(-length * 0.31, width * 0.46)
  context.quadraticCurveTo(
    -length * 0.49,
    width * 0.42,
    -length * 0.49,
    width * 0.25,
  )
  context.lineTo(-length * 0.49, -width * 0.25)
  context.quadraticCurveTo(
    -length * 0.49,
    -width * 0.42,
    -length * 0.31,
    -width * 0.46,
  )
  context.lineTo(length * 0.33, -width * 0.43)
  context.closePath()
}

function traceVehicleOutline(
  context: CanvasRenderingContext2D,
  profileId: VehicleProfileId,
  length: number,
  width: number,
) {
  if (profileId === 'formula') {
    traceFormulaOutline(context, length, width)
  } else if (profileId === 'supercar') {
    traceSupercarBody(context, length, width)
  } else {
    traceDriftBody(context, length, width)
  }
}

function paintFormula(
  context: CanvasRenderingContext2D,
  length: number,
  width: number,
  color: string,
  secondaryColor: string,
  detail: VehicleVisualDetail,
) {
  const tireLength = length * 0.18
  const rearTireWidth = width * 0.24
  const frontTireWidth = width * 0.2

  context.fillStyle = TIRE_COLOR
  for (const side of [-1, 1]) {
    context.fillRect(
      -length * 0.35,
      side * width * 0.38 - rearTireWidth / 2,
      tireLength,
      rearTireWidth,
    )
    context.fillRect(
      length * 0.2,
      side * width * 0.38 - frontTireWidth / 2,
      tireLength * 0.9,
      frontTireWidth,
    )
  }

  context.fillStyle = secondaryColor
  context.fillRect(-length * 0.48, -width * 0.47, length * 0.09, width * 0.94)
  context.fillRect(length * 0.4, -width * 0.48, length * 0.07, width * 0.96)

  context.fillStyle = color
  context.beginPath()
  context.moveTo(length * 0.48, 0)
  context.lineTo(length * 0.31, -width * 0.14)
  context.lineTo(length * 0.08, -width * 0.2)
  context.lineTo(-length * 0.08, -width * 0.34)
  context.lineTo(-length * 0.35, -width * 0.28)
  context.lineTo(-length * 0.42, 0)
  context.lineTo(-length * 0.35, width * 0.28)
  context.lineTo(-length * 0.08, width * 0.34)
  context.lineTo(length * 0.08, width * 0.2)
  context.lineTo(length * 0.31, width * 0.14)
  context.closePath()
  context.fill()

  context.fillStyle = secondaryColor
  context.beginPath()
  context.moveTo(length * 0.38, 0)
  context.lineTo(length * 0.04, -width * 0.07)
  context.lineTo(length * 0.04, width * 0.07)
  context.closePath()
  context.fill()

  context.fillStyle = GLASS_COLOR
  context.beginPath()
  context.ellipse(-length * 0.08, 0, length * 0.11, width * 0.2, 0, 0, FULL_CIRCLE)
  context.fill()

  context.strokeStyle = '#9aa8b8'
  context.lineWidth = Math.max(0.65, width * 0.035)
  context.beginPath()
  context.arc(-length * 0.05, 0, width * 0.16, -Math.PI * 0.62, Math.PI * 0.62)
  context.stroke()

  context.fillStyle = LIGHT_COLOR
  context.beginPath()
  context.arc(length * 0.43, 0, Math.max(0.55, width * 0.035), 0, FULL_CIRCLE)
  context.fill()

  if (detail === 'preview') {
    context.strokeStyle = 'rgba(240, 240, 250, 0.5)'
    context.lineWidth = Math.max(0.7, width * 0.025)
    context.beginPath()
    context.moveTo(-length * 0.34, 0)
    context.lineTo(length * 0.28, 0)
    context.stroke()

    context.fillStyle = '#202a37'
    for (const side of [-1, 1]) {
      context.fillRect(
        -length * 0.32,
        side * width * 0.38 - rearTireWidth * 0.08,
        tireLength * 0.72,
        rearTireWidth * 0.16,
      )
      context.fillRect(
        length * 0.22,
        side * width * 0.38 - frontTireWidth * 0.08,
        tireLength * 0.62,
        frontTireWidth * 0.16,
      )
    }
  }
}

function paintSupercar(
  context: CanvasRenderingContext2D,
  length: number,
  width: number,
  color: string,
  secondaryColor: string,
  detail: VehicleVisualDetail,
) {
  context.fillStyle = color
  traceSupercarBody(context, length, width)
  context.fill()

  context.fillStyle = secondaryColor
  context.beginPath()
  context.moveTo(length * 0.41, 0)
  context.lineTo(length * 0.22, -width * 0.36)
  context.lineTo(length * 0.13, -width * 0.3)
  context.lineTo(length * 0.13, width * 0.3)
  context.lineTo(length * 0.22, width * 0.36)
  context.closePath()
  context.fill()

  context.fillStyle = GLASS_COLOR
  context.beginPath()
  context.moveTo(length * 0.13, -width * 0.29)
  context.bezierCurveTo(
    length * 0.03,
    -width * 0.37,
    -length * 0.22,
    -width * 0.35,
    -length * 0.3,
    -width * 0.22,
  )
  context.lineTo(-length * 0.3, width * 0.22)
  context.bezierCurveTo(
    -length * 0.22,
    width * 0.35,
    length * 0.03,
    width * 0.37,
    length * 0.13,
    width * 0.29,
  )
  context.closePath()
  context.fill()

  context.strokeStyle = 'rgba(240, 240, 250, 0.35)'
  context.lineWidth = Math.max(0.65, width * 0.025)
  context.beginPath()
  context.moveTo(length * 0.1, -width * 0.27)
  context.lineTo(-length * 0.04, 0)
  context.lineTo(length * 0.1, width * 0.27)
  context.stroke()

  context.fillStyle = LIGHT_COLOR
  for (const side of [-1, 1]) {
    context.beginPath()
    context.ellipse(
      length * 0.37,
      side * width * 0.28,
      length * 0.055,
      width * 0.045,
      0,
      0,
      FULL_CIRCLE,
    )
    context.fill()
  }

  context.fillStyle = REAR_LIGHT_COLOR
  for (const side of [-1, 1]) {
    context.beginPath()
    context.ellipse(
      -length * 0.4,
      side * width * 0.25,
      length * 0.035,
      width * 0.04,
      0,
      0,
      FULL_CIRCLE,
    )
    context.fill()
  }

  if (detail === 'preview') {
    context.strokeStyle = 'rgba(7, 11, 17, 0.58)'
    context.lineWidth = Math.max(0.7, width * 0.03)
    for (const side of [-1, 1]) {
      context.beginPath()
      context.moveTo(-length * 0.35, side * width * 0.34)
      context.lineTo(-length * 0.18, side * width * 0.4)
      context.stroke()
    }

    context.strokeStyle = 'rgba(240, 240, 250, 0.24)'
    context.beginPath()
    context.moveTo(-length * 0.35, 0)
    context.lineTo(-length * 0.2, 0)
    context.stroke()
  }
}

function paintDrift(
  context: CanvasRenderingContext2D,
  length: number,
  width: number,
  color: string,
  secondaryColor: string,
  detail: VehicleVisualDetail,
) {
  const tireLength = length * 0.15
  const tireWidth = width * 0.17
  context.fillStyle = TIRE_COLOR
  for (const x of [-length * 0.3, length * 0.24]) {
    for (const side of [-1, 1]) {
      context.fillRect(
        x - tireLength / 2,
        side * width * 0.43 - tireWidth / 2,
        tireLength,
        tireWidth,
      )
    }
  }

  context.fillStyle = color
  traceDriftBody(context, length, width)
  context.fill()

  context.fillStyle = secondaryColor
  context.beginPath()
  context.moveTo(length * 0.43, -width * 0.29)
  context.lineTo(length * 0.13, -width * 0.34)
  context.lineTo(length * 0.13, width * 0.34)
  context.lineTo(length * 0.43, width * 0.29)
  context.closePath()
  context.fill()

  context.fillStyle = GLASS_COLOR
  context.beginPath()
  context.moveTo(length * 0.08, -width * 0.33)
  context.lineTo(-length * 0.22, -width * 0.32)
  context.lineTo(-length * 0.32, -width * 0.22)
  context.lineTo(-length * 0.32, width * 0.22)
  context.lineTo(-length * 0.22, width * 0.32)
  context.lineTo(length * 0.08, width * 0.33)
  context.closePath()
  context.fill()

  context.strokeStyle = 'rgba(240, 240, 250, 0.32)'
  context.lineWidth = Math.max(0.65, width * 0.025)
  context.beginPath()
  context.moveTo(-length * 0.08, -width * 0.31)
  context.lineTo(-length * 0.08, width * 0.31)
  context.stroke()

  context.fillStyle = mixHexColor(color, '#05070c', 0.5)
  context.fillRect(-length * 0.46, -width * 0.55, length * 0.08, width * 1.1)
  context.fillRect(-length * 0.39, -width * 0.39, length * 0.035, width * 0.78)

  context.fillStyle = LIGHT_COLOR
  for (const side of [-1, 1]) {
    context.beginPath()
    context.ellipse(
      length * 0.39,
      side * width * 0.24,
      length * 0.045,
      width * 0.05,
      0,
      0,
      FULL_CIRCLE,
    )
    context.fill()
  }

  context.fillStyle = REAR_LIGHT_COLOR
  context.fillRect(-length * 0.44, -width * 0.28, length * 0.025, width * 0.56)

  if (detail === 'preview') {
    context.strokeStyle = 'rgba(7, 11, 17, 0.62)'
    context.lineWidth = Math.max(0.75, width * 0.035)
    context.beginPath()
    context.moveTo(length * 0.31, -width * 0.22)
    context.lineTo(length * 0.18, -width * 0.14)
    context.moveTo(length * 0.31, width * 0.22)
    context.lineTo(length * 0.18, width * 0.14)
    context.stroke()

    context.strokeStyle = 'rgba(240, 240, 250, 0.24)'
    context.beginPath()
    context.moveTo(-length * 0.35, 0)
    context.lineTo(length * 0.31, 0)
    context.stroke()
  }
}

/**
 * Paints the optimized race model and the detailed preview from the same
 * normalized silhouette. Coordinates are screen-space pixels; the visual
 * renderer never changes vehicle physics or collision dimensions.
 */
export function drawVehicleVisual(
  context: CanvasRenderingContext2D,
  {
    profileId,
    color,
    x,
    y,
    angleRadians,
    length,
    width,
    detail = 'race',
    shadowAngleRadians = VEHICLE_SHADOW_SETTINGS.day.worldAngleRadians,
    shadowDistanceToWidthRatio =
      VEHICLE_SHADOW_SETTINGS.day.distanceToWidthRatio,
    shadowOpacity = VEHICLE_SHADOW_SETTINGS.day.opacity,
  }: DrawVehicleVisualOptions,
) {
  if (length <= 0 || width <= 0) return

  const secondaryColor = mixHexColor(color, '#f0f0fa', 0.24)
  const sideColor = mixHexColor(color, '#05070c', 0.48)
  const screenSideOffset = Math.max(1, width * 0.07)
  const shadowDistance = Math.max(1.5, width * shadowDistanceToWidthRatio)

  context.save()
  context.translate(
    x + Math.cos(shadowAngleRadians) * shadowDistance,
    y + Math.sin(shadowAngleRadians) * shadowDistance,
  )
  context.rotate(angleRadians)
  context.fillStyle = `rgba(0, 0, 0, ${shadowOpacity})`
  context.shadowColor = `rgba(0, 0, 0, ${shadowOpacity * 0.8})`
  context.shadowBlur = Math.max(2, width * 0.14)
  traceVehicleOutline(context, profileId, length, width)
  context.fill()
  context.restore()

  context.save()
  context.translate(x, y + Math.max(1, width * 0.04))
  context.rotate(angleRadians)
  context.fillStyle = 'rgba(0, 0, 0, 0.28)'
  traceVehicleOutline(context, profileId, length, width)
  context.fill()
  context.restore()

  context.save()
  context.translate(x, y + screenSideOffset)
  context.rotate(angleRadians)
  context.fillStyle = sideColor
  traceVehicleOutline(context, profileId, length, width)
  context.fill()
  context.restore()

  context.save()
  context.translate(x, y)
  context.rotate(angleRadians)

  if (profileId === 'formula') {
    paintFormula(context, length, width, color, secondaryColor, detail)
  } else if (profileId === 'supercar') {
    paintSupercar(context, length, width, color, secondaryColor, detail)
  } else {
    paintDrift(context, length, width, color, secondaryColor, detail)
  }

  context.strokeStyle = 'rgba(240, 240, 250, 0.2)'
  context.lineWidth = Math.max(0.65, width * 0.022)
  traceVehicleOutline(context, profileId, length, width)
  context.stroke()
  context.restore()
}
