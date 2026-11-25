import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { addTask, loadTasks, withFileLock } from '../src/shared/store'

const run = promisify(execFile)

let dir: string
let file: string
let lock: string
const savedEnv = process.env.DRIFT_DATA_FILE

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-lock-'))
  file = path.join(dir, 'tasks.json')
  lock = `${file}.lock`
  process.env.DRIFT_DATA_FILE = file
})

afterEach(() => {
  vi.restoreAllMocks()
  if (savedEnv === undefined) delete process.env.DRIFT_DATA_FILE
  else process.env.DRIFT_DATA_FILE = savedEnv
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('file lock', () => {
  it('creates the lock file while running and removes it afterwards', () => {
    withFileLock(file, () => {
      expect(fs.existsSync(lock)).toBe(true)
    })
    expect(fs.existsSync(lock)).toBe(false)
  })

  it('releases the lock when the callback throws', () => {
    expect(() =>
      withFileLock(file, () => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(fs.existsSync(lock)).toBe(false)
  })

  it('leaves no lock behind after store writes', () => {
    addTask({ title: 'a', category: 'work' })
    expect(fs.readdirSync(dir)).toEqual(['tasks.json'])
  })

  it('waits for a fresh lock and gives up with an error after the timeout', () => {
    fs.writeFileSync(lock, 'someone-else')
    const started = Date.now()
    expect(() => withFileLock(file, () => 1, { timeoutMs: 150, staleMs: 60_000 })).toThrow(/could not lock/)
    expect(Date.now() - started).toBeGreaterThanOrEqual(140)
    // The other holder's lock is left alone.
    expect(fs.readFileSync(lock, 'utf8')).toBe('someone-else')
  })

  it('takes over a stale lock', () => {
    fs.writeFileSync(lock, 'crashed-process')
    const old = new Date(Date.now() - 6000)
    fs.utimesSync(lock, old, old)
    const t = addTask({ title: 'after crash', category: 'life' })
    expect(loadTasks().map((x) => x.id)).toEqual([t.id])
    expect(fs.existsSync(lock)).toBe(false)
  })

  it('does not remove a lock someone else took over while it ran', () => {
    withFileLock(file, () => {
      fs.writeFileSync(lock, 'new-owner')
    })
    expect(fs.readFileSync(lock, 'utf8')).toBe('new-owner')
  })
})

describe('file lock edge cases', () => {
  const makeStale = (): void => {
    const old = new Date(Date.now() - 6000)
    fs.utimesSync(lock, old, old)
  }

  it('times out instead of spinning when creating the lock keeps failing and the lock is missing', () => {
    const err = Object.assign(new Error('denied'), { code: 'EPERM' })
    vi.spyOn(fs, 'openSync').mockImplementation(() => {
      throw err
    })
    const started = Date.now()
    expect(() => withFileLock(file, () => 1, { timeoutMs: 200 })).toThrow(/could not lock/)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('takes over a stale lock by renaming it and leaves no leftovers', () => {
    fs.writeFileSync(lock, 'crashed-process')
    makeStale()
    const rename = vi.spyOn(fs, 'renameSync')
    expect(withFileLock(file, () => 'ok')).toBe('ok')
    expect(rename).toHaveBeenCalledWith(lock, expect.stringMatching(/\.lock\.stale-/))
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('does not delete a fresh lock when another process won the takeover first', () => {
    fs.writeFileSync(lock, 'crashed-process')
    makeStale()
    const realRename = fs.renameSync
    let first = true
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (first && from === lock) {
        first = false
        // The other process takes over and creates its own fresh lock before our rename runs.
        fs.rmSync(lock)
        fs.writeFileSync(lock, 'other-process')
        const err = Object.assign(new Error('gone'), { code: 'ENOENT' })
        throw err
      }
      realRename(from, to)
    })
    expect(() => withFileLock(file, () => 1, { timeoutMs: 150 })).toThrow(/could not lock/)
    expect(fs.readFileSync(lock, 'utf8')).toBe('other-process')
  })

  it('puts back a fresh lock that it moved aside by mistake', () => {
    fs.writeFileSync(lock, 'crashed-process')
    makeStale()
    const realRename = fs.renameSync
    let first = true
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (first && from === lock) {
        first = false
        // A fresh lock replaced the stale one after we looked at it, so the rename grabs that one.
        fs.rmSync(lock)
        fs.writeFileSync(lock, 'other-process')
      }
      realRename(from, to)
    })
    expect(() => withFileLock(file, () => 1, { timeoutMs: 150 })).toThrow(/could not lock/)
    expect(fs.readFileSync(lock, 'utf8')).toBe('other-process')
    expect(fs.readdirSync(dir).sort()).toEqual(['tasks.json.lock'])
  })
})

describe('two writer processes', () => {
  let script: string

  beforeAll(async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-child-'))
    script = path.join(out, 'add-many.mjs')
    await build({
      entryPoints: [path.join(__dirname, 'fixtures', 'add-many.ts')],
      outfile: script,
      bundle: true,
      platform: 'node',
      format: 'esm',
      logLevel: 'silent',
    })
  })

  it('keeps every task when two processes add 20 each at the same time', async () => {
    const env = { ...process.env, DRIFT_DATA_FILE: file }
    await Promise.all([
      run(process.execPath, [script, 'A', '20'], { env }),
      run(process.execPath, [script, 'B', '20'], { env }),
    ])
    const titles = loadTasks().map((t) => t.title)
    expect(titles).toHaveLength(40)
    expect(new Set(titles).size).toBe(40)
    expect(fs.readdirSync(dir)).toEqual(['tasks.json'])
  }, 60_000)
})
