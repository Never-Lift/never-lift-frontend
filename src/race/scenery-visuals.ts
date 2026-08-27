import type { TrackDefinition, TrackSceneryObject } from '@/lib/api'

export type SceneryVisualCategory =
  | 'vegetation'
  | 'water'
  | 'terrain'
  | 'grandstand'
  | 'building'
  | 'tower'
  | 'round-landmark'
  | 'boat'
  | 'bridge'
  | 'floodlight'
  | 'gantry'
  | 'escape-obstacle'
  | 'generic'

export type SceneryRenderLayer = 'ground' | 'overhead'

export function getSceneryRenderLayer(kind: string): SceneryRenderLayer {
  return kind.toLowerCase() === 'start-gantry' ? 'overhead' : 'ground'
}

export function getSceneryRotationOffset(kind: string) {
  return kind.toLowerCase() === 'start-gantry' ? Math.PI / 2 : 0
}

export function classifySceneryKind(kind: string): SceneryVisualCategory {
  const normalized = kind.toLowerCase()

  if (normalized.includes('start-gantry')) return 'gantry'
  if (normalized.includes('escape-bollard')) return 'escape-obstacle'
  if (normalized.includes('floodlight')) return 'floodlight'
  if (normalized.includes('waterfront-tower')) return 'building'
  if (
    normalized.includes('ferris') ||
    normalized.includes('sphere') ||
    normalized.includes('wheel')
  ) {
    return 'round-landmark'
  }
  if (
    normalized.includes('yacht') ||
    normalized.includes('boat') ||
    normalized.includes('marina')
  ) {
    return 'boat'
  }
  if (
    normalized.includes('tree') ||
    normalized.includes('forest') ||
    normalized.includes('palm') ||
    normalized.includes('wooded')
  ) {
    return 'vegetation'
  }
  if (
    normalized.includes('lake') ||
    normalized.includes('river') ||
    normalized.includes('waterfront') ||
    normalized.includes('sea')
  ) {
    return 'water'
  }
  if (
    normalized.includes('hill') ||
    normalized.includes('dune') ||
    normalized.includes('alpine') ||
    normalized.includes('desert-expanse') ||
    normalized.includes('open-infield')
  ) {
    return 'terrain'
  }
  if (
    normalized.includes('grandstand') ||
    (normalized.includes('stadium') && !normalized.includes('building')) ||
    normalized.includes('amphitheater')
  ) {
    return 'grandstand'
  }
  if (
    normalized.includes('bridge') ||
    normalized.includes('overpass') ||
    normalized.includes('wall') ||
    normalized.includes('banking')
  ) {
    return 'bridge'
  }
  if (normalized.includes('tower')) return 'tower'
  if (
    normalized.includes('building') ||
    normalized.includes('hotel') ||
    normalized.includes('casino') ||
    normalized.includes('chalet') ||
    normalized.includes('skyline') ||
    normalized.includes('hangar') ||
    normalized.includes('exhibition') ||
    normalized.includes('city-block') ||
    normalized.includes('pits') ||
    normalized.includes('pit-')
  ) {
    return 'building'
  }
  if (normalized.includes('urban-park')) return 'vegetation'
  if (normalized.includes('sculpture')) return 'tower'
  return 'generic'
}

type SceneryVisualOptions = {
  context: CanvasRenderingContext2D
  object: TrackSceneryObject
  pixelsPerMeter: number
  preset: TrackDefinition['sceneryLayout']['preset']
}

const PRESET_ACCENTS: Record<
  TrackDefinition['sceneryLayout']['preset'],
  string
> = {
  park: '#668d61',
  street: '#75859a',
  desert: '#a98d5f',
  coastal: '#5d91a0',
  classic: '#78866a',
  'night-city': '#607fa4',
}

function drawRoundedPanel(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string,
) {
  context.fillStyle = color
  context.beginPath()
  context.roundRect(-width / 2, -height / 2, width, height, height * 0.18)
  context.fill()
}

