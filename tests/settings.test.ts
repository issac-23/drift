import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readSettings, writeSettings } from '../src/main/settings'

let dir: string
let file: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-settings-'))
  file = path.join(dir, 'settings.json')
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('settings', () => {
  it('reads defaults from a missing file', () => {
    expect(readSettings(file)).toEqual({})
  })

  it('keeps the ball position when the login flag is saved, and the other way round', () => {
    writeSettings(file, { ball: { x: 10, y: 20 } })
    writeSettings(file, { loginItemRegistered: true })
    expect(readSettings(file)).toEqual({ ball: { x: 10, y: 20 }, loginItemRegistered: true })
    writeSettings(file, { ball: { x: 1, y: 2 } })
    expect(readSettings(file)).toEqual({ ball: { x: 1, y: 2 }, loginItemRegistered: true })
  })

  it('reads an old file that has only the ball', () => {
    fs.writeFileSync(file, JSON.stringify({ ball: { x: 5, y: 6 } }))
    expect(readSettings(file)).toEqual({ ball: { x: 5, y: 6 } })
  })
})
