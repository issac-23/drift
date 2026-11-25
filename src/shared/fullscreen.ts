// Pure decision logic for "is a fullscreen app in front of the ball?". No Electron or Win32 here.

import { FULLSCREEN_TOLERANCE_PX } from './config'
import type { Rect } from './layout'

export interface ForegroundInfo {
  /** Window rectangle in physical pixels. */
  windowRect: Rect
  /** Full monitor rectangle (not the work area) of the monitor the window is on, physical pixels. */
  monitorRect: Rect
  className: string
  minimised: boolean
  /** The foreground window is drift's own. */
  isOwn: boolean
  /** The foreground window is on the same monitor as the ball. */
  sameDisplay: boolean
  /**
   * The window has a title bar. A maximised normal window can cover the whole monitor when the
   * taskbar auto-hides, but it keeps its title bar; real fullscreen apps drop it.
   */
  hasTitleBar: boolean
}

// The desktop and the shell fill the screen too, but are not "an app in fullscreen".
export const SHELL_CLASSES: readonly string[] = ['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd']

export function coversRect(outer: Rect, inner: Rect, tolerance = FULLSCREEN_TOLERANCE_PX): boolean {
  return (
    outer.x <= inner.x + tolerance &&
    outer.y <= inner.y + tolerance &&
    outer.x + outer.width >= inner.x + inner.width - tolerance &&
    outer.y + outer.height >= inner.y + inner.height - tolerance
  )
}

export function isFullscreenInFront(f: ForegroundInfo): boolean {
  if (f.isOwn || !f.sameDisplay || f.minimised || f.hasTitleBar) return false
  if (SHELL_CLASSES.includes(f.className)) return false
  if (f.monitorRect.width <= 0 || f.monitorRect.height <= 0) return false
  return coversRect(f.windowRect, f.monitorRect)
}