/** Draws one static object after the caller positions and rotates the context. */
export function drawSceneryVisual({
  context,
  object,
  pixelsPerMeter,
  preset,
}: SceneryVisualOptions) {
  const category = classifySceneryKind(object.kind)
  const size = Math.max(4, object.scale * pixelsPerMeter)
  const accent = PRESET_ACCENTS[preset]
  const palette = object.visualStyle ?? {
    primaryColor: '#596575',
    secondaryColor: '#343e49',
    accentColor: accent,
    roofColor: '#c9cfd6',
  }
  const normalizedKind = object.kind.toLowerCase()

  context.save()
  context.lineCap = 'round'
  context.lineJoin = 'round'

  switch (category) {
    case 'vegetation': {
      context.fillStyle = '#203f2b'
      context.fillRect(-size * 0.08, 0, size * 0.16, size * 0.42)
      context.fillStyle = accent
      for (const [x, y, radius] of [
        [-0.23, -0.12, 0.3],
        [0.2, -0.1, 0.28],
        [0, -0.32, 0.34],
      ] as const) {
        context.beginPath()
        context.arc(size * x, size * y, size * radius, 0, Math.PI * 2)
        context.fill()
      }
      break
    }
    case 'water': {
      context.fillStyle = 'rgba(49, 140, 179, 0.44)'
      context.beginPath()
      context.ellipse(0, 0, size * 0.7, size * 0.32, 0, 0, Math.PI * 2)
      context.fill()
      context.strokeStyle = 'rgba(155, 222, 235, 0.35)'
      context.lineWidth = Math.max(1, size * 0.04)
      context.beginPath()
      context.moveTo(-size * 0.46, 0)
      context.lineTo(size * 0.46, 0)
      context.stroke()
      break
    }
    case 'terrain': {
      context.fillStyle = accent
      context.beginPath()
      context.ellipse(0, size * 0.08, size * 0.7, size * 0.35, 0, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = 'rgba(240, 240, 250, 0.08)'
      context.beginPath()
      context.ellipse(-size * 0.12, -size * 0.04, size * 0.35, size * 0.12, -0.18, 0, Math.PI * 2)
      context.fill()
      break
    }
    case 'grandstand': {
      const width = size * 1.65
      const depth = size * 0.82
      context.fillStyle = 'rgba(3, 7, 12, 0.3)'
      context.beginPath()
      context.moveTo(-width * 0.48, depth * 0.56)
      context.lineTo(width * 0.56, depth * 0.56)
      context.lineTo(width * 0.47, -depth * 0.26)
      context.lineTo(-width * 0.43, -depth * 0.26)
      context.closePath()
      context.fill()

      // Front fascia gives the stand height in the 2.5D projection.
      context.fillStyle = palette.primaryColor
      context.beginPath()
      context.moveTo(-width / 2, depth * 0.42)
      context.lineTo(width / 2, depth * 0.42)
      context.lineTo(width * 0.48, depth * 0.58)
      context.lineTo(-width * 0.48, depth * 0.58)
      context.closePath()
      context.fill()
      context.fillStyle = palette.secondaryColor
      context.beginPath()
      context.moveTo(-width / 2, depth * 0.42)
      context.lineTo(width / 2, depth * 0.42)
      context.lineTo(width * 0.43, -depth * 0.4)
      context.lineTo(-width * 0.43, -depth * 0.4)
      context.closePath()
      context.fill()

      const rows = 6
      for (let row = 0; row < rows; row += 1) {
        const progress = row / rows
        const y = depth * 0.32 - progress * depth * 0.65
        const inset = width * (0.04 + progress * 0.035)
        context.strokeStyle =
          row % 2 === 0 ? palette.primaryColor : palette.accentColor
        context.lineWidth = Math.max(1, size * 0.055)
        context.beginPath()
        context.moveTo(-width / 2 + inset, y)
        context.lineTo(width / 2 - inset, y)
        context.stroke()
        const seatCount = 13
        for (let seat = 0; seat < seatCount; seat += 1) {
          const ratio = seat / (seatCount - 1)
          const x = -width / 2 + inset + (width - inset * 2) * ratio
          context.fillStyle =
            (row + seat) % 3 === 0
              ? palette.accentColor
              : 'rgba(224, 229, 232, 0.58)'
          context.beginPath()
          context.arc(x, y - size * 0.018, Math.max(0.7, size * 0.014), 0, Math.PI * 2)
          context.fill()
        }
      }
      context.strokeStyle = 'rgba(13, 18, 25, 0.58)'
      context.lineWidth = Math.max(1, size * 0.025)
      for (const offset of [-0.34, -0.17, 0, 0.17, 0.34]) {
        context.beginPath()
        context.moveTo(width * offset, depth * 0.35)
        context.lineTo(width * offset * 0.83, -depth * 0.34)
        context.stroke()
      }
      if (
        normalizedKind.includes('covered') ||
        normalizedKind.includes('canopy') ||
        normalizedKind.includes('main-grandstand')
      ) {
        context.fillStyle = palette.roofColor
        context.beginPath()
        context.moveTo(-width * 0.52, -depth * 0.34)
        context.lineTo(width * 0.52, -depth * 0.34)
        context.lineTo(width * 0.43, -depth * 0.56)
        context.lineTo(-width * 0.43, -depth * 0.56)
        context.closePath()
        context.fill()
        context.strokeStyle = palette.secondaryColor
        context.lineWidth = Math.max(1, size * 0.025)
        context.beginPath()
        context.moveTo(-width * 0.5, -depth * 0.4)
        context.lineTo(width * 0.5, -depth * 0.4)
        context.stroke()
        context.strokeStyle = palette.secondaryColor
        context.lineWidth = Math.max(1, size * 0.04)
        for (const x of [-0.42, 0.42]) {
          context.beginPath()
          context.moveTo(width * x, -depth * 0.34)
          context.lineTo(width * x, depth * 0.36)
          context.stroke()
        }
        context.fillStyle = 'rgba(241, 245, 246, 0.72)'
        for (let light = 0; light < 9; light += 1) {
          const ratio = light / 8
          context.beginPath()
          context.arc(
            -width * 0.42 + width * 0.84 * ratio,
            -depth * 0.39,
            Math.max(0.7, size * 0.012),
            0,
            Math.PI * 2,
          )
          context.fill()
        }
      }
      break
    }
    case 'building': {
      const width = size * (normalizedKind.includes('stadium') ? 1.65 : 1.35)
      const depth = size * (normalizedKind.includes('wing') ? 0.65 : 0.82)
      context.fillStyle = 'rgba(3, 7, 12, 0.32)'
      context.fillRect(-width * 0.48, -depth * 0.18, width * 1.04, depth * 0.78)
      if (normalizedKind.includes('stadium')) {
        context.fillStyle = palette.secondaryColor
        context.beginPath()
        context.ellipse(0, 0, width / 2, depth / 2, 0, 0, Math.PI * 2)
        context.fill()
        context.fillStyle = palette.roofColor
        context.beginPath()
        context.ellipse(0, -depth * 0.05, width * 0.39, depth * 0.31, 0, 0, Math.PI * 2)
        context.fill()
        context.fillStyle = palette.accentColor
        context.beginPath()
        context.ellipse(0, 0, width * 0.25, depth * 0.16, 0, 0, Math.PI * 2)
        context.fill()
        context.strokeStyle = palette.accentColor
        context.lineWidth = Math.max(1, size * 0.035)
        for (const ratio of [0.38, 0.49, 0.6]) {
          context.beginPath()
          context.ellipse(0, 0, width * ratio, depth * ratio, 0, 0, Math.PI * 2)
          context.stroke()
        }
        break
      }
      context.fillStyle = palette.secondaryColor
      context.fillRect(-width / 2, -depth * 0.28, width, depth * 0.66)
      context.fillStyle = palette.primaryColor
      context.fillRect(-width / 2, -depth * 0.37, width, depth * 0.25)
      context.fillStyle = palette.accentColor
      context.fillRect(-width / 2, depth * 0.12, width, depth * 0.08)
      context.fillStyle = 'rgba(94, 154, 177, 0.58)'
      const windowCount = normalizedKind.includes('wing') ? 7 : 5
      const floorCount = normalizedKind.includes('exhibition') ? 3 : 2
      for (let floor = 0; floor < floorCount; floor += 1) {
        for (let index = 0; index < windowCount; index += 1) {
          const x = -width * 0.4 + (width * 0.8 * index) / (windowCount - 1)
          const y = -depth * 0.21 + floor * depth * 0.17
          context.fillRect(
            x - width * 0.035,
            y,
            width * 0.07,
            depth * 0.11,
          )
        }
      }
      context.fillStyle = palette.roofColor
      if (normalizedKind.includes('wing')) {
        context.beginPath()
        context.moveTo(-width * 0.54, -depth * 0.36)
        for (let index = 0; index <= 6; index += 1) {
          const x = -width * 0.54 + (width * 1.08 * index) / 6
          const y = -depth * (index % 2 === 0 ? 0.52 : 0.38)
          context.lineTo(x, y)
        }
        context.lineTo(width * 0.54, -depth * 0.28)
        context.closePath()
        context.fill()
      } else {
        context.fillRect(-width * 0.53, -depth * 0.47, width * 1.06, depth * 0.14)
      }
      context.fillStyle = palette.secondaryColor
      for (const x of [-0.42, 0.42]) {
        context.fillRect(
          width * x - size * 0.025,
          -depth * 0.46,
          size * 0.05,
          depth * 0.84,
        )
      }
      context.fillStyle = palette.accentColor
      context.fillRect(-width * 0.48, depth * 0.24, width * 0.96, depth * 0.07)
      break
    }
    case 'tower': {
      context.fillStyle = palette.secondaryColor
      context.beginPath()
      context.moveTo(-size * 0.18, size * 0.48)
      context.lineTo(-size * 0.08, -size * 0.4)
      context.lineTo(size * 0.08, -size * 0.4)
      context.lineTo(size * 0.18, size * 0.48)
      context.closePath()
      context.fill()
      context.fillStyle = palette.accentColor
      context.beginPath()
      context.arc(0, -size * 0.42, size * 0.2, 0, Math.PI * 2)
      context.fill()
      break
    }
    case 'round-landmark': {
      context.strokeStyle = accent
      context.lineWidth = Math.max(2, size * 0.09)
      context.beginPath()
      context.arc(0, 0, size * 0.46, 0, Math.PI * 2)
      context.stroke()
      context.beginPath()
      context.moveTo(-size * 0.44, 0)
      context.lineTo(size * 0.44, 0)
      context.moveTo(0, -size * 0.44)
      context.lineTo(0, size * 0.44)
      context.stroke()
      break
    }
    case 'boat': {
      context.fillStyle = '#d7dde8'
      context.beginPath()
      context.moveTo(size * 0.58, 0)
      context.lineTo(size * 0.24, size * 0.25)
      context.lineTo(-size * 0.55, size * 0.18)
      context.lineTo(-size * 0.55, -size * 0.18)
      context.lineTo(size * 0.24, -size * 0.25)
      context.closePath()
      context.fill()
      context.fillStyle = '#31556c'
      context.fillRect(-size * 0.1, -size * 0.13, size * 0.3, size * 0.26)
      break
    }
    case 'bridge': {
      drawRoundedPanel(context, size * 1.55, size * 0.3, '#667384')
      context.fillStyle = 'rgba(7, 11, 20, 0.38)'
      context.fillRect(-size * 0.6, -size * 0.05, size * 1.2, size * 0.1)
      break
    }
    case 'floodlight': {
      context.strokeStyle = '#8995a5'
      context.lineWidth = Math.max(1, size * 0.07)
      context.beginPath()
      context.moveTo(0, size * 0.45)
      context.lineTo(0, -size * 0.25)
      context.stroke()
      context.fillStyle = 'rgba(255, 236, 174, 0.72)'
      context.fillRect(-size * 0.28, -size * 0.4, size * 0.56, size * 0.2)
      break
    }
    case 'gantry': {
      const crossbarWidth = size * 1.14
      const crossbarHeight = Math.max(3, size * 0.16)
      context.fillStyle = '#8d99aa'
      context.fillRect(
        -crossbarWidth / 2,
        -crossbarHeight / 2,
        crossbarWidth,
        crossbarHeight,
      )
      context.strokeStyle = '#778495'
      context.lineWidth = Math.max(1, size * 0.07)
      context.beginPath()
      context.moveTo(-size * 0.52, 0)
      context.lineTo(-size * 0.52, size * 0.22)
      context.moveTo(size * 0.52, 0)
      context.lineTo(size * 0.52, size * 0.22)
      context.stroke()
      context.fillStyle = '#202834'
      for (const offset of [-0.32, -0.16, 0, 0.16, 0.32]) {
        context.beginPath()
        context.arc(size * offset, 0, Math.max(1, size * 0.035), 0, Math.PI * 2)
        context.fill()
      }
      break
    }
    case 'escape-obstacle': {
      context.fillStyle = '#d6dbe3'
      context.beginPath()
      context.arc(0, 0, size * 0.42, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = '#d4473f'
      context.beginPath()
      context.arc(0, 0, size * 0.28, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = '#eef1f5'
      context.beginPath()
      context.arc(0, 0, size * 0.1, 0, Math.PI * 2)
      context.fill()
      context.strokeStyle = '#222a34'
      context.lineWidth = Math.max(1, size * 0.08)
      context.beginPath()
      context.arc(0, 0, size * 0.42, 0, Math.PI * 2)
      context.stroke()
      break
    }
    default: {
      drawRoundedPanel(context, size, size * 0.72, accent)
    }
  }

  context.restore()
}
