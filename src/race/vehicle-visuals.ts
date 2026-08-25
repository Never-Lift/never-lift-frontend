import {
  CAMERA_GROUND_DEPTH_SCALE,
  CAMERA_HEIGHT_SCALE,
} from '@/race/camera'
import type { DamageKind } from '@/race/types'
import { VEHICLE_SHADOW_SETTINGS } from '@/race/visual-settings'

export type VehicleVisualDetail = 'race' | 'preview'

export type VehicleView =
  | 'rear'
  | 'rear-left'
  | 'left-side'
  | 'front-left'
  | 'front'
  | 'front-right'
  | 'right-side'
  | 'rear-right'

export type VehiclePoint3 = {
  longitudinal: number
  lateral: number
  height: number
}

export type DrawVehicleVisualOptions = {
  color: string
  x: number
  y: number
  relativeYawRadians: number
  length: number
  width: number
  detail?: VehicleVisualDetail
  damage?: DamageKind
  groundDepthScale?: number
  heightScale?: number
  shadowAngleRadians?: number
  shadowDistanceToWidthRatio?: number
  shadowOpacity?: number
}

type FormulaSection = {
  longitudinal: number
  halfWidth: number
  topHalfWidth: number
  baseHeight: number
  topHeight: number
}

type FormulaSurface = {
  points: VehiclePoint3[]
  fill: string
  stroke?: string
  lineWidth?: number
}

export type FormulaWheelSpec = {
  longitudinal: number
  longitudinalSize: number
  lateralSize: number
  heightSize: number
}

export type VehicleProjection = {
  relativeYawRadians: number
  length: number
  width: number
  groundDepthScale: number
  heightScale: number
  sinYaw?: number
  cosYaw?: number
}

const FULL_CIRCLE = Math.PI * 2
const VIEW_STEP_RADIANS = FULL_CIRCLE / 32
export const VEHICLE_DIRECTION_COUNT = 32

const TIRE_COLOR = '#05070b'
const TIRE_TOP_COLOR = '#111722'
const CARBON_COLOR = '#111923'
const CARBON_LIGHT_COLOR = '#263341'
const COCKPIT_COLOR = '#07101b'
const HALO_COLOR = '#9aa8b8'
const HELMET_VISOR_COLOR = '#a9e7ff'

const FORMULA_WHEEL_SPECS: FormulaWheelSpec[] = [
  {
    longitudinal: 0.27,
    longitudinalSize: 0.118,
    lateralSize: 0.18,
    heightSize: 0.33,
  },
  {
    longitudinal: -0.31,
    longitudinalSize: 0.135,
    lateralSize: 0.22,
    heightSize: 0.38,
  },
]
const FORMULA_MODEL_CACHE = new Map<
  string,
  ReturnType<typeof createFormulaSurfaces>
>()
const SURFACE_ORDER_CACHE = new WeakMap<
  FormulaSurface[],
  Map<string, FormulaSurface[]>
>()

export function getFormulaWheelSpecs() {
  return FORMULA_WHEEL_SPECS.map((wheel) => ({ ...wheel }))
}

const FORMULA_SECTIONS: FormulaSection[] = [
  {
    longitudinal: 0.49,
    halfWidth: 0.035,
    topHalfWidth: 0.02,
    baseHeight: 0.08,
    topHeight: 0.15,
  },
  {
    longitudinal: 0.33,
    halfWidth: 0.085,
    topHalfWidth: 0.055,
    baseHeight: 0.08,
    topHeight: 0.24,
  },
  {
    longitudinal: 0.13,
    halfWidth: 0.16,
    topHalfWidth: 0.1,
    baseHeight: 0.075,
    topHeight: 0.34,
  },
  {
    longitudinal: -0.03,
    halfWidth: 0.25,
    topHalfWidth: 0.14,
    baseHeight: 0.07,
    topHeight: 0.44,
  },
  {
    longitudinal: -0.2,
    halfWidth: 0.34,
    topHalfWidth: 0.19,
    baseHeight: 0.065,
    topHeight: 0.4,
  },
  {
    longitudinal: -0.35,
    halfWidth: 0.23,
    topHalfWidth: 0.14,
    baseHeight: 0.075,
    topHeight: 0.33,
  },
  {
    longitudinal: -0.46,
    halfWidth: 0.105,
    topHalfWidth: 0.07,
    baseHeight: 0.09,
    topHeight: 0.25,
  },
]

