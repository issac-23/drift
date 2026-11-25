// Pure geometry: where the window sits and where the ball and panel go inside it.
import { BALL_SIZE, PANEL_HEIGHT, PANEL_WIDTH, WINDOW_HEIGHT, WINDOW_PAD, WINDOW_WIDTH } from './config'

export interface Point {
  x: number
  y: number
}
export interface Rect extends Point {
  width: number
  height: number
}
/** Which side of the ball the panel opens on. */
export type Side = 'left' | 'right'

export interface Layout {
  /** Window bounds in screen coordinates. */
  window: Rect
  /** Ball and panel rectangles, relative to the window's top-left. */
  ball: Rect
  panel: Rect
  side: Side
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi))

/** Keep the ball fully inside a work area. */
export function clampBall(ball: Point, wa: Rect): Point {
  return {
    x: Math.round(clamp(ball.x, wa.x, wa.x + wa.width - BALL_SIZE)),
    y: Math.round(clamp(ball.y, wa.y, wa.y + wa.height - BALL_SIZE)),
  }
}

/**
 * The panel opens toward the side of the screen with more room. The window is
 * then slid so the whole panel stays inside the work area.
 */
export function computeLayout(ball: Point, wa: Rect): Layout {
  const spaceRight = wa.x + wa.width - (ball.x + BALL_SIZE)
  const spaceLeft = ball.x - wa.x
  const side: Side = spaceRight >= spaceLeft ? 'right' : 'left'

  const rawX = side === 'right' ? ball.x - WINDOW_PAD : ball.x + BALL_SIZE + WINDOW_PAD - WINDOW_WIDTH
  const rawY = ball.y + BALL_SIZE / 2 - WINDOW_HEIGHT / 2
  const x = Math.round(clamp(rawX, wa.x - WINDOW_PAD, wa.x + wa.width - WINDOW_WIDTH + WINDOW_PAD))
  const y = Math.round(clamp(rawY, wa.y - WINDOW_PAD, wa.y + wa.height - WINDOW_HEIGHT + WINDOW_PAD))

  return {
    window: { x, y, width: WINDOW_WIDTH, height: WINDOW_HEIGHT },
    ball: { x: ball.x - x, y: ball.y - y, width: BALL_SIZE, height: BALL_SIZE },
    panel: {
      x: side === 'right' ? WINDOW_WIDTH - WINDOW_PAD - PANEL_WIDTH : WINDOW_PAD,
      y: WINDOW_PAD,
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
    },
    side,
  }
}
