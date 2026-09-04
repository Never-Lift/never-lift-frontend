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
  visibility?: 'all' | 'preview'
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
// Surface ordering is cached at one-degree intervals. Geometry itself always
// uses the exact yaw; the denser cache keeps overlap changes below a pixel at
// race size without sorting every face on every frame.
const SURFACE_ORDER_BUCKET_COUNT = 360

const TIRE_COLOR = '#05070b'
const TIRE_TOP_COLOR = '#111722'
const CARBON_COLOR = '#111923'
const CARBON_LIGHT_COLOR = '#263341'
const CARBON_HIGHLIGHT_COLOR = '#3a4857'
const COCKPIT_COLOR = '#07101b'
const HELMET_VISOR_COLOR = '#718796'
const TIRE_STRIPE_COLOR = '#68727d'
const REAR_LIGHT_COLOR = '#ff4055'

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
    halfWidth: 0.018,
    topHalfWidth: 0.012,
    baseHeight: 0.07,
    topHeight: 0.115,
  },
  {
    longitudinal: 0.445,
    halfWidth: 0.026,
    topHalfWidth: 0.019,
    baseHeight: 0.07,
    topHeight: 0.135,
  },
  {
    longitudinal: 0.37,
    halfWidth: 0.038,
    topHalfWidth: 0.03,
    baseHeight: 0.07,
    topHeight: 0.17,
  },
  {
    longitudinal: 0.29,
    halfWidth: 0.055,
    topHalfWidth: 0.044,
    baseHeight: 0.065,
    topHeight: 0.21,
  },
  {
    longitudinal: 0.2,
    halfWidth: 0.075,
    topHalfWidth: 0.055,
    baseHeight: 0.065,
    topHeight: 0.26,
  },
  {
    longitudinal: 0.12,
    halfWidth: 0.105,
    topHalfWidth: 0.072,
    baseHeight: 0.065,
    topHeight: 0.31,
  },
  {
    longitudinal: 0.05,
    halfWidth: 0.145,
    topHalfWidth: 0.1,
    baseHeight: 0.06,
    topHeight: 0.36,
  },
  {
    longitudinal: -0.015,
    halfWidth: 0.205,
    topHalfWidth: 0.13,
    baseHeight: 0.055,
    topHeight: 0.4,
  },
  {
    longitudinal: -0.085,
    halfWidth: 0.265,
    topHalfWidth: 0.158,
    baseHeight: 0.052,
    topHeight: 0.43,
  },
  {
    longitudinal: -0.155,
    halfWidth: 0.28,
    topHalfWidth: 0.172,
    baseHeight: 0.052,
    topHeight: 0.44,
  },
  {
    longitudinal: -0.23,
    halfWidth: 0.275,
    topHalfWidth: 0.165,
    baseHeight: 0.055,
    topHeight: 0.405,
  },
  {
    longitudinal: -0.305,
    halfWidth: 0.245,
    topHalfWidth: 0.145,
    baseHeight: 0.06,
    topHeight: 0.37,
  },
  {
    longitudinal: -0.38,
    halfWidth: 0.18,
    topHalfWidth: 0.108,
    baseHeight: 0.07,
    topHeight: 0.325,
  },
  {
    longitudinal: -0.445,
    halfWidth: 0.1,
    topHalfWidth: 0.065,
    baseHeight: 0.08,
    topHeight: 0.255,
  },
  {
    longitudinal: -0.49,
    halfWidth: 0.05,
    topHalfWidth: 0.035,
    baseHeight: 0.09,
    topHeight: 0.18,
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
  for (let index = 1; index < points.length; index++) context.lineTo(points[index].x, points[index].y)
  context.closePath()
}

