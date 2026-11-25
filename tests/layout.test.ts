import { describe, expect, it } from 'vitest'
import { BALL_SIZE } from '../src/shared/config'
import { clampBall, computeLayout } from '../src/shared/layout'
import type { Rect } from '../src/shared/layout'

const inside = (r: Rect, wa: Rect): boolean =>
  r.x >= wa.x && r.y >= wa.y && r.x + r.width <= wa.x + wa.width && r.y + r.height <= wa.y + wa.height

const screens: Rect[] = [
  { x: 0, y: 0, width: 1920, height: 1040 },
  { x: 0, y: 0, width: 1366, height: 728 },
  { x: -1920, y: 0, width: 1920, height: 1080 },
]

describe('layout', () => {
  for (const wa of screens) {
    const corners = [
      [wa.x, wa.y],
      [wa.x + wa.width, wa.y],
      [wa.x, wa.y + wa.height],
      [wa.x + wa.width, wa.y + wa.height],
      [wa.x + wa.width / 2, wa.y + wa.height / 2],
    ]
    for (const [cx, cy] of corners) {
      it(`keeps the panel and ball on screen near ${cx},${cy} of ${wa.width}x${wa.height}@${wa.x}`, () => {
        const ball = clampBall({ x: cx, y: cy }, wa)
        const l = computeLayout(ball, wa)
        const abs = (r: Rect): Rect => ({ ...r, x: r.x + l.window.x, y: r.y + l.window.y })
        expect(inside(abs(l.panel), wa)).toBe(true)
        expect(inside(abs(l.ball), wa)).toBe(true)
        // ball and panel never overlap
        const b = abs(l.ball)
        const p = abs(l.panel)
        expect(b.x + b.width <= p.x || p.x + p.width <= b.x).toBe(true)
        // ball keeps its screen position
        expect(b.x).toBe(ball.x)
        expect(b.y).toBe(ball.y)
      })
    }
  }

  it('opens toward the interior', () => {
    const wa = screens[0]
    expect(computeLayout({ x: 10, y: 10 }, wa).side).toBe('right')
    expect(computeLayout({ x: 1800, y: 10 }, wa).side).toBe('left')
  })

  it('clamps a ball back onto the work area', () => {
    const wa = screens[0]
    expect(clampBall({ x: 5000, y: -300 }, wa)).toEqual({ x: 1920 - BALL_SIZE, y: 0 })
  })
})