function normalizeSignedAngle(angleRadians: number) {
  return Math.atan2(Math.sin(angleRadians), Math.cos(angleRadians))
}

export function vehicleYawRelativeToCamera(
  cameraOrientation: number,
  vehicleOrientation: number,
) {
  return normalizeSignedAngle(vehicleOrientation - cameraOrientation)
}

export function quantizeVehicleViewAngle(relativeYawRadians: number) {
  const normalized = normalizeSignedAngle(relativeYawRadians)
  const directionIndex =
    ((Math.round(normalized / VIEW_STEP_RADIANS) % VEHICLE_DIRECTION_COUNT) +
      VEHICLE_DIRECTION_COUNT) %
    VEHICLE_DIRECTION_COUNT
  return {
    directionIndex,
    angleRadians: normalizeSignedAngle(directionIndex * VIEW_STEP_RADIANS),
  }
}

export function classifyVehicleView(relativeYawRadians: number): VehicleView {
  const angle = normalizeSignedAngle(relativeYawRadians)
  const octant = Math.round(angle / (Math.PI / 4))
  const normalizedOctant = ((octant % 8) + 8) % 8
  return (
    [
      'rear',
      'rear-left',
      'left-side',
      'front-left',
      'front',
      'front-right',
      'right-side',
      'rear-right',
    ] as const
  )[normalizedOctant]
}

export function projectVehiclePoint(
  point: VehiclePoint3,
  projection: VehicleProjection,
) {
  const sinYaw =
    projection.sinYaw ?? Math.sin(projection.relativeYawRadians)
  const cosYaw =
    projection.cosYaw ?? Math.cos(projection.relativeYawRadians)
  const longitudinal = point.longitudinal * projection.length
  const lateral = point.lateral * projection.width
  const height = point.height * projection.width
  const cameraRight =
    -longitudinal * sinYaw + lateral * cosYaw
  const cameraForward =
    longitudinal * cosYaw + lateral * sinYaw
  return {
    x: cameraRight,
    y:
      -cameraForward * projection.groundDepthScale -
      height * projection.heightScale,
  }
}

function cameraDepth(point: VehiclePoint3, projection: VehicleProjection) {
  const sinYaw =
    projection.sinYaw ?? Math.sin(projection.relativeYawRadians)
  const cosYaw =
    projection.cosYaw ?? Math.cos(projection.relativeYawRadians)
  const longitudinal = point.longitudinal * projection.length
  const lateral = point.lateral * projection.width
  const height = point.height * projection.width
  const groundDepth =
    longitudinal * cosYaw + lateral * sinYaw
  return (
    groundDepth * projection.heightScale -
    height * projection.groundDepthScale
  )
}

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

function tracePolygon(
  context: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
) {
  if (points.length === 0) return
  context.beginPath()
  context.moveTo(points[0].x, points[0].y)
  for (const point of points.slice(1)) context.lineTo(point.x, point.y)
  context.closePath()
}

