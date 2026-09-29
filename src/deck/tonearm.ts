import * as THREE from 'three'

// Planar kinematics of a pivoted tonearm. Everything is measured in the
// turntable's local space (three.js Y-up), so the rig works wherever the
// deck is placed in the room.

export interface ArmGeometry {
  /** Pivot position (x, z). */
  pivot: THREE.Vector2
  /** Stylus offset from the pivot at yaw = 0 (x, z). */
  offset: THREE.Vector2
  /** Spindle position (x, z). */
  spindle: THREE.Vector2
}

export function measureArm(yaw: THREE.Object3D, stylus: THREE.Object3D, spindle: THREE.Object3D, space: THREE.Object3D): ArmGeometry {
  const saved = yaw.rotation.y
  yaw.rotation.y = 0
  space.updateWorldMatrix(true, true)
  const toLocal = (o: THREE.Object3D) => {
    const v = o.getWorldPosition(new THREE.Vector3())
    space.worldToLocal(v)
    return new THREE.Vector2(v.x, v.z)
  }
  const pivot = toLocal(yaw)
  const tip = toLocal(stylus)
  const spin = toLocal(spindle)
  yaw.rotation.y = saved
  space.updateWorldMatrix(true, true)
  return { pivot, offset: tip.sub(pivot), spindle: spin }
}

/** Stylus (x, z) for a yaw angle; matches THREE's rotation about +Y. */
export function stylusAt(g: ArmGeometry, yaw: number): THREE.Vector2 {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  // Rotation about +Y maps (x, z) -> (x cos + z sin, -x sin + z cos)
  return new THREE.Vector2(
    g.pivot.x + g.offset.x * c + g.offset.y * s,
    g.pivot.y - g.offset.x * s + g.offset.y * c,
  )
}

export const radiusAtYaw = (g: ArmGeometry, yaw: number) => stylusAt(g, yaw).distanceTo(g.spindle)

/**
 * Yaw that puts the stylus at groove radius r. The arm sweeps inward as it
 * rotates towards the spindle; the direction is detected from the geometry.
 */
export function yawForRadius(g: ArmGeometry, r: number): number {
  const dir = radiusAtYaw(g, 0.05) < radiusAtYaw(g, 0) ? 1 : -1
  // Radius only decreases up to the point of closest approach to the spindle.
  let hi = 0
  for (let a = 0; Math.abs(a) < Math.PI; a += dir * 0.01) {
    if (radiusAtYaw(g, a) > radiusAtYaw(g, hi)) break
    hi = a
  }
  let lo = 0
  // Bisection: radius decreases monotonically from lo to hi over the record.
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (radiusAtYaw(g, mid) > r) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
