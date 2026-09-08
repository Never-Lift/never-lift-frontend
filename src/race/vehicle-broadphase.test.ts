import { describe, expect, it } from 'vitest'
import { VehicleBroadphase } from './vehicle-broadphase'
import { RaceEngine } from './RaceEngine'
import { F1_VEHICLE_COLLIDER } from './vehicle-geometry'
import * as PortableMath from './portable-math'
import { SHORT_TRACK } from '@/test/track-fixtures'

describe('conservative vehicle spatial index', () => {
  it('contains every swept overlap among all 22 cars, including cell boundaries and negative coordinates', () => {
    const cars = new RaceEngine({ track: SHORT_TRACK, mode: 'solo', racers: Array.from({ length: 22 }, (_, index) =>
      ({ id: `${index}`, name: `${index}`, color: '#fff', kind: 'bot' as const })) }).getInterpolatedVehicles()
    const index = new VehicleBroadphase()
    const extent = PortableMath.hypot(F1_VEHICLE_COLLIDER.lengthMeters / 2, F1_VEHICLE_COLLIDER.widthMeters / 2)
    let seed = 72
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
    for (let sample = 0; sample < 200; sample++) {
      for (const car of cars) {
        car.previousPosition = { x: Math.floor(random() * 10 - 5) * 16, y: random() * 120 - 60 }
        car.position = { x: car.previousPosition.x + random() * 40 - 20, y: car.previousPosition.y + random() * 40 - 20 }
        car.trackLayer = random() < 0.3 ? 1 : 0
      }
      index.rebuild(cars)
      const bounds = cars.map(car => ({ minX: Math.min(car.position.x, car.previousPosition.x) - extent,
        maxX: Math.max(car.position.x, car.previousPosition.x) + extent, minY: Math.min(car.position.y, car.previousPosition.y) - extent,
        maxY: Math.max(car.position.y, car.previousPosition.y) + extent }))
      for (let first = 0; first < 22; first++) for (let second = first + 1; second < 22; second++) {
        const a = bounds[first], b = bounds[second]
        if (cars[first].trackLayer === cars[second].trackLayer && a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY) {
          expect(index.candidates(first) & (1 << second)).not.toBe(0)
        }
      }
    }
    // An earlier response can move a car across cells into a later pair.
    cars[0].position = { ...cars[21].position }
    cars[0].trackLayer = cars[21].trackLayer
    index.update(0, cars[0])
    expect(index.candidates(0) & (1 << 21)).not.toBe(0)
    cars[0].position = { x: Number.POSITIVE_INFINITY, y: 0 }
    index.update(0, cars[0])
    expect(index.candidates(0)).toBe(-1)
    expect(index.candidates(21) & 1).toBe(1)
  })
})