function createBoxSurfaces(
  center: VehiclePoint3,
  size: VehiclePoint3,
  colors: { top: string; side: string; end?: string },
): FormulaSurface[] {
  const fromLongitudinal = center.longitudinal - size.longitudinal / 2
  const toLongitudinal = center.longitudinal + size.longitudinal / 2
  const fromLateral = center.lateral - size.lateral / 2
  const toLateral = center.lateral + size.lateral / 2
  const fromHeight = center.height - size.height / 2
  const toHeight = center.height + size.height / 2
  const point = (
    longitudinal: number,
    lateral: number,
    height: number,
  ): VehiclePoint3 => ({ longitudinal, lateral, height })
  const endColor = colors.end ?? colors.side

  return [
    {
      points: [
        point(fromLongitudinal, fromLateral, fromHeight),
        point(toLongitudinal, fromLateral, fromHeight),
        point(toLongitudinal, toLateral, fromHeight),
        point(fromLongitudinal, toLateral, fromHeight),
      ],
      fill: colors.side,
    },
    {
      points: [
        point(fromLongitudinal, fromLateral, toHeight),
        point(fromLongitudinal, toLateral, toHeight),
        point(toLongitudinal, toLateral, toHeight),
        point(toLongitudinal, fromLateral, toHeight),
      ],
      fill: colors.top,
      stroke: 'rgba(240, 240, 250, 0.12)',
    },
    {
      points: [
        point(fromLongitudinal, fromLateral, fromHeight),
        point(fromLongitudinal, fromLateral, toHeight),
        point(toLongitudinal, fromLateral, toHeight),
        point(toLongitudinal, fromLateral, fromHeight),
      ],
      fill: colors.side,
    },
    {
      points: [
        point(fromLongitudinal, toLateral, fromHeight),
        point(toLongitudinal, toLateral, fromHeight),
        point(toLongitudinal, toLateral, toHeight),
        point(fromLongitudinal, toLateral, toHeight),
      ],
      fill: colors.side,
    },
    {
      points: [
        point(fromLongitudinal, fromLateral, fromHeight),
        point(fromLongitudinal, toLateral, fromHeight),
        point(fromLongitudinal, toLateral, toHeight),
        point(fromLongitudinal, fromLateral, toHeight),
      ],
      fill: endColor,
    },
    {
      points: [
        point(toLongitudinal, fromLateral, fromHeight),
        point(toLongitudinal, fromLateral, toHeight),
        point(toLongitudinal, toLateral, toHeight),
        point(toLongitudinal, toLateral, fromHeight),
      ],
      fill: endColor,
    },
  ]
}

function createBodySurfaces(
  primaryColor: string,
  primaryLight: string,
  primaryDark: string,
): FormulaSurface[] {
  const surfaces: FormulaSurface[] = []
  for (let index = 0; index < FORMULA_SECTIONS.length - 1; index += 1) {
    const front = FORMULA_SECTIONS[index]
    const rear = FORMULA_SECTIONS[index + 1]
    surfaces.push({
      points: [
        {
          longitudinal: front.longitudinal,
          lateral: -front.topHalfWidth,
          height: front.topHeight,
        },
        {
          longitudinal: front.longitudinal,
          lateral: front.topHalfWidth,
          height: front.topHeight,
        },
        {
          longitudinal: rear.longitudinal,
          lateral: rear.topHalfWidth,
          height: rear.topHeight,
        },
        {
          longitudinal: rear.longitudinal,
          lateral: -rear.topHalfWidth,
          height: rear.topHeight,
        },
      ],
      fill: primaryLight,
      stroke: 'rgba(240, 240, 250, 0.16)',
    })
    for (const side of [-1, 1]) {
      surfaces.push({
        points: [
          {
            longitudinal: front.longitudinal,
            lateral: side * front.topHalfWidth,
            height: front.topHeight,
          },
          {
            longitudinal: rear.longitudinal,
            lateral: side * rear.topHalfWidth,
            height: rear.topHeight,
          },
          {
            longitudinal: rear.longitudinal,
            lateral: side * rear.halfWidth,
            height: rear.baseHeight,
          },
          {
            longitudinal: front.longitudinal,
            lateral: side * front.halfWidth,
            height: front.baseHeight,
          },
        ],
        fill: side < 0 ? primaryColor : primaryDark,
        stroke: 'rgba(7, 11, 20, 0.2)',
      })
    }
  }
  return surfaces
}

