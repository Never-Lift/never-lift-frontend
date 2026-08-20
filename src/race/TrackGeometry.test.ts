import { describe, expect, it } from 'vitest'

import { crossesGate, TrackGeometry } from '@/race/TrackGeometry'
import { SHORT_TRACK } from '@/test/track-fixtures'

describe('TrackGeometry', () => {
  const geometry = new TrackGeometry(SHORT_TRACK)
  const radius = SHORT_TRACK.lengthMeters / (Math.PI * 2)

  it('classifies the real-width racing surface independently from screen scale', () => {
    expect(geometry.getSurfaceAt({ x: radius, y: 60 })).toBe('asphalt')
    expect(geometry.getSurfaceAt({ x: radius + 20, y: 60 })).toBe('grass')
  })

  it('returns an inward barrier correction at the actual track limit', () => {
    const [contact] = geometry.getBarrierContacts({ x: radius + 8, y: 80 }, 1.24)

    expect(contact).toBeDefined()
    expect(contact?.penetrationMeters).toBeGreaterThan(0)
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
