// Shared task store. No Electron imports: a plain Node process can import this too.
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import {
  CORRUPT_RECHECK_MS,
  LOCK_RETRY_MAX_MS,
  LOCK_RETRY_MIN_MS,
  LOCK_STALE_MS,
  LOCK_TIMEOUT_MS,
  MAX_TITLE_LENGTH as MAX_TITLE,
} from './config'
import { CATEGORIES, STATUSES } from './types'
import type { Category, Status, Task, TaskFile } from './types'

export { CATEGORIES, STATUSES }
export type { Category, Status, Task, TaskFile }

const TaskSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  category: z.enum(CATEGORIES),
  status: z.enum(STATUSES),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
})

const FileShapeSchema = z.object({
  version: z.literal(1),
  tasks: z.array(z.unknown()),
})

/** Category names used before school/emails existed; mapped on read so old files stay valid. */
const LEGACY_CATEGORIES: Record<string, Category> = { study: 'school', content: 'life' }

/** Lower-case the category and map legacy names. Anything else is returned untouched. */
function normaliseTask(t: unknown): unknown {
  if (typeof t !== 'object' || t === null || Array.isArray(t)) return t
  const c = (t as { category?: unknown }).category
  if (typeof c !== 'string') return t
  const lower = c.trim().toLowerCase()
  const category = Object.hasOwn(LEGACY_CATEGORIES, lower) ? LEGACY_CATEGORIES[lower] : lower
  return { ...(t as object), category }
}

interface Loaded {
  tasks: Task[]
  /** Entries that failed validation, kept exactly as read and written back unchanged. */
  invalid: unknown[]
}

export function getDataFile(): string {
  if (process.env.DRIFT_DATA_FILE) return process.env.DRIFT_DATA_FILE
  // Not under %APPDATA%: the Claude desktop app is an MSIX app and redirects new files that
  // processes it launches (the connector) write there into a private package folder.
  return path.join(os.homedir(), '.drift', 'tasks.json')
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function backupCorrupt(file: string): boolean {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.dirname(file)
  const base = path.basename(file, path.extname(file))
  try {
    fs.renameSync(file, path.join(dir, `${base}.corrupt-${stamp}.json`))
    return true
  } catch {
    return false
  }
}

/**
 * Read every task, soft-deleted ones included. Missing file is empty; a bad file is set aside.
 * When `forWrite` is set and the bad file could not be set aside, throw: writing then would
 * overwrite data that was never backed up.
 */
/** The file's task entries, [] when it is missing, or null when it can't be parsed. */
function readEntries(file: string): unknown[] | null {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  try {
    return FileShapeSchema.parse(JSON.parse(raw)).tasks
  } catch {
    return null
  }
}

/**
 * A plain read never moves the file: an unparseable file may just be caught mid-save by another
 * program, so it throws and the caller keeps what it had. Only a write sets a bad file aside, and
 * only after a second look a moment later still can't parse it.
 */
function readAll(file: string, forWrite = false): Loaded {
  let entries = readEntries(file)
  if (entries === null) {
    if (!forWrite) throw new Error(`${file} could not be read as a drift task file`)
    sleepSync(CORRUPT_RECHECK_MS)
    entries = readEntries(file)
  }
  if (entries === null) {
    if (!backupCorrupt(file)) {
      throw new Error(`${file} is unreadable and could not be backed up; refusing to overwrite it`)
    }
    return { tasks: [], invalid: [] }
  }
  const tasks: Task[] = []
  const invalid: unknown[] = []
  for (const entry of entries) {
    const parsed = TaskSchema.safeParse(normaliseTask(entry))
    if (parsed.success) tasks.push(parsed.data)
    else invalid.push(entry)
  }
  return { tasks, invalid }
}

/** Write to a temp file in the same folder, then rename over the original. */
function writeAll(file: string, tasks: Task[], invalid: unknown[]): void {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const data = { version: 1, tasks: [...tasks, ...invalid] }
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    // Windows can refuse the rename briefly while another process (a watcher) has the file open.
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(tmp, file)
        return
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (attempt >= 8 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err
        sleepSync(25 * (attempt + 1))
      }
    }
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      /* nothing more to do */
    }
    throw err
  }
}

/**
 * If `lock` is older than `staleMs`, move it aside by renaming it to a name only this call
 * uses, then delete that copy. Rename is atomic, so when two processes both saw the same stale
 * lock only one rename succeeds; the loser must not delete anything, because by then the
 * winner may have created a fresh lock. Returns true when this call took the lock over.
 */
function takeOverStaleLock(lock: string, token: string, staleMs: number): boolean {
  const aside = `${lock}.stale-${token}`
  try {
    if (Date.now() - fs.statSync(lock).mtimeMs <= staleMs) return false
    fs.renameSync(lock, aside)
  } catch {
    return false // released, or another process took it over first
  }
  try {
    // The lock may have been replaced by a fresh one between the check and the rename. If what
    // we moved is not stale, put it back without overwriting anything, and leave it alone.
    if (Date.now() - fs.statSync(aside).mtimeMs <= staleMs) {
      try {
        fs.linkSync(aside, lock)
      } catch {
        // A newer lock already exists, so the moved one's holder has lost it. That holder checks
        // its token before writing (see `mutate`) and retries instead of writing alongside.
      }
      return false
    }
  } catch {
    return false
  } finally {
    try {
      fs.rmSync(aside, { force: true })
    } catch {
      /* a leftover .stale- file is harmless */
    }
  }
  return true
}

export interface LockOptions {
  staleMs?: number
  timeoutMs?: number
}