function createFormulaSurfaces(color: string, totalLoss: boolean) {
  const baseColor = totalLoss ? mixHexColor(color, '#05070c', 0.58) : color
  const primaryLight = mixHexColor(baseColor, '#f0f0fa', 0.28)
  const primaryDark = mixHexColor(baseColor, '#05070c', 0.48)
  const secondaryColor = mixHexColor(baseColor, '#f0f0fa', 0.7)
  const surfaces: FormulaSurface[] = []

  surfaces.push(
    ...createBoxSurfaces(
      { longitudinal: -0.08, lateral: 0, height: 0.045 },
      { longitudinal: 0.72, lateral: 0.73, height: 0.055 },
      { top: CARBON_LIGHT_COLOR, side: CARBON_COLOR },
    ),
  )

  for (const wheel of FORMULA_WHEEL_SPECS) {
    for (const side of [-1, 1]) {
      const lateralCenter = 0.5 - wheel.lateralSize / 2
      surfaces.push(
        ...createBoxSurfaces(
          {
            longitudinal: wheel.longitudinal,
            lateral: side * lateralCenter,
            height: wheel.heightSize / 2,
          },
          {
            longitudinal: wheel.longitudinalSize,
            lateral: wheel.lateralSize,
            height: wheel.heightSize,
          },
          { top: TIRE_TOP_COLOR, side: TIRE_COLOR, end: '#020305' },
        ),
      )
    }
  }

  surfaces.push(
    ...createBoxSurfaces(
      { longitudinal: 0.455, lateral: 0, height: 0.095 },
      { longitudinal: 0.07, lateral: 1, height: 0.07 },
      { top: secondaryColor, side: primaryDark },
    ),
    ...createBoxSurfaces(
      { longitudinal: 0.4, lateral: 0, height: 0.12 },
      { longitudinal: 0.12, lateral: 0.72, height: 0.045 },
      { top: baseColor, side: primaryDark },
    ),
    ...createBoxSurfaces(
      { longitudinal: -0.445, lateral: 0, height: 0.57 },
      { longitudinal: 0.075, lateral: 0.86, height: 0.105 },
      { top: baseColor, side: primaryDark, end: secondaryColor },
    ),
    ...createBoxSurfaces(
      { longitudinal: -0.45, lateral: -0.405, height: 0.36 },
      { longitudinal: 0.09, lateral: 0.045, height: 0.44 },
      { top: primaryLight, side: primaryDark },
    ),
    ...createBoxSurfaces(
      { longitudinal: -0.45, lateral: 0.405, height: 0.36 },
      { longitudinal: 0.09, lateral: 0.045, height: 0.44 },
      { top: primaryLight, side: primaryDark },
    ),
  )

  surfaces.push(...createBodySurfaces(baseColor, primaryLight, primaryDark))
  return { surfaces, baseColor, primaryDark, secondaryColor }
}

function paintSurfaces(
  context: CanvasRenderingContext2D,
  surfaces: FormulaSurface[],
  projection: VehicleProjection,
) {
  let orders = SURFACE_ORDER_CACHE.get(surfaces)
  if (!orders) {
    orders = new Map()
    SURFACE_ORDER_CACHE.set(surfaces, orders)
  }
  const orderKey = [
    projection.relativeYawRadians,
    projection.length / projection.width,
    projection.groundDepthScale,
    projection.heightScale,
  ]
    .map((value) => value.toFixed(4))
    .join(':')
  let ordered = orders.get(orderKey)
  if (!ordered) {
    ordered = [...surfaces].sort((first, second) => {
      const averageDepth = (surface: FormulaSurface) =>
        surface.points.reduce(
          (sum, point) => sum + cameraDepth(point, projection),
          0,
        ) / surface.points.length
      return averageDepth(second) - averageDepth(first)
    })
    orders.set(orderKey, ordered)
  }

  for (const surface of ordered) {
    tracePolygon(
      context,
      surface.points.map((point) => projectVehiclePoint(point, projection)),
    )
    context.fillStyle = surface.fill
    context.fill()
    if (surface.stroke) {
      context.strokeStyle = surface.stroke
      context.lineWidth = surface.lineWidth ?? 0.8
      context.stroke()
    }
  }
}

function strokeVehicleLine(
  context: CanvasRenderingContext2D,
  projection: VehicleProjection,
  from: VehiclePoint3,
  to: VehiclePoint3,
  color: string,
  lineWidth: number,
) {
  const fromPoint = projectVehiclePoint(from, projection)
  const toPoint = projectVehiclePoint(to, projection)
  context.beginPath()
  context.moveTo(fromPoint.x, fromPoint.y)
  context.lineTo(toPoint.x, toPoint.y)
  context.strokeStyle = color
  context.lineWidth = lineWidth
  context.stroke()
}

