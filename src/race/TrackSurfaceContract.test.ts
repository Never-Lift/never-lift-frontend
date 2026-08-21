import { describe, expect, it } from 'vitest'

import { TrackGeometry } from '@/race/TrackGeometry'
import { LONG_TRACK } from '@/test/track-fixtures'

const TRACK_RADIUS = LONG_TRACK.lengthMeters / (Math.PI * 2)
const TRACK_HALF_WIDTH = LONG_TRACK.centerline[0].halfWidthMeters

function pointAtStart(offsetFromCenterlineMeters: number) {
  return {
    x: TRACK_RADIUS + offsetFromCenterlineMeters,
    y: 0,
  }
}

describe('TrackDefinition 1.2 surface contract', () => {
  it('resolves asymmetric left and right environments independently', () => {
    const definition = structuredClone(LONG_TRACK)
    definition.trackLimits.segments[0] = {
      ...definition.trackLimits.segments[0],
      left: {
        zones: [
          { surface: 'grass', widthMeters: 2 },
          { surface: 'asphalt', widthMeters: 5 },
        ],
        barrier: 'guardrail',
      },
      right: {
        zones: [
          { surface: 'asphalt', widthMeters: 3 },
          { surface: 'gravel', widthMeters: 9 },
        ],
        barrier: 'tecpro',
      },
    }
    const geometry = new TrackGeometry(definition)

    const leftFirstZone = geometry.getEnvironmentAt(
      pointAtStart(-(TRACK_HALF_WIDTH + 1)),
    )
    const leftSecondZone = geometry.getEnvironmentAt(
      pointAtStart(-(TRACK_HALF_WIDTH + 4)),
    )
    const rightFirstZone = geometry.getEnvironmentAt(
      pointAtStart(TRACK_HALF_WIDTH + 1),
    )
    const rightSecondZone = geometry.getEnvironmentAt(
      pointAtStart(TRACK_HALF_WIDTH + 5),
    )

    expect(leftFirstZone).toMatchObject({
      side: 'left',
      material: 'grass',
      totalEnvironmentWidthMeters: 7,
    })
    expect(leftSecondZone).toMatchObject({ side: 'left', material: 'asphalt' })
    expect(rightFirstZone).toMatchObject({
      side: 'right',
      material: 'asphalt',
      totalEnvironmentWidthMeters: 12,
    })
    expect(rightSecondZone).toMatchObject({ side: 'right', material: 'gravel' })
  })

  it('maps visual gravel to the existing grass physics surface', () => {
    const definition = structuredClone(LONG_TRACK)
    definition.trackLimits.segments[0].right = {
      zones: [{ surface: 'gravel', widthMeters: 12 }],
      barrier: 'tyre-barrier',
    }
    const geometry = new TrackGeometry(definition)
    const gravelPoint = pointAtStart(TRACK_HALF_WIDTH + 6)

    expect(geometry.getEnvironmentAt(gravelPoint).material).toBe('gravel')
    expect(geometry.getSurfaceAt(gravelPoint)).toBe('grass')
  })

  it('places the impact barrier after the zones without moving it for a visual fence', () => {
    const definition = structuredClone(LONG_TRACK)
    definition.trackLimits.segments[0] = {
      ...definition.trackLimits.segments[0],
      left: {
        zones: [{ surface: 'grass', widthMeters: 2 }],
        barrier: 'guardrail',
      },
      right: {
        zones: [
          { surface: 'asphalt', widthMeters: 3 },
          { surface: 'gravel', widthMeters: 9 },
        ],
        barrier: 'tecpro',
        fence: 'debris-fence',
      },
    }
    const geometry = new TrackGeometry(definition)
    const vehicleRadius = 1

    expect(
      geometry.getBarrierContacts(
        pointAtStart(-(TRACK_HALF_WIDTH + 0.9)),
        vehicleRadius,
      ),
    ).toHaveLength(0)
    expect(
      geometry.getBarrierContacts(
        pointAtStart(-(TRACK_HALF_WIDTH + 1.1)),
        vehicleRadius,
      ),
    ).toHaveLength(1)

    expect(
      geometry.getBarrierContacts(
        pointAtStart(TRACK_HALF_WIDTH + 10.9),
        vehicleRadius,
      ),
    ).toHaveLength(0)
    expect(
      geometry.getBarrierContacts(
        pointAtStart(TRACK_HALF_WIDTH + 11.1),
        vehicleRadius,
      ),
    ).toHaveLength(1)
  })
})
