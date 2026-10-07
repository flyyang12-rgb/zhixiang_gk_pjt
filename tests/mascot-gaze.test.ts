import { describe, expect, it } from 'vitest'
import { gazeDirection } from '../src/utils/mascot-gaze'

describe('mascot gaze', () => {
  const eye = { x: 700, y: 160 }

  it('looks straight ahead when the pointer is at the eye', () => {
    expect(gazeDirection(eye, eye)).toEqual({ x: 0, y: 0 })
  })

  it('follows each direction while staying inside the movement ellipse', () => {
    for (const [dx, dy] of [[500, 0], [-500, 0], [0, 500], [0, -500], [800, 800], [-800, -800]]) {
      const result = gazeDirection({ x: eye.x + dx!, y: eye.y + dy! }, eye)
      expect(Math.sign(result.x)).toBe(Math.sign(dx!))
      expect(Math.sign(result.y)).toBe(Math.sign(dy!))
      expect(Math.hypot(result.x, result.y)).toBeLessThan(1)
    }
  })

  it('moves gently near the eye instead of snapping to the edge', () => {
    expect(gazeDirection({ x: 712, y: 160 }, eye).x).toBeLessThan(0.1)
    expect(gazeDirection({ x: 1200, y: 160 }, eye).x).toBeGreaterThan(0.9)
  })

  it('does not propagate invalid coordinates to SVG transforms', () => {
    expect(gazeDirection({ x: Number.NaN, y: 0 }, eye)).toEqual({ x: 0, y: 0 })
    expect(gazeDirection({ x: 0, y: Number.POSITIVE_INFINITY }, eye)).toEqual({ x: 0, y: 0 })
  })
})