function paintSuspension(
  context: CanvasRenderingContext2D,
  projection: VehicleProjection,
  detail: VehicleVisualDetail,
) {
  context.lineCap = 'round'
  const arms = [
    { axle: 0.27, body: 0.17, bodyHalfWidth: 0.13, wheelHalfWidth: 0.36 },
    { axle: -0.31, body: -0.22, bodyHalfWidth: 0.2, wheelHalfWidth: 0.35 },
  ]
  for (const arm of arms) {
    for (const side of [-1, 1]) {
      strokeVehicleLine(
        context,
        projection,
        {
          longitudinal: arm.body,
          lateral: side * arm.bodyHalfWidth,
          height: 0.13,
        },
        {
          longitudinal: arm.axle,
          lateral: side * arm.wheelHalfWidth,
          height: 0.16,
        },
        CARBON_LIGHT_COLOR,
        Math.max(0.75, projection.width * 0.018),
      )
      if (detail === 'preview') {
        strokeVehicleLine(
          context,
          projection,
          {
            longitudinal: arm.body - 0.055,
            lateral: side * arm.bodyHalfWidth,
            height: 0.09,
          },
          {
            longitudinal: arm.axle + 0.035,
            lateral: side * arm.wheelHalfWidth,
            height: 0.24,
          },
          '#536273',
          Math.max(0.55, projection.width * 0.012),
        )
      }
    }
  }
}

function paintCockpitAndLivery(
  context: CanvasRenderingContext2D,
  projection: VehicleProjection,
  colors: {
    baseColor: string
    secondaryColor: string
    primaryDark: string
  },
  detail: VehicleVisualDetail,
  damage: DamageKind,
) {
  const cockpit = [
    { longitudinal: 0.055, lateral: -0.075, height: 0.39 },
    { longitudinal: 0.055, lateral: 0.075, height: 0.39 },
    { longitudinal: -0.2, lateral: 0.105, height: 0.43 },
    { longitudinal: -0.25, lateral: 0, height: 0.45 },
    { longitudinal: -0.2, lateral: -0.105, height: 0.43 },
  ]
  tracePolygon(
    context,
    cockpit.map((point) => projectVehiclePoint(point, projection)),
  )
  context.fillStyle = COCKPIT_COLOR
  context.fill()

  const stripe = [
    { longitudinal: 0.45, lateral: -0.018, height: 0.17 },
    { longitudinal: 0.45, lateral: 0.018, height: 0.17 },
    { longitudinal: 0.1, lateral: 0.045, height: 0.36 },
    { longitudinal: -0.36, lateral: 0.055, height: 0.35 },
    { longitudinal: -0.36, lateral: -0.055, height: 0.35 },
    { longitudinal: 0.1, lateral: -0.045, height: 0.36 },
  ]
  tracePolygon(
    context,
    stripe.map((point) => projectVehiclePoint(point, projection)),
  )
  context.fillStyle = colors.secondaryColor
  context.fill()

  const helmet = projectVehiclePoint(
    { longitudinal: -0.105, lateral: 0, height: 0.51 },
    projection,
  )
  context.beginPath()
  context.ellipse(
    helmet.x,
    helmet.y,
    Math.max(1.3, projection.width * 0.06),
    Math.max(1, projection.width * 0.045),
    0,
    0,
    FULL_CIRCLE,
  )
  context.fillStyle = colors.baseColor
  context.fill()
  context.strokeStyle = HELMET_VISOR_COLOR
  context.lineWidth = Math.max(0.55, projection.width * 0.012)
  context.stroke()

  const haloFront: VehiclePoint3 = {
    longitudinal: 0.035,
    lateral: 0,
    height: 0.55,
  }
  for (const side of [-1, 1]) {
    strokeVehicleLine(
      context,
      projection,
      { longitudinal: -0.19, lateral: side * 0.105, height: 0.5 },
      haloFront,
      HALO_COLOR,
      Math.max(0.85, projection.width * 0.025),
    )
  }
  strokeVehicleLine(
    context,
    projection,
    { longitudinal: -0.19, lateral: -0.105, height: 0.5 },
    { longitudinal: -0.19, lateral: 0.105, height: 0.5 },
    HALO_COLOR,
    Math.max(0.85, projection.width * 0.025),
  )

  if (detail === 'preview') {
    for (const lateral of [-0.44, 0.44]) {
      const frontHub = projectVehiclePoint(
        { longitudinal: 0.27, lateral, height: 0.22 },
        projection,
      )
      const rearHub = projectVehiclePoint(
        { longitudinal: -0.31, lateral, height: 0.25 },
        projection,
      )
      for (const hub of [frontHub, rearHub]) {
        context.beginPath()
        context.arc(
          hub.x,
          hub.y,
          Math.max(0.8, projection.width * 0.025),
          0,
          FULL_CIRCLE,
        )
        context.fillStyle = '#667789'
        context.fill()
      }
    }
  }

  if (damage !== 'none') {
    strokeVehicleLine(
      context,
      projection,
      { longitudinal: -0.25, lateral: -0.11, height: 0.39 },
      { longitudinal: 0.06, lateral: 0.12, height: 0.34 },
      'rgba(7, 11, 20, 0.82)',
      Math.max(1, projection.width * 0.025),
    )
    if (damage === 'total-loss') {
      strokeVehicleLine(
        context,
        projection,
        { longitudinal: 0.28, lateral: -0.08, height: 0.25 },
        { longitudinal: -0.12, lateral: 0.14, height: 0.42 },
        'rgba(7, 11, 20, 0.88)',
        Math.max(1, projection.width * 0.03),
      )
    }
  }
}

