import { describe, expect, it } from 'vitest'

import { crossesGate, TrackGeometry } from '@/race/TrackGeometry'
import { LONG_TRACK, SHORT_TRACK } from '@/test/track-fixtures'

describe('TrackGeometry', () => {
  const walledGeometry = new TrackGeometry(SHORT_TRACK)
  const runoffGeometry = new TrackGeometry(LONG_TRACK)
  const walledRadius = SHORT_TRACK.lengthMeters / (Math.PI * 2)
  const runoffRadius = LONG_TRACK.lengthMeters / (Math.PI * 2)

  it('classifies the real-width racing surface independently from screen scale', () => {
    expect(runoffGeometry.getSurfaceAt({ x: runoffRadius, y: 0 })).toBe('asphalt')
    expect(runoffGeometry.getSurfaceAt({ x: runoffRadius + 9, y: 0 })).toBe('grass')
  })

  it('keeps a walled circuit closed at the asphalt edge', () => {
    const [contact] = walledGeometry.getBarrierContacts(
      { x: walledRadius + 8, y: 0 },
      1.24,
    )

    expect(contact).toBeDefined()
    expect(contact?.penetrationMeters).toBeGreaterThan(0)
    expect(contact?.pushNormal.x).toBeLessThan(0)
  })

  it('allows ten meters of grass before the external barrier on runoff segments', () => {
    expect(
      runoffGeometry.getBarrierContacts(
        { x: runoffRadius + 9, y: 0 },
        1.24,
      ),
    ).toHaveLength(0)

    const [contact] = runoffGeometry.getBarrierContacts(
      { x: runoffRadius + 18, y: 0 },
      1.24,
    )
    expect(contact).toBeDefined()
    expect(contact?.pushNormal.x).toBeLessThan(0)
  })

  it('accepts a directional gate only in order-compatible forward movement', () => {
    const gate = SHORT_TRACK.checkpoints[0]
    const from = {
      x: gate.position.x - gate.forward.x * 3,
      y: gate.position.y - gate.forward.y * 3,
    }
    const to = {
      x: gate.position.x + gate.forward.x * 3,
      y: gate.position.y + gate.forward.y * 3,
    }

    expect(crossesGate(from, to, gate)).toBe(true)
    expect(crossesGate(to, from, gate)).toBe(false)
    expect(
      crossesGate(
        { x: from.x - gate.forward.y * 30, y: from.y + gate.forward.x * 30 },
        { x: to.x - gate.forward.y * 30, y: to.y + gate.forward.x * 30 },
        gate,
      ),
    ).toBe(false)
  })
})
