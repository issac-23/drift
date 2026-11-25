import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addTask,
  deleteTask,
  getDataFile,
  loadTasks,
  setStatus,
  updateTask,
} from '../src/shared/store'

let dir: string
let file: string
const savedEnv = process.env.DRIFT_DATA_FILE

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-test-'))
  file = path.join(dir, 'tasks.json')
  process.env.DRIFT_DATA_FILE = file
})

afterEach(() => {
  if (savedEnv === undefined) delete process.env.DRIFT_DATA_FILE
  else process.env.DRIFT_DATA_FILE = savedEnv
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('data file path', () => {
  it('uses DRIFT_DATA_FILE when set', () => {
    expect(getDataFile()).toBe(file)
  })

  it('falls back to ~/.drift/tasks.json', () => {
    delete process.env.DRIFT_DATA_FILE
    expect(getDataFile()).toBe(path.join(os.homedir(), '.drift', 'tasks.json'))
  })
})

describe('store', () => {
  it('treats a missing file as an empty list', () => {
    expect(loadTasks()).toEqual([])
    expect(fs.existsSync(file)).toBe(false)
  })

  it('adds a task with the documented shape', () => {
    const t = addTask({ title: '  write report ', category: 'work' })
    expect(t.title).toBe('write report')
    expect(t.status).toBe('todo')
    expect(t.deletedAt).toBeNull()
    expect(t.id).toMatch(/^[0-9a-f-]{36}$/)
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(onDisk.version).toBe(1)
    expect(onDisk.tasks).toHaveLength(1)
    expect(onDisk.tasks[0]).toEqual(t)
  })

  it('accepts an initial status', () => {
    expect(addTask({ title: 'a', category: 'life', status: 'pending' }).status).toBe('pending')
  })

  it('rejects empty titles and bad categories', () => {
    expect(() => addTask({ title: '   ', category: 'work' })).toThrow()
    // @ts-expect-error invalid on purpose
    expect(() => addTask({ title: 'x', category: 'fun' })).toThrow()
  })

  it('updates fields and bumps updatedAt', async () => {
    const t = addTask({ title: 'old', category: 'work' })
    await new Promise((r) => setTimeout(r, 5))
    const u = updateTask(t.id, { title: 'new', category: 'school' })
    expect(u?.title).toBe('new')
    expect(u?.category).toBe('school')
    expect(u!.updatedAt > t.updatedAt).toBe(true)
    expect(u!.createdAt).toBe(t.createdAt)
  })

  it('sets status', () => {
    const t = addTask({ title: 'a', category: 'work' })
    expect(setStatus(t.id, 'completed')?.status).toBe('completed')
    expect(loadTasks()[0].status).toBe('completed')
    expect(() => setStatus(t.id, 'nope' as never)).toThrow()
  })

  it('returns null for an unknown id', () => {
    expect(updateTask('missing', { title: 'x' })).toBeNull()
  })

  it('soft deletes: hidden from loadTasks, kept in the file', () => {
    const t = addTask({ title: 'a', category: 'work' })
    expect(deleteTask(t.id)).toBe(true)
    expect(loadTasks()).toEqual([])
    const all = loadTasks({ includeDeleted: true })
    expect(all).toHaveLength(1)
    expect(all[0].deletedAt).not.toBeNull()
    expect(deleteTask(t.id)).toBe(false)
  })

  it('re-reads before writing so another writer is not overwritten', () => {
    const a = addTask({ title: 'from A', category: 'work' })
    // Another process appends directly to the file while this one holds a stale view.
    const stale = loadTasks()
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
    doc.tasks.push({
      id: 'other-process-id',
      title: 'from B',
      category: 'life',
      status: 'todo',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
    })
    fs.writeFileSync(file, JSON.stringify(doc))
    expect(stale).toHaveLength(1)
    setStatus(a.id, 'pending')
    const titles = loadTasks().map((t) => t.title).sort()
    expect(titles).toEqual(['from A', 'from B'])
    expect(loadTasks().find((t) => t.id === a.id)?.status).toBe('pending')
  })

  it('reads a file that starts with a byte order mark', () => {
    const t = addTask({ title: 'bom', category: 'life' })
    fs.writeFileSync(file, '\uFEFF' + fs.readFileSync(file, 'utf8'), 'utf8')
    expect(loadTasks().map((x) => x.id)).toEqual([t.id])
    expect(fs.readdirSync(dir).filter((f) => f.includes('corrupt'))).toEqual([])
  })

  it('maps legacy study and content categories on read without backing the file up', () => {
    const now = new Date().toISOString()
    const mk = (id: string, category: string) => ({
      id, title: id, category, status: 'todo', createdAt: now, updatedAt: now, deletedAt: null,
    })
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 1, tasks: [mk('a', 'study'), mk('b', 'content'), mk('c', 'work')] }),
    )
    expect(loadTasks().map((t) => [t.id, t.category])).toEqual([
      ['a', 'school'],
      ['b', 'life'],
      ['c', 'work'],
    ])
    expect(fs.readdirSync(dir)).toEqual(['tasks.json'])
    // The next write persists the new names.
    addTask({ title: 'new', category: 'emails' })
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as { tasks: Array<{ category: string }> }
    expect(saved.tasks.map((t) => t.category)).toEqual(['school', 'life', 'work', 'emails'])
    expect(fs.readdirSync(dir).filter((f) => f.includes('corrupt'))).toEqual([])
  })

  it('loads valid tasks past one with an unknown category and keeps that entry unchanged', () => {
    const now = new Date().toISOString()
    const good = { id: 'a', title: 'a', category: 'work', status: 'todo', createdAt: now, updatedAt: now, deletedAt: null }
    const bad = { id: 'b', title: 'b', category: 'fun', status: 'todo', createdAt: now, updatedAt: now, deletedAt: null }
    fs.writeFileSync(file, JSON.stringify({ version: 1, tasks: [good, bad] }))
    expect(loadTasks().map((t) => t.id)).toEqual(['a'])
    expect(fs.readdirSync(dir)).toEqual(['tasks.json'])
    addTask({ title: 'new', category: 'life' })
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as { tasks: Array<{ id: string }> }
    expect(saved.tasks.find((t) => t.id === 'b')).toEqual(bad)
    expect(saved.tasks).toHaveLength(3)
    expect(loadTasks().map((t) => t.id)).toHaveLength(2)
    expect(fs.readdirSync(dir).filter((f) => f.includes('corrupt'))).toEqual([])
  })

  it('treats a differently cased category as the lower-case one', () => {
    const now = new Date().toISOString()
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        tasks: [{ id: 'a', title: 'a', category: 'Work', status: 'todo', createdAt: now, updatedAt: now, deletedAt: null }],
      }),
    )
    expect(loadTasks().map((t) => [t.id, t.category])).toEqual([['a', 'work']])
    expect(fs.readdirSync(dir)).toEqual(['tasks.json'])
  })

  it('a plain read never moves an unparseable file; a write backs it up', () => {
    fs.writeFileSync(file, '{ not json')
    expect(() => loadTasks()).toThrow()
    expect(fs.readdirSync(dir)).toEqual(['tasks.json'])
    addTask({ title: 'fresh', category: 'work' })
    const backups = fs.readdirSync(dir).filter((f) => /^tasks\.corrupt-.+\.json$/.test(f))
    expect(backups).toHaveLength(1)
    expect(fs.readFileSync(path.join(dir, backups[0]), 'utf8')).toBe('{ not json')
    expect(loadTasks()).toHaveLength(1)
  })

  it('a write that catches the file mid-save looks again instead of backing it up', () => {
    const t = addTask({ title: 'keep', category: 'work' })
    const real = fs.readFileSync
    let calls = 0
    vi.spyOn(fs, 'readFileSync').mockImplementation(((p: fs.PathOrFileDescriptor, o?: unknown) => {
      if (p === file && calls++ === 0) return '{"vers'
      return (real as (p: fs.PathOrFileDescriptor, o?: unknown) => string | Buffer)(p, o)
    }) as typeof fs.readFileSync)
    addTask({ title: 'second', category: 'life' })
    vi.restoreAllMocks()
    expect(fs.readdirSync(dir).some((f) => f.includes('corrupt'))).toBe(false)
    expect(loadTasks().map((x) => x.id)).toContain(t.id)
    expect(loadTasks()).toHaveLength(2)
  })

  it('backs up a corrupt file instead of overwriting it', () => {
    fs.writeFileSync(file, '{ not json')
    expect(() => loadTasks()).toThrow()
    addTask({ title: 'fresh', category: 'work' })
    const backups = fs.readdirSync(dir).filter((f) => /^tasks\.corrupt-.+\.json$/.test(f))
    expect(backups).toHaveLength(1)
    expect(fs.readFileSync(path.join(dir, backups[0]), 'utf8')).toBe('{ not json')
    expect(loadTasks()).toHaveLength(1)
    expect(fs.readFileSync(path.join(dir, backups[0]), 'utf8')).toBe('{ not json')
  })

  it('refuses to overwrite a corrupt file it could not back up', () => {
    fs.writeFileSync(file, '{ not json')
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('busy'), { code: 'EBUSY' })
    })
    expect(() => addTask({ title: 'x', category: 'work' })).toThrow(/could not be backed up/)
    vi.restoreAllMocks()
    expect(fs.readFileSync(file, 'utf8')).toBe('{ not json')
    expect(fs.readdirSync(dir)).toEqual(['tasks.json'])
  })

  it('backs up a file that is valid JSON but the wrong shape', () => {
    fs.writeFileSync(file, JSON.stringify({ version: 1, tasks: {} }))
    expect(() => loadTasks()).toThrow()
    addTask({ title: 'fresh', category: 'work' })
    expect(fs.readdirSync(dir).some((f) => f.includes('.corrupt-'))).toBe(true)
  })

  it('leaves no temp files behind after writes', () => {
    const t = addTask({ title: 'a', category: 'work' })
    setStatus(t.id, 'cancelled')
    deleteTask(t.id)
    expect(fs.readdirSync(dir)).toEqual(['tasks.json'])
  })

  it('keeps the original intact and cleans up when the write fails', () => {
    const t = addTask({ title: 'keep me', category: 'work' })
    const before = fs.readFileSync(file, 'utf8')
    // Make the rename target a directory so the rename fails.
    const bad = path.join(dir, 'blocked')
    fs.mkdirSync(bad)
    fs.mkdirSync(path.join(bad, 'sub'))
    process.env.DRIFT_DATA_FILE = bad
    expect(() => addTask({ title: 'x', category: 'work' })).toThrow()
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
    process.env.DRIFT_DATA_FILE = file
    expect(fs.readFileSync(file, 'utf8')).toBe(before)
    expect(loadTasks()[0].id).toBe(t.id)
  })
})