/** Same continuous projection without allocating a screen-point array per face. */
export function traceVehiclePolygon(
  context: CanvasRenderingContext2D,
  points: readonly VehiclePoint3[],
  projection: VehicleProjection,
) {
  if (points.length === 0) return
  const sinYaw = projection.sinYaw ?? Math.sin(projection.relativeYawRadians)
  const cosYaw = projection.cosYaw ?? Math.cos(projection.relativeYawRadians)
  context.beginPath()
  for (let index = 0; index < points.length; index++) {
    const point = points[index]
    const longitudinal = point.longitudinal * projection.length
    const lateral = point.lateral * projection.width
    const height = point.height * projection.width
    const x = -longitudinal * sinYaw + lateral * cosYaw
    const y = -(longitudinal * cosYaw + lateral * sinYaw) * projection.groundDepthScale - height * projection.heightScale
    if (index === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  }
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

function createPlateSurfaces(
  footprint: Array<{ longitudinal: number; lateral: number }>,
  height: number,
  thickness: number,
  colors: { top: string; side: string; stroke?: string },
  visibility: FormulaSurface['visibility'] = 'all',
): FormulaSurface[] {
  const bottomHeight = Math.max(0, height - thickness / 2)
  const topHeight = height + thickness / 2
  const top = footprint.map<VehiclePoint3>((point) => ({
    ...point,
    height: topHeight,
  }))
  const bottom = footprint.map<VehiclePoint3>((point) => ({
    ...point,
    height: bottomHeight,
  }))
  const surfaces: FormulaSurface[] = [
    {
      points: bottom,
      fill: colors.side,
      visibility,
    },
    {
      points: top,
      fill: colors.top,
      stroke: colors.stroke,
      visibility,
    },
  ]
  for (let index = 0; index < footprint.length; index += 1) {
    const nextIndex = (index + 1) % footprint.length
    surfaces.push({
      points: [
        bottom[index],
        bottom[nextIndex],
        top[nextIndex],
        top[index],
      ],
      fill: colors.side,
      visibility,
    })
  }
  return surfaces
}

function createVerticalPlateSurfaces(
  lateralCenter: number,
  lateralThickness: number,
  profile: Array<{ longitudinal: number; height: number }>,
  colors: { face: string; edge: string; stroke?: string },
  visibility: FormulaSurface['visibility'] = 'all',
): FormulaSurface[] {
  const innerLateral = lateralCenter - lateralThickness / 2
  const outerLateral = lateralCenter + lateralThickness / 2
  const face = (lateral: number) =>
    profile.map<VehiclePoint3>((point) => ({ ...point, lateral }))
  const innerFace = face(innerLateral)
  const outerFace = face(outerLateral)
  const surfaces: FormulaSurface[] = [
    {
      points: innerFace,
      fill: colors.face,
      stroke: colors.stroke,
      visibility,
    },
    {
      points: outerFace,
      fill: colors.face,
      stroke: colors.stroke,
      visibility,
    },
  ]

  for (let index = 0; index < profile.length; index += 1) {
    const nextIndex = (index + 1) % profile.length
    surfaces.push({
      points: [
        innerFace[index],
        innerFace[nextIndex],
        outerFace[nextIndex],
        outerFace[index],
      ],
      fill: colors.edge,
      visibility,
    })
  }

  return surfaces
}

function createWheelSurfaces(
  wheel: FormulaWheelSpec,
  side: -1 | 1,
  accentColor: string,
): FormulaSurface[] {
  const segmentCount = 14
  const lateralCenter = side * (0.5 - wheel.lateralSize / 2)
  const innerLateral = lateralCenter - side * wheel.lateralSize / 2
  const outerLateral = lateralCenter + side * wheel.lateralSize / 2
  const ringPoint = (
    angle: number,
    lateral: number,
    radiusScale = 1,
  ): VehiclePoint3 => ({
    longitudinal:
      wheel.longitudinal +
      Math.cos(angle) * (wheel.longitudinalSize / 2) * radiusScale,
    lateral,
    height:
      wheel.heightSize / 2 +
      Math.sin(angle) * (wheel.heightSize / 2) * radiusScale,
  })
  const surfaces: FormulaSurface[] = []
  for (let index = 0; index < segmentCount; index += 1) {
    const fromAngle = (index / segmentCount) * FULL_CIRCLE
    const toAngle = ((index + 1) / segmentCount) * FULL_CIRCLE
    surfaces.push({
      points: [
        ringPoint(fromAngle, innerLateral),
        ringPoint(toAngle, innerLateral),
        ringPoint(toAngle, outerLateral),
        ringPoint(fromAngle, outerLateral),
      ],
      fill: index % 2 === 0 ? TIRE_TOP_COLOR : TIRE_COLOR,
    })
  }

  for (const lateral of [innerLateral, outerLateral]) {
    surfaces.push(
      {
        points: Array.from({ length: segmentCount }, (_, index) =>
          ringPoint((index / segmentCount) * FULL_CIRCLE, lateral),
        ),
        fill: TIRE_COLOR,
      },
      {
        points: Array.from({ length: segmentCount }, (_, index) =>
          ringPoint((index / segmentCount) * FULL_CIRCLE, lateral, 0.63),
        ),
        fill: '#1c2631',
        stroke: TIRE_STRIPE_COLOR,
        lineWidth: 0.65,
      },
      {
        points: Array.from({ length: 8 }, (_, index) =>
          ringPoint((index / 8) * FULL_CIRCLE, lateral + side * 0.002, 0.23),
        ),
        fill: accentColor,
        stroke: '#05070b',
        lineWidth: 0.5,
      },
    )
  }
  return surfaces
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
  const primaryLight = mixHexColor(baseColor, '#d9dee3', 0.18)
  const primaryDark = mixHexColor(baseColor, '#05070c', 0.46)
  const secondaryColor = mixHexColor(baseColor, '#d9dee3', 0.28)
  const accentColor = mixHexColor(baseColor, '#05070c', 0.24)
  const highlightColor = mixHexColor(baseColor, '#e3e6e9', 0.36)
  const surfaces: FormulaSurface[] = []

  surfaces.push(
    ...createPlateSurfaces(
      [
        { longitudinal: 0.19, lateral: -0.13 },
        { longitudinal: 0.19, lateral: 0.13 },
        { longitudinal: 0.09, lateral: 0.31 },
        { longitudinal: -0.03, lateral: 0.4 },
        { longitudinal: -0.3, lateral: 0.42 },
        { longitudinal: -0.43, lateral: 0.32 },
        { longitudinal: -0.47, lateral: 0.17 },
        { longitudinal: -0.47, lateral: -0.17 },
        { longitudinal: -0.43, lateral: -0.32 },
        { longitudinal: -0.3, lateral: -0.42 },
        { longitudinal: -0.03, lateral: -0.4 },
        { longitudinal: 0.09, lateral: -0.31 },
      ],
      0.03,
      0.038,
      {
        top: CARBON_COLOR,
        side: CARBON_COLOR,
        stroke: 'rgba(240, 240, 250, 0.08)',
      },
    ),
  )

  for (const wheel of FORMULA_WHEEL_SPECS) {
    for (const side of [-1, 1] as const) {
      surfaces.push(...createWheelSurfaces(wheel, side, accentColor))
    }
  }

  surfaces.push(
    ...createPlateSurfaces(
      [
        { longitudinal: 0.495, lateral: -0.48 },
        { longitudinal: 0.485, lateral: -0.5 },
        { longitudinal: 0.435, lateral: -0.47 },
        { longitudinal: 0.395, lateral: -0.19 },
        { longitudinal: 0.42, lateral: -0.055 },
        { longitudinal: 0.462, lateral: -0.035 },
        { longitudinal: 0.462, lateral: 0.035 },
        { longitudinal: 0.42, lateral: 0.055 },
        { longitudinal: 0.395, lateral: 0.19 },
        { longitudinal: 0.435, lateral: 0.47 },
        { longitudinal: 0.485, lateral: 0.5 },
        { longitudinal: 0.495, lateral: 0.48 },
      ],
      0.075,
      0.038,
      { top: CARBON_LIGHT_COLOR, side: CARBON_COLOR },
    ),
    ...createPlateSurfaces(
      [
        { longitudinal: 0.472, lateral: -0.455 },
        { longitudinal: 0.462, lateral: -0.47 },
        { longitudinal: 0.418, lateral: -0.41 },
        { longitudinal: 0.407, lateral: -0.075 },
        { longitudinal: 0.447, lateral: -0.045 },
        { longitudinal: 0.447, lateral: 0.045 },
        { longitudinal: 0.407, lateral: 0.075 },
        { longitudinal: 0.418, lateral: 0.41 },
        { longitudinal: 0.462, lateral: 0.47 },
        { longitudinal: 0.472, lateral: 0.455 },
      ],
      0.12,
      0.025,
      { top: baseColor, side: primaryDark, stroke: accentColor },
    ),
    ...createPlateSurfaces(
      [
        { longitudinal: 0.458, lateral: -0.39 },
        { longitudinal: 0.445, lateral: -0.405 },
        { longitudinal: 0.412, lateral: -0.34 },
        { longitudinal: 0.415, lateral: 0.34 },
        { longitudinal: 0.445, lateral: 0.405 },
        { longitudinal: 0.458, lateral: 0.39 },
      ],
      0.15,
      0.018,
      { top: secondaryColor, side: primaryDark },
    ),
    ...createPlateSurfaces(
      [
        { longitudinal: 0.49, lateral: -0.035 },
        { longitudinal: 0.49, lateral: 0.035 },
        { longitudinal: 0.405, lateral: 0.05 },
        { longitudinal: 0.395, lateral: -0.05 },
      ],
      0.135,
      0.05,
      { top: secondaryColor, side: primaryDark },
    ),
    ...createPlateSurfaces(
      [
        { longitudinal: -0.5, lateral: -0.43 },
        { longitudinal: -0.405, lateral: -0.38 },
        { longitudinal: -0.388, lateral: -0.1 },
        { longitudinal: -0.388, lateral: 0.1 },
        { longitudinal: -0.405, lateral: 0.38 },
        { longitudinal: -0.5, lateral: 0.43 },
      ],
      0.585,
      0.055,
      { top: baseColor, side: primaryDark, stroke: accentColor },
    ),
    ...createPlateSurfaces(
      [
        { longitudinal: -0.47, lateral: -0.36 },
        { longitudinal: -0.405, lateral: -0.32 },
        { longitudinal: -0.395, lateral: 0.32 },
        { longitudinal: -0.47, lateral: 0.36 },
      ],
      0.51,
      0.032,
      { top: secondaryColor, side: primaryDark },
    ),
  )

  for (const side of [-1, 1] as const) {
    surfaces.push(
      ...createVerticalPlateSurfaces(
        side * 0.482,
        0.024,
        [
          { longitudinal: 0.497, height: 0.065 },
          { longitudinal: 0.488, height: 0.185 },
          { longitudinal: 0.443, height: 0.22 },
          { longitudinal: 0.405, height: 0.09 },
        ],
        { face: primaryDark, edge: CARBON_COLOR, stroke: accentColor },
      ),
      ...createVerticalPlateSurfaces(
        side * 0.408,
        0.028,
        [
          { longitudinal: -0.5, height: 0.27 },
          { longitudinal: -0.49, height: 0.63 },
          { longitudinal: -0.405, height: 0.59 },
          { longitudinal: -0.382, height: 0.3 },
        ],
        { face: primaryDark, edge: CARBON_COLOR, stroke: accentColor },
      ),
    )
  }

  surfaces.push(...createBodySurfaces(baseColor, primaryLight, primaryDark))

  for (const side of [-1, 1] as const) {
    surfaces.push(
      ...createPlateSurfaces(
        [
          { longitudinal: 0.055, lateral: side * 0.13 },
          { longitudinal: 0.005, lateral: side * 0.245 },
          { longitudinal: -0.08, lateral: side * 0.275 },
          { longitudinal: -0.2, lateral: side * 0.27 },
          { longitudinal: -0.31, lateral: side * 0.215 },
          { longitudinal: -0.27, lateral: side * 0.14 },
          { longitudinal: -0.05, lateral: side * 0.125 },
        ],
        0.405,
        0.014,
        {
          top: primaryLight,
          side: primaryDark,
          stroke: 'rgba(240, 240, 250, 0.1)',
        },
      ),
      ...createPlateSurfaces(
        [
          { longitudinal: 0.015, lateral: side * 0.19 },
          { longitudinal: -0.04, lateral: side * 0.265 },
          { longitudinal: -0.21, lateral: side * 0.26 },
          { longitudinal: -0.29, lateral: side * 0.205 },
          { longitudinal: -0.18, lateral: side * 0.175 },
        ],
        0.335,
        0.014,
        { top: accentColor, side: primaryDark },
      ),
      ...createVerticalPlateSurfaces(
        side * 0.235,
        0.09,
        [
          { longitudinal: 0.035, height: 0.18 },
          { longitudinal: 0.025, height: 0.345 },
          { longitudinal: -0.035, height: 0.325 },
          { longitudinal: -0.065, height: 0.2 },
        ],
        { face: COCKPIT_COLOR, edge: CARBON_HIGHLIGHT_COLOR },
      ),
      ...createPlateSurfaces(
        [
          { longitudinal: 0.1, lateral: side * 0.35 },
          { longitudinal: -0.29, lateral: side * 0.405 },
          { longitudinal: -0.41, lateral: side * 0.325 },
          { longitudinal: 0.075, lateral: side * 0.325 },
        ],
        0.055,
        0.014,
        { top: accentColor, side: CARBON_COLOR },
      ),
    )
  }

  surfaces.push(
    ...createVerticalPlateSurfaces(
      0,
      0.13,
      [
        { longitudinal: -0.16, height: 0.42 },
        { longitudinal: -0.19, height: 0.57 },
        { longitudinal: -0.24, height: 0.64 },
        { longitudinal: -0.3, height: 0.57 },
        { longitudinal: -0.37, height: 0.37 },
      ],
      { face: secondaryColor, edge: primaryDark, stroke: accentColor },
    ),
    ...createVerticalPlateSurfaces(
      0,
      0.025,
      [
        { longitudinal: -0.23, height: 0.45 },
        { longitudinal: -0.25, height: 0.585 },
        { longitudinal: -0.43, height: 0.34 },
        { longitudinal: -0.45, height: 0.2 },
      ],
      { face: baseColor, edge: primaryDark, stroke: highlightColor },
    ),
    ...createBoxSurfaces(
      { longitudinal: -0.493, lateral: 0, height: 0.205 },
      { longitudinal: 0.025, lateral: 0.055, height: 0.07 },
      { top: REAR_LIGHT_COLOR, side: '#5c0a16', end: REAR_LIGHT_COLOR },
    ),
  )

  for (const lateral of [-0.24, -0.12, 0, 0.12, 0.24]) {
    surfaces.push(
      ...createPlateSurfaces(
        [
          { longitudinal: -0.43, lateral: lateral - 0.009 },
          { longitudinal: -0.43, lateral: lateral + 0.009 },
          { longitudinal: -0.5, lateral: lateral + 0.014 },
          { longitudinal: -0.5, lateral: lateral - 0.014 },
        ],
        0.14,
        0.2,
        { top: CARBON_HIGHLIGHT_COLOR, side: CARBON_COLOR },
        'preview',
      ),
    )
  }

  return {
    surfaces,
    baseColor,
    primaryDark,
    secondaryColor,
    accentColor,
    highlightColor,
  }
}

function paintSurfaces(
  context: CanvasRenderingContext2D,
  surfaces: FormulaSurface[],
  projection: VehicleProjection,
  detail: VehicleVisualDetail,
) {
  let orders = SURFACE_ORDER_CACHE.get(surfaces)
  if (!orders) {
    orders = new Map()
    SURFACE_ORDER_CACHE.set(surfaces, orders)
  }
  const normalizedYaw = normalizeSignedAngle(projection.relativeYawRadians)
  const orderBucket =
    ((Math.round(
      (normalizedYaw / FULL_CIRCLE) * SURFACE_ORDER_BUCKET_COUNT,
    ) %
      SURFACE_ORDER_BUCKET_COUNT) +
      SURFACE_ORDER_BUCKET_COUNT) %
    SURFACE_ORDER_BUCKET_COUNT
  const orderAngle = (orderBucket / SURFACE_ORDER_BUCKET_COUNT) * FULL_CIRCLE
  const orderKey = [
    orderBucket,
    projection.length / projection.width,
    projection.groundDepthScale,
    projection.heightScale,
  ]
    .map((value) => value.toFixed(4))
    .join(':')
  let ordered = orders.get(orderKey)
  if (!ordered) {
    const orderProjection: VehicleProjection = {
      ...projection,
      relativeYawRadians: orderAngle,
      sinYaw: Math.sin(orderAngle),
      cosYaw: Math.cos(orderAngle),
    }
    ordered = [...surfaces].sort((first, second) => {
      const averageDepth = (surface: FormulaSurface) =>
        surface.points.reduce(
          (sum, point) => sum + cameraDepth(point, orderProjection),
          0,
        ) / surface.points.length
      return averageDepth(second) - averageDepth(first)
    })
    orders.set(orderKey, ordered)
  }

  for (const surface of ordered) {
    if (surface.visibility === 'preview' && detail !== 'preview') continue
    traceVehiclePolygon(context, surface.points, projection)
    context.fillStyle = surface.fill
    context.fill()
    if (surface.stroke) {
      context.strokeStyle = surface.stroke
      context.lineWidth =
        surface.lineWidth ?? Math.max(0.45, projection.width * 0.014)
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
    {
      axle: 0.27,
      bodyFront: 0.2,
      bodyRear: 0.11,
      bodyHalfWidth: 0.115,
      wheelHalfWidth: 0.33,
    },
    {
      axle: -0.31,
      bodyFront: -0.19,
      bodyRear: -0.35,
      bodyHalfWidth: 0.19,
      wheelHalfWidth: 0.3,
    },
  ]
  for (const arm of arms) {
    for (const side of [-1, 1]) {
      for (const bodyLongitudinal of [arm.bodyFront, arm.bodyRear]) {
        strokeVehicleLine(
          context,
          projection,
          {
            longitudinal: bodyLongitudinal,
            lateral: side * arm.bodyHalfWidth,
            height: 0.125,
          },
          {
            longitudinal:
              arm.axle +
              (bodyLongitudinal === arm.bodyFront ? 0.022 : -0.022),
            lateral: side * arm.wheelHalfWidth,
            height: 0.17,
          },
          CARBON_HIGHLIGHT_COLOR,
          Math.max(0.65, projection.width * 0.017),
        )
      }
      strokeVehicleLine(
        context,
        projection,
        {
          longitudinal: (arm.bodyFront + arm.bodyRear) / 2,
          lateral: side * (arm.bodyHalfWidth - 0.025),
          height: 0.09,
        },
        {
          longitudinal: arm.axle,
          lateral: side * arm.wheelHalfWidth,
          height: 0.22,
        },
        detail === 'preview' ? '#778696' : CARBON_COLOR,
        Math.max(0.5, projection.width * 0.012),
      )
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
    accentColor: string
    highlightColor: string
  },
  detail: VehicleVisualDetail,
  damage: DamageKind,
) {
  const cockpitSurround = [
    { longitudinal: 0.085, lateral: 0, height: 0.43 },
    { longitudinal: 0.045, lateral: 0.085, height: 0.45 },
    { longitudinal: -0.08, lateral: 0.132, height: 0.47 },
    { longitudinal: -0.18, lateral: 0.12, height: 0.48 },
    { longitudinal: -0.255, lateral: 0, height: 0.49 },
    { longitudinal: -0.18, lateral: -0.12, height: 0.48 },
    { longitudinal: -0.08, lateral: -0.132, height: 0.47 },
    { longitudinal: 0.045, lateral: -0.085, height: 0.45 },
  ]
  tracePolygon(
    context,
    cockpitSurround.map((point) => projectVehiclePoint(point, projection)),
  )
  context.fillStyle = colors.accentColor
  context.fill()

  const cockpit = [
    { longitudinal: 0.045, lateral: 0, height: 0.475 },
    { longitudinal: 0.005, lateral: 0.06, height: 0.49 },
    { longitudinal: -0.105, lateral: 0.092, height: 0.505 },
    { longitudinal: -0.19, lateral: 0.075, height: 0.515 },
    { longitudinal: -0.225, lateral: 0, height: 0.52 },
    { longitudinal: -0.19, lateral: -0.075, height: 0.515 },
    { longitudinal: -0.105, lateral: -0.092, height: 0.505 },
    { longitudinal: 0.005, lateral: -0.06, height: 0.49 },
  ]
  tracePolygon(
    context,
    cockpit.map((point) => projectVehiclePoint(point, projection)),
  )
  context.fillStyle = COCKPIT_COLOR
  context.fill()

  const stripe = [
    { longitudinal: 0.48, lateral: -0.008, height: 0.145 },
    { longitudinal: 0.48, lateral: 0.008, height: 0.145 },
    { longitudinal: 0.14, lateral: 0.034, height: 0.315 },
    { longitudinal: -0.04, lateral: 0.045, height: 0.435 },
    { longitudinal: -0.39, lateral: 0.026, height: 0.315 },
    { longitudinal: -0.39, lateral: -0.026, height: 0.315 },
    { longitudinal: -0.04, lateral: -0.045, height: 0.435 },
    { longitudinal: 0.14, lateral: -0.034, height: 0.315 },
  ]
  tracePolygon(
    context,
    stripe.map((point) => projectVehiclePoint(point, projection)),
  )
  context.fillStyle = colors.secondaryColor
  context.fill()

  const accentStripe = [
    { longitudinal: 0.488, lateral: -0.004, height: 0.152 },
    { longitudinal: 0.488, lateral: 0.004, height: 0.152 },
    { longitudinal: 0.08, lateral: 0.011, height: 0.39 },
    { longitudinal: -0.42, lateral: 0.008, height: 0.31 },
    { longitudinal: -0.42, lateral: -0.008, height: 0.31 },
    { longitudinal: 0.08, lateral: -0.011, height: 0.39 },
  ]
  tracePolygon(
    context,
    accentStripe.map((point) => projectVehiclePoint(point, projection)),
  )
  context.fillStyle = colors.accentColor
  context.fill()

  const helmet = projectVehiclePoint(
    { longitudinal: -0.11, lateral: 0, height: 0.545 },
    projection,
  )
  context.beginPath()
  context.ellipse(
    helmet.x,
    helmet.y,
    Math.max(1.4, projection.width * 0.065),
    Math.max(1.1, projection.width * 0.052),
    0,
    0,
    FULL_CIRCLE,
  )
  context.fillStyle = colors.baseColor
  context.fill()
  context.strokeStyle = colors.accentColor
  context.lineWidth = Math.max(0.65, projection.width * 0.014)
  context.stroke()

  const visor = projectVehiclePoint(
    { longitudinal: -0.083, lateral: 0, height: 0.56 },
    projection,
  )
  context.beginPath()
  context.ellipse(
    visor.x,
    visor.y,
    Math.max(1, projection.width * 0.043),
    Math.max(0.55, projection.width * 0.018),
    0,
    0,
    FULL_CIRCLE,
  )
  context.fillStyle = HELMET_VISOR_COLOR
  context.fill()

  const haloFront: VehiclePoint3 = {
    longitudinal: 0.055,
    lateral: 0,
    height: 0.595,
  }
  for (const side of [-1, 1]) {
    strokeVehicleLine(
      context,
      projection,
      { longitudinal: -0.2, lateral: side * 0.12, height: 0.55 },
      haloFront,
      colors.baseColor,
      Math.max(1, projection.width * 0.03),
    )
  }
  strokeVehicleLine(
    context,
    projection,
    { longitudinal: -0.2, lateral: -0.12, height: 0.55 },
    { longitudinal: -0.2, lateral: 0.12, height: 0.55 },
    colors.baseColor,
    Math.max(1, projection.width * 0.03),
  )
  strokeVehicleLine(
    context,
    projection,
    { longitudinal: -0.185, lateral: -0.105, height: 0.566 },
    { longitudinal: 0.04, lateral: 0, height: 0.608 },
    colors.highlightColor,
    Math.max(0.45, projection.width * 0.01),
  )
  strokeVehicleLine(
    context,
    projection,
    { longitudinal: -0.185, lateral: 0.105, height: 0.566 },
    { longitudinal: 0.04, lateral: 0, height: 0.608 },
    colors.highlightColor,
    Math.max(0.45, projection.width * 0.01),
  )

  for (const side of [-1, 1]) {
    const mirror = projectVehiclePoint(
      { longitudinal: 0.015, lateral: side * 0.205, height: 0.49 },
      projection,
    )
    context.beginPath()
    context.ellipse(
      mirror.x,
      mirror.y,
      Math.max(0.8, projection.width * 0.032),
      Math.max(0.5, projection.width * 0.018),
      0,
      0,
      FULL_CIRCLE,
    )
    context.fillStyle = colors.accentColor
    context.fill()
    context.strokeStyle = colors.primaryDark
    context.lineWidth = Math.max(0.4, projection.width * 0.009)
    context.stroke()
  }

  for (const side of [-1, 1]) {
    strokeVehicleLine(
      context,
      projection,
      { longitudinal: 0.02, lateral: side * 0.18, height: 0.42 },
      { longitudinal: -0.28, lateral: side * 0.27, height: 0.36 },
      colors.highlightColor,
      Math.max(0.5, projection.width * 0.011),
    )
  }

  if (detail === 'preview') {
    const steeringWheel = [
      { longitudinal: -0.02, lateral: -0.045, height: 0.515 },
      { longitudinal: -0.015, lateral: 0.045, height: 0.515 },
      { longitudinal: 0.012, lateral: 0.035, height: 0.54 },
      { longitudinal: 0.008, lateral: -0.035, height: 0.54 },
    ]
    tracePolygon(
      context,
      steeringWheel.map((point) => projectVehiclePoint(point, projection)),
    )
    context.fillStyle = CARBON_HIGHLIGHT_COLOR
    context.fill()
    context.strokeStyle = colors.accentColor
    context.lineWidth = Math.max(0.45, projection.width * 0.008)
    context.stroke()

    for (const side of [-1, 1]) {
      strokeVehicleLine(
        context,
        projection,
        { longitudinal: -0.01, lateral: side * 0.305, height: 0.315 },
        { longitudinal: -0.27, lateral: side * 0.31, height: 0.29 },
        colors.highlightColor,
        Math.max(0.45, projection.width * 0.008),
      )
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
 * Paints one original F1 master from a continuous 2.5D view.
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

  const continuousYaw = normalizeSignedAngle(relativeYawRadians)
  const projection: VehicleProjection = {
    relativeYawRadians: continuousYaw,
    length,
    width,
    groundDepthScale,
    heightScale,
    sinYaw: Math.sin(continuousYaw),
    cosYaw: Math.cos(continuousYaw),
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
  paintSurfaces(context, colors.surfaces, projection, detail)
  paintCockpitAndLivery(context, projection, colors, detail, damage)
  context.restore()
}
