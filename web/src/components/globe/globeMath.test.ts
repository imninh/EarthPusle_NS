import { describe, expect, it } from 'vitest'
import {
  MAX_PITCH,
  angleDiff,
  clampPitch,
  latLonToVector,
  orientationFor,
  pulseAtPhase,
  pulseState,
  rotateVector,
  starPositions,
} from './globeMath'

describe('latLonToVector', () => {
  it('puts the poles on the y axis', () => {
    const north = latLonToVector(90, 0)
    const south = latLonToVector(-90, 123)
    expect(north[0]).toBeCloseTo(0, 9)
    expect(north[1]).toBeCloseTo(1, 9)
    expect(north[2]).toBeCloseTo(0, 9)
    expect(south[0]).toBeCloseTo(0, 9)
    expect(south[1]).toBeCloseTo(-1, 9)
    expect(south[2]).toBeCloseTo(0, 9)
  })

  it('puts the equator at longitude 0 on +x', () => {
    const [x, y, z] = latLonToVector(0, 0)
    expect(x).toBeCloseTo(1, 9)
    expect(y).toBeCloseTo(0, 9)
    expect(z).toBeCloseTo(0, 9)
  })

  it('puts the equator at longitude 105 where sin/cos say', () => {
    const [x, y, z] = latLonToVector(0, 105)
    expect(x).toBeCloseTo(Math.cos((105 * Math.PI) / 180), 9)
    expect(y).toBeCloseTo(0, 9)
    expect(z).toBeCloseTo(-Math.sin((105 * Math.PI) / 180), 9)
  })

  it('returns unit vectors', () => {
    for (const [lat, lon] of [[15, 105], [-33, -70], [60, 179]]) {
      const [x, y, z] = latLonToVector(lat, lon)
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9)
    }
  })
})

describe('orientationFor', () => {
  it('brings the requested point to +z (towards the camera)', () => {
    for (const [lat, lon] of [[15, 105], [0, 0], [-40, -120], [55, 20]]) {
      const { yaw, pitch } = orientationFor(lat, lon)
      const [x, y, z] = rotateVector(latLonToVector(lat, lon), yaw, pitch)
      expect(x).toBeCloseTo(0, 9)
      expect(y).toBeCloseTo(0, 9)
      expect(z).toBeCloseTo(1, 9)
    }
  })

  it('clamps pitch to 60 degrees', () => {
    expect(orientationFor(85, 0).pitch).toBeCloseTo(MAX_PITCH, 12)
    expect(clampPitch(-2)).toBeCloseTo(-MAX_PITCH, 12)
  })
})

describe('angleDiff', () => {
  it('takes the short way round', () => {
    expect(angleDiff(0.1, 2 * Math.PI - 0.1)).toBeCloseTo(-0.2, 9)
    expect(angleDiff(0, 1)).toBeCloseTo(1, 9)
  })
})

describe('pulses', () => {
  it('runs radius 0.012 -> 0.06 and opacity 0.9 -> 0', () => {
    expect(pulseAtPhase(0)).toEqual({ phase: 0, radius: 0.012, opacity: 0.9 })
    const end = pulseAtPhase(1)
    expect(end.radius).toBeCloseTo(0.06, 12)
    expect(end.opacity).toBeCloseTo(0, 12)
    expect(pulseAtPhase(0.5).radius).toBeCloseTo(0.036, 12)
  })

  it('has a period of 2.4 s and staggers by index', () => {
    expect(pulseState(0, 0).phase).toBeCloseTo(0, 9)
    expect(pulseState(2.4, 0).phase).toBeCloseTo(0, 9)
    expect(pulseState(1.2, 0).phase).toBeCloseTo(0.5, 9)
    expect(pulseState(0, 1).phase).not.toBeCloseTo(pulseState(0, 0).phase, 3)
  })
})

describe('starPositions', () => {
  it('is deterministic and on the sphere of radius 40', () => {
    const a = starPositions(50, 40)
    const b = starPositions(50, 40)
    expect(Array.from(a)).toEqual(Array.from(b))
    for (let i = 0; i < 50; i++) {
      expect(Math.hypot(a[i * 3], a[i * 3 + 1], a[i * 3 + 2])).toBeCloseTo(40, 3)
    }
  })
})
