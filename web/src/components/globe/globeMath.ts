// Pure maths for the globe (docs/UI_SPEC.md §3). No three.js and no DOM here, so it is testable in node.

export type Vec3 = [number, number, number]

const DEG = Math.PI / 180

/** Maximum pitch of the globe, in radians (±60°). */
export const MAX_PITCH = 60 * DEG
export const PULSE_PERIOD_S = 2.4
export const PULSE_RADIUS_MIN = 0.012
export const PULSE_RADIUS_MAX = 0.06
export const PULSE_OPACITY_MAX = 0.9

/**
 * Latitude/longitude (degrees) to a point on the unit sphere. The convention is the one of
 * three.js `SphereGeometry` with an equirectangular texture whose left edge is longitude -180:
 * the equator at longitude 0 is +x, longitude 90 east is -z, the north pole is +y.
 */
export function latLonToVector(lat: number, lon: number): Vec3 {
  const theta = (90 - lat) * DEG
  const phi = (lon + 180) * DEG
  return [-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta)]
}

export function clampPitch(pitch: number): number {
  return Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch))
}

/**
 * Euler angles (radians, three.js order XYZ: v' = Rx(pitch) · Ry(yaw) · v) that bring the given
 * point to the centre of the view (+z, towards the camera). Pitch is clamped to ±60°.
 */
export function orientationFor(lat: number, lon: number): { yaw: number; pitch: number } {
  return { yaw: -Math.PI / 2 - lon * DEG, pitch: clampPitch(lat * DEG) }
}

/** Apply the globe rotation to a vector (the same maths the scene graph does). */
export function rotateVector(v: Vec3, yaw: number, pitch: number): Vec3 {
  const [x, y, z] = v
  const x1 = x * Math.cos(yaw) + z * Math.sin(yaw)
  const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw)
  const y2 = y * Math.cos(pitch) - z1 * Math.sin(pitch)
  const z2 = y * Math.sin(pitch) + z1 * Math.cos(pitch)
  return [x1, y2, z2]
}

/** Smallest signed difference between two angles, in (-π, π]. */
export function angleDiff(from: number, to: number): number {
  const twoPi = Math.PI * 2
  let d = (to - from) % twoPi
  if (d > Math.PI) d -= twoPi
  if (d <= -Math.PI) d += twoPi
  return d
}

export interface PulseState {
  /** 0..1 position in the cycle. */
  phase: number
  /** Ring radius in globe units. */
  radius: number
  /** Ring opacity, 0.9 at the start and 0 at the end. */
  opacity: number
}

/** State of a pulse ring at a phase in 0..1: radius 0.012 -> 0.06, opacity 0.9 -> 0. */
export function pulseAtPhase(phase: number): PulseState {
  const p = Math.max(0, Math.min(1, phase))
  return {
    phase: p,
    radius: PULSE_RADIUS_MIN + (PULSE_RADIUS_MAX - PULSE_RADIUS_MIN) * p,
    opacity: PULSE_OPACITY_MAX * (1 - p),
  }
}

/** Pulse at a time, period 2.4 s, each pulse staggered by its index (golden-ratio steps). */
export function pulseState(timeSeconds: number, index: number, period: number = PULSE_PERIOD_S): PulseState {
  const raw = timeSeconds / period + index * 0.618034
  return pulseAtPhase(raw - Math.floor(raw))
}

/** Static ring for reduced motion: drawn at mid radius. */
export const STATIC_PULSE: PulseState = pulseAtPhase(0.5)

/** Deterministic PRNG (mulberry32) so the star field is the same on every load. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** `count` points uniformly distributed on a sphere of the given radius, as a flat xyz array. */
export function starPositions(count: number, radius: number, seed = 20261114): Float32Array {
  const random = mulberry32(seed)
  const out = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const z = random() * 2 - 1
    const angle = random() * Math.PI * 2
    const r = Math.sqrt(1 - z * z)
    out[i * 3] = Math.cos(angle) * r * radius
    out[i * 3 + 1] = z * radius
    out[i * 3 + 2] = Math.sin(angle) * r * radius
  }
  return out
}
