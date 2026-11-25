import fs from 'node:fs'
import path from 'node:path'
import type { Point } from '../shared/layout'

export interface Settings {
  ball?: Point
  /** Set once the start-at-login entry has been registered, so it is never re-enabled. */
  loginItemRegistered?: boolean
  /** The exe path the start-at-login entry points at; re-registered once if the exe moves. */
  loginItemPath?: string
}

export function readSettings(file: string): Settings {
  const out: Settings = {}
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    const b = raw?.ball
    if (b && Number.isFinite(b.x) && Number.isFinite(b.y)) out.ball = { x: b.x, y: b.y }
    if (raw?.loginItemRegistered === true) out.loginItemRegistered = true
    if (typeof raw?.loginItemPath === 'string' && raw.loginItemPath) out.loginItemPath = raw.loginItemPath
  } catch {
    // missing or unreadable settings just mean "use the defaults"
  }
  return out
}

/** Merge `patch` into the saved settings, so saving one key never drops another. */
export function writeSettings(file: string, patch: Settings): void {
  try {
    const next = { ...readSettings(file), ...patch }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(next), 'utf8')
    fs.renameSync(tmp, file)
  } catch {
    // losing a remembered setting is harmless
  }
}