function paintGroundShadow(
  context: CanvasRenderingContext2D,
  projection: VehicleProjection,
  shadowAngleRadians: number,
  shadowDistance: number,
  shadowOpacity: number,
) {
  const footprint: VehiclePoint3[] = [
    { longitudinal: 0.5, lateral: -0.51, height: 0 },
    { longitudinal: 0.5, lateral: 0.51, height: 0 },
    { longitudinal: -0.4, lateral: 0.56, height: 0 },
    { longitudinal: -0.5, lateral: 0.47, height: 0 },
    { longitudinal: -0.5, lateral: -0.47, height: 0 },
    { longitudinal: -0.4, lateral: -0.56, height: 0 },
  ]
  context.save()
  context.translate(
    Math.cos(shadowAngleRadians) * shadowDistance,
    Math.sin(shadowAngleRadians) * shadowDistance,
  )
  tracePolygon(
    context,
    footprint.map((point) => projectVehiclePoint(point, projection)),
  )
  context.fillStyle = `rgba(0, 0, 0, ${shadowOpacity})`
  context.shadowColor = `rgba(0, 0, 0, ${shadowOpacity * 0.7})`
  context.shadowBlur = Math.max(2, projection.width * 0.12)
  context.fill()
  context.restore()
}

/**
 * Paints one original F1 master from a quantized 32-direction 2.5D view.
 * Coordinates are screen-space pixels and never affect physics or collision.
 */
export function drawVehicleVisual(
  context: CanvasRenderingContext2D,
  {
    color,
    x,
    y,
    relativeYawRadians,
    length,
    width,
    detail = 'race',
    damage = 'none',
    groundDepthScale = CAMERA_GROUND_DEPTH_SCALE,
    heightScale = CAMERA_HEIGHT_SCALE,
    shadowAngleRadians = VEHICLE_SHADOW_SETTINGS.day.worldAngleRadians,
    shadowDistanceToWidthRatio =
      VEHICLE_SHADOW_SETTINGS.day.distanceToWidthRatio,
    shadowOpacity = VEHICLE_SHADOW_SETTINGS.day.opacity,
  }: DrawVehicleVisualOptions,
) {
  if (length <= 0 || width <= 0) return

  const quantizedView = quantizeVehicleViewAngle(relativeYawRadians)
  const projection: VehicleProjection = {
    relativeYawRadians: quantizedView.angleRadians,
    length,
    width,
    groundDepthScale,
    heightScale,
    sinYaw: Math.sin(quantizedView.angleRadians),
    cosYaw: Math.cos(quantizedView.angleRadians),
  }
  const totalLoss = damage === 'total-loss'
  const cacheKey = `${color}:${totalLoss ? 'total-loss' : 'healthy'}`
  let colors = FORMULA_MODEL_CACHE.get(cacheKey)
  if (!colors) {
    if (FORMULA_MODEL_CACHE.size >= 32) FORMULA_MODEL_CACHE.clear()
    colors = createFormulaSurfaces(color, totalLoss)
    FORMULA_MODEL_CACHE.set(cacheKey, colors)
  }

  context.save()
  context.translate(x, y)
  paintGroundShadow(
    context,
    projection,
    shadowAngleRadians,
    Math.max(1.5, width * shadowDistanceToWidthRatio),
    shadowOpacity,
  )
  paintSuspension(context, projection, detail)
  paintSurfaces(context, colors.surfaces, projection)
  paintCockpitAndLivery(context, projection, colors, detail, damage)
  context.restore()
}
