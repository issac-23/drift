import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addTask, deleteTask, loadTasks, mergeTasks, updateTask } from '../src/shared/store'
import { syncOnce } from '../src/shared/sync'
import type { Task } from '../src/shared/types'

let dir: string
const savedEnv = process.env.DRIFT_DATA_FILE
const cfg = { url: 'https://tend.test', token: 't' }

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-sync-'))
  process.env.DRIFT_DATA_FILE = path.join(dir, 'tasks.json')
})

afterEach(() => {
  if (savedEnv === undefined) delete process.env.DRIFT_DATA_FILE
  else process.env.DRIFT_DATA_FILE = savedEnv
  fs.rmSync(dir, { recursive: true, force: true })
})

/** An in-memory stand-in for tend's /api/tasks with the same last-write-wins rule. */
function fakeServer(initial: Task[] = []) {
  const db = new Map(initial.map((t) => [t.id, t]))
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const { tasks } = JSON.parse(init.body as string) as { tasks: Task[] }
      for (const t of tasks) {
        const cur = db.get(t.id)
        if (!cur || cur.updatedAt < t.updatedAt) db.set(t.id, t)
      }
      return new Response(JSON.stringify({ accepted: tasks.length }))
    }
    const since = new URL(url).searchParams.get('since') ?? ''
    const tasks = [...db.values()].filter((t) => t.updatedAt > since)
    return new Response(JSON.stringify({ tasks, now: new Date().toISOString() }))
  }) as typeof fetch
  return { db, fetchImpl }
}

const remoteTask = (over: Partial<Task> = {}): Task => ({
  id: 'r1',
  title: 'from phone',
  category: 'life',
  status: 'todo',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  ...over,
})

describe('mergeTasks', () => {
  it('adds unknown tasks and keeps the newer copy', () => {
    const t = addTask({ title: 'local', category: 'work' })
    const older = { ...t, title: 'stale', updatedAt: '2000-01-01T00:00:00.000Z' }
    const newer = { ...t, title: 'fresh', updatedAt: '2999-01-01T00:00:00.000Z' }
    expect(mergeTasks([older])).toBe(0)
    expect(loadTasks()[0].title).toBe('local')
    expect(mergeTasks([newer, remoteTask()])).toBe(2)
    expect(loadTasks().map((x) => x.title).sort()).toEqual(['fresh', 'from phone'])
  })

  it('ignores malformed entries', () => {
    expect(mergeTasks([{ id: 1 }, null, 'x'])).toBe(0)
  })
})

describe('syncOnce', () => {
  it('pulls phone tasks and pushes desktop tasks', async () => {
    const { db, fetchImpl } = fakeServer([remoteTask()])
    const mine = addTask({ title: 'from desktop', category: 'school' })
    const res = await syncOnce(cfg, fetchImpl)
    expect(res).toMatchObject({ ok: true, pulled: 1, pushed: 1 })
    expect(loadTasks().map((t) => t.title).sort()).toEqual(['from desktop', 'from phone'])
    expect(db.get(mine.id)?.title).toBe('from desktop')
  })

  it('does not echo pulled tasks back, and sends later edits and deletes', async () => {
    const { db, fetchImpl } = fakeServer([remoteTask()])
    await syncOnce(cfg, fetchImpl)
    const again = await syncOnce(cfg, fetchImpl)
    expect(again.pushed).toBe(0)

    await new Promise((r) => setTimeout(r, 5))
    updateTask('r1', { status: 'completed' })
    const gone = addTask({ title: 'temp', category: 'life' })
    deleteTask(gone.id)
    const res = await syncOnce(cfg, fetchImpl)
    expect(res.pushed).toBe(2)
    expect(db.get('r1')?.status).toBe('completed')
    expect(db.get(gone.id)?.deletedAt).not.toBeNull()
  })

  it('reports an auth failure without touching local tasks', async () => {
    addTask({ title: 'keep', category: 'life' })
    const fetchImpl = (async () => new Response('{}', { status: 401 })) as typeof fetch
    const res = await syncOnce(cfg, fetchImpl)
    expect(res).toMatchObject({ ok: false, error: 'pull failed (401)' })
    expect(loadTasks()).toHaveLength(1)
  })
})
