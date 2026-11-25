import { describe, expect, it } from 'vitest'
import { isFullscreenInFront } from '../src/shared/fullscreen'
import type { ForegroundInfo } from '../src/shared/fullscreen'

const monitor = { x: 0, y: 0, width: 1920, height: 1080 }
const base: ForegroundInfo = {
  windowRect: { ...monitor },
  monitorRect: monitor,
  className: 'PPTFrameClass',
  minimised: false,
  isOwn: false,
  sameDisplay: true,
  hasTitleBar: false,
}
const check = (over: Partial<ForegroundInfo>): boolean => isFullscreenInFront({ ...base, ...over })

describe('isFullscreenInFront', () => {
  it('is true when a titleless window covers the whole monitor', () => {
    expect(check({})).toBe(true)
  })

  it('allows a window that overhangs the monitor and one a pixel short', () => {
    expect(check({ windowRect: { x: -8, y: -8, width: 1936, height: 1096 } })).toBe(true)
    expect(check({ windowRect: { x: 1, y: 0, width: 1919, height: 1080 } })).toBe(true)
  })

  it('is false when the window only covers the work area', () => {
    expect(check({ windowRect: { x: 0, y: 0, width: 1920, height: 1032 } })).toBe(false)
  })

  it('is false for a maximised window that still has a title bar', () => {
    expect(check({ hasTitleBar: true })).toBe(false)
  })

  it('works on a second monitor with an offset', () => {
    const m = { x: 1920, y: -200, width: 2560, height: 1440 }
    expect(check({ monitorRect: m, windowRect: { ...m } })).toBe(true)
    expect(check({ monitorRect: m, windowRect: { x: 0, y: 0, width: 1920, height: 1080 } })).toBe(false)
  })

  it('ignores drift itself', () => {
    expect(check({ isOwn: true })).toBe(false)
  })

  it('ignores a fullscreen app on another display', () => {
    expect(check({ sameDisplay: false })).toBe(false)
  })

  it('ignores minimised windows', () => {
    expect(check({ minimised: true })).toBe(false)
  })

  it('ignores the desktop and shell windows', () => {
    for (const className of ['Progman', 'WorkerW', 'Shell_TrayWnd']) {
      expect(check({ className })).toBe(false)
    }
  })

  it('is false for an empty monitor rect', () => {
    expect(check({ monitorRect: { x: 0, y: 0, width: 0, height: 0 }, windowRect: { x: 0, y: 0, width: 0, height: 0 } })).toBe(false)
  })
})
