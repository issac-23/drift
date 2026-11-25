// Polls the Windows foreground window and reports whether a fullscreen app is in front of the ball.
// Win32 calls go through koffi (prebuilt binaries, no compiler). If it cannot load, the feature
// turns itself off and drift carries on.

import fs from 'node:fs'
import path from 'node:path'
import { FULLSCREEN_POLL_MS } from '../shared/config'
import { isFullscreenInFront } from '../shared/fullscreen'

const WS_CAPTION = 0xc00000
const GWL_STYLE = -16
const MONITOR_DEFAULTTONEAREST = 2

// Set DRIFT_DEBUG_FULLSCREEN=1 to log watcher events to the console and to a file beside the data file.
function debugLog(msg: string): void {
  if (!process.env.DRIFT_DEBUG_FULLSCREEN) return
  const line = `${new Date().toISOString()} ${msg}`
  console.log(`[fullscreen] ${line}`)
  const dataFile = process.env.DRIFT_DATA_FILE
  if (dataFile) {
    try {
      fs.appendFileSync(path.join(path.dirname(dataFile), 'drift-fullscreen.log'), line + '\n')
    } catch {
      /* debug only */
    }
  }
}

type Check = () => boolean
interface Rc {
  left: number
  top: number
  right: number
  bottom: number
}

function createCheck(ownHandle: () => bigint | null): Check {
  const koffi = require('koffi') as typeof import('koffi')
  const user32 = koffi.load('user32.dll')
  const RECT = koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' })
  const MONITORINFO = koffi.struct('MONITORINFO', {
    cbSize: 'uint32',
    rcMonitor: RECT,
    rcWork: RECT,
    dwFlags: 'uint32',
  })
  const GetForegroundWindow = user32.func('uintptr_t __stdcall GetForegroundWindow()')
  const GetWindowRect = user32.func('int __stdcall GetWindowRect(uintptr_t hwnd, _Out_ RECT *rect)')
  const MonitorFromWindow = user32.func('uintptr_t __stdcall MonitorFromWindow(uintptr_t hwnd, uint32 flags)')
  const GetMonitorInfoW = user32.func('int __stdcall GetMonitorInfoW(uintptr_t mon, _Inout_ MONITORINFO *info)')
  const GetClassNameW = user32.func('int __stdcall GetClassNameW(uintptr_t hwnd, _Out_ uint16_t *buf, int max)')
  const IsIconic = user32.func('int __stdcall IsIconic(uintptr_t hwnd)')
  const GetWindowLongW = user32.func('int32 __stdcall GetWindowLongW(uintptr_t hwnd, int index)')

  const toRect = (r: Rc) => ({ x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top })

  return () => {
    const fg = BigInt(GetForegroundWindow())
    if (fg === 0n) return false
    const own = ownHandle()
    if (own === null) return false
    const wr = {} as Rc
    if (!GetWindowRect(fg, wr)) return false
    const mon = BigInt(MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST))
    const info = { cbSize: koffi.sizeof(MONITORINFO) } as { cbSize: number; rcMonitor: Rc }
    if (!GetMonitorInfoW(mon, info)) return false
    const buf = new Uint16Array(256)
    const n = GetClassNameW(fg, buf, buf.length)
    const className = String.fromCharCode(...buf.subarray(0, Math.max(0, n)))
    return isFullscreenInFront({
      windowRect: toRect(wr),
      monitorRect: toRect(info.rcMonitor),
      className,
      minimised: !!IsIconic(fg),
      isOwn: fg === own,
      // The ball's monitor is the one drift's own window is on, so no DPI maths is needed.
      sameDisplay: mon === BigInt(MonitorFromWindow(own, MONITOR_DEFAULTTONEAREST)),
      hasTitleBar: (GetWindowLongW(fg, GWL_STYLE) & WS_CAPTION) === WS_CAPTION,
    })
  }
}

/**
 * Starts polling. `ownHandle` returns drift's own native window handle (or null if there is no
 * window). `onChange` fires when the answer flips. Returns a stop function, or null if the
 * feature could not start.
 */
export function startFullscreenWatcher(
  ownHandle: () => bigint | null,
  onChange: (fullscreen: boolean) => void,
): (() => void) | null {
  if (process.platform !== 'win32') return null
  let check: Check
  try {
    check = createCheck(ownHandle)
    check() // fail now, not on the first tick, if a Win32 binding is wrong
  } catch (err) {
    console.error('fullscreen detection unavailable, drift will stay on top of fullscreen apps:', err)
    debugLog(`watcher failed to start: ${String(err)}`)
    return null
  }
  debugLog('watcher started')
  let current = false
  const timer = setInterval(() => {
    let now: boolean
    try {
      now = check()
    } catch (err) {
      // Never leave the ball hidden because the check broke.
      console.error('fullscreen check failed, turning it off:', err)
      clearInterval(timer)
      if (current) onChange(false)
      current = false
      return
    }
    if (now !== current) {
      current = now
      debugLog(`fullscreen in front: ${now}`)
      onChange(now)
    }
  }, FULLSCREEN_POLL_MS)
  return () => clearInterval(timer)
}