/**
 * Run `fn` while holding a cross-process lock: a `<file>.lock` next to the data file, created
 * exclusively. A lock older than `staleMs` belongs to a crashed process and is taken over.
 */
/** Thrown when a lock holder finds, just before writing, that its lock was taken over. */
class LockLostError extends Error {}

export function withFileLock<T>(
  file: string,
  fn: (assertHeld: () => void) => T,
  opts: LockOptions = {},
): T {
  const staleMs = opts.staleMs ?? LOCK_STALE_MS
  const timeoutMs = opts.timeoutMs ?? LOCK_TIMEOUT_MS
  const lock = `${file}.lock`
  const token = `${process.pid}.${randomUUID()}`
  const deadline = Date.now() + timeoutMs
  fs.mkdirSync(path.dirname(file), { recursive: true })

  for (let attempt = 0; ; attempt++) {
    // Checked on every pass, so no retry path can spin past the timeout.
    if (attempt > 0 && Date.now() >= deadline) {
      throw new Error(`could not lock ${file}: another process is holding it`)
    }
    try {
      const fd = fs.openSync(lock, 'wx')
      try {
        fs.writeSync(fd, token)
      } finally {
        fs.closeSync(fd)
      }
      break
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      // EPERM/EACCES: Windows reports these while another process is deleting the lock.
      if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES') throw err
    }
    if (takeOverStaleLock(lock, token, staleMs)) continue
    sleepSync(Math.min(LOCK_RETRY_MAX_MS, LOCK_RETRY_MIN_MS * (attempt + 1)))
  }

  const assertHeld = (): void => {
    let current = ''
    try {
      current = fs.readFileSync(lock, 'utf8')
    } catch {
      /* gone counts as lost */
    }
    if (current !== token) throw new LockLostError(`lost the lock on ${file}`)
  }

  try {
    return fn(assertHeld)
  } finally {
    try {
      // Only remove our own lock: if we ran past the stale limit, someone else may own it now.
      if (fs.readFileSync(lock, 'utf8') === token) fs.rmSync(lock, { force: true })
    } catch {
      /* already gone */
    }
  }
}

/** Under the lock: re-read the file, apply the change to the fresh copy, write it back. */
function mutate<T>(fn: (tasks: Task[]) => T): T {
  const file = getDataFile()
  for (let attempt = 0; ; attempt++) {
    try {
      return withFileLock(file, (assertHeld) => {
        const { tasks, invalid } = readAll(file, true)
        const result = fn(tasks)
        // If another process took the lock over meanwhile, don't write alongside it: start again.
        assertHeld()
        writeAll(file, tasks, invalid)
        return result
      })
    } catch (err) {
      if (!(err instanceof LockLostError) || attempt >= 2) throw err
    }
  }
}

function cleanTitle(title: unknown): string {
  if (typeof title !== 'string') throw new Error('title must be a string')
  const t = title.trim()
  if (!t) throw new Error('title must not be empty')
  if (t.length > MAX_TITLE) throw new Error(`title must be at most ${MAX_TITLE} characters`)
  return t
}

function checkCategory(c: unknown): Category {
  return z.enum(CATEGORIES).parse(c)
}

function checkStatus(s: unknown): Status {
  return z.enum(STATUSES).parse(s)
}

export function loadTasks(opts: { includeDeleted?: boolean } = {}): Task[] {
  const all = readAll(getDataFile()).tasks
  return opts.includeDeleted ? all : all.filter((t) => t.deletedAt === null)
}

export function addTask(input: { title: string; category: Category; status?: Status }): Task {
  const title = cleanTitle(input.title)
  const category = checkCategory(input.category)
  const status = checkStatus(input.status ?? 'todo')
  const now = new Date().toISOString()
  const task: Task = {
    id: randomUUID(),
    title,
    category,
    status,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
  mutate((tasks) => {
    tasks.push(task)
  })
  return task
}

export function updateTask(
  id: string,
  patch: { title?: string; category?: Category; status?: Status },
): Task | null {
  const next: { title?: string; category?: Category; status?: Status } = {}
  if (patch.title !== undefined) next.title = cleanTitle(patch.title)
  if (patch.category !== undefined) next.category = checkCategory(patch.category)
  if (patch.status !== undefined) next.status = checkStatus(patch.status)
  return mutate((tasks) => {
    const task = tasks.find((t) => t.id === id && t.deletedAt === null)
    if (!task) return null
    Object.assign(task, next, { updatedAt: new Date().toISOString() })
    return { ...task }
  })
}

export function setStatus(id: string, status: Status): Task | null {
  return updateTask(id, { status })
}

/** Soft delete: the task stays in the file with deletedAt set. */
export function deleteTask(id: string): boolean {
  return mutate((tasks) => {
    const task = tasks.find((t) => t.id === id && t.deletedAt === null)
    if (!task) return false
    const now = new Date().toISOString()
    task.deletedAt = now
    task.updatedAt = now
    return true
  })
}

/**
 * Merge tasks from another device: a remote task wins only when its updatedAt is newer than the
 * local copy (last write wins); unknown ids are added. Returns how many tasks changed.
 */
export function mergeTasks(remote: unknown[]): number {
  const valid: Task[] = []
  for (const entry of remote) {
    const parsed = TaskSchema.safeParse(normaliseTask(entry))
    if (parsed.success) valid.push(parsed.data)
  }
  if (valid.length === 0) return 0
  return mutate((tasks) => {
    let changed = 0
    for (const r of valid) {
      const i = tasks.findIndex((t) => t.id === r.id)
      if (i === -1) {
        tasks.push(r)
        changed++
      } else if (tasks[i].updatedAt < r.updatedAt) {
        tasks[i] = r
        changed++
      }
    }
    return changed
  })
}
