import { F1_VEHICLE_COLLIDER } from './vehicle-geometry'
import * as PortableMath from './portable-math'
import type { VehicleState } from './types'

const EXTENT = PortableMath.hypot(F1_VEHICLE_COLLIDER.lengthMeters / 2, F1_VEHICLE_COLLIDER.widthMeters / 2)
const CELL_SIZE = 16

/** Conservative swept cells; exact shape tests and canonical pair order follow. */
export class VehicleBroadphase {
  private readonly cells = new Map<string, number>()
  private readonly memberships: string[][] = []
  private readonly masks: number[] = []

  rebuild(vehicles: readonly VehicleState[]) {
    this.cells.clear()
    this.masks.length = vehicles.length
    for (let index = 0; index < vehicles.length; index++) {
      this.update(index, vehicles[index])
    }
  }

  update(index: number, vehicle: VehicleState) {
    const bit = 1 << index
    const memberships = this.memberships[index] ?? (this.memberships[index] = [])
    for (const key of memberships) {
      const mask = (this.cells.get(key) ?? 0) & ~bit
      if (mask) this.cells.set(key, mask)
      else this.cells.delete(key)
    }
    memberships.length = 0
    const minX = Math.floor((Math.min(vehicle.previousPosition.x, vehicle.position.x) - EXTENT) / CELL_SIZE)
    const maxX = Math.floor((Math.max(vehicle.previousPosition.x, vehicle.position.x) + EXTENT) / CELL_SIZE)
    const minY = Math.floor((Math.min(vehicle.previousPosition.y, vehicle.position.y) - EXTENT) / CELL_SIZE)
    const maxY = Math.floor((Math.max(vehicle.previousPosition.y, vehicle.position.y) + EXTENT) / CELL_SIZE)
    // Degenerate/unbounded motion is conservatively tested against every car.
    const cellCount = (maxX - minX + 1) * (maxY - minY + 1)
    if (!Number.isFinite(cellCount) || cellCount > 256) {
      this.masks[index] = -1
      return
    }
    this.masks[index] = 0
    for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
      const key = `${vehicle.trackLayer}:${x}:${y}`
      memberships.push(key)
      this.cells.set(key, (this.cells.get(key) ?? 0) | bit)
    }
  }

  candidates(index: number) {
    let mask = this.masks[index]
    for (const key of this.memberships[index]) mask |= this.cells.get(key) ?? 0
    for (let other = 0; other < this.masks.length; other++) if (this.masks[other] === -1) mask |= 1 << other
    return mask
  }
}
