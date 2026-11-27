// Cloud sync with tend. No Electron imports, so it can be tested in plain Node.
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { getDataFile, loadTasks, mergeTasks } from './store'
import type { Task } from './types'

const ConfigSchema = z.object({ url: z.string().url(), token: z.string().min(1) })
export type SyncConfig = z.infer<typeof ConfigSchema>

/** `DRIFT_SYNC_URL` + `DRIFT_SYNC_TOKEN`, or `sync.json` beside the data file. Null when unset. */
export function readSyncConfig(): SyncConfig | null {
  const url = process.env.DRIFT_SYNC_URL
  const token = process.env.DRIFT_SYNC_TOKEN
  if (url && token) {
    const p = ConfigSchema.safeParse({ url, token })
    return p.success ? p.data : null
  }
  try {
    const raw = fs.readFileSync(path.join(path.dirname(getDataFile()), 'sync.json'), 'utf8')
    const p = ConfigSchema.safeParse(JSON.parse(raw))
    return p.success ? p.data : null
  } catch {
    return null
  }
}

function statePath(): string {
  return path.join(path.dirname(getDataFile()), 'sync-state.json')
}

function readSince(): string {
  try {
    const s = JSON.parse(fs.readFileSync(statePath(), 'utf8')) as { since?: unknown }
    return typeof s.since === 'string' ? s.since : ''
  } catch {
    return ''
  }
}

function writeSince(since: string): void {
  fs.writeFileSync(statePath(), JSON.stringify({ since }), 'utf8')
}

export interface SyncResult {
  ok: boolean
  /** Tasks changed in the local file by this sync. */
  pulled: number
  pushed: number
  error?: string
}

/** Pull what changed in the cloud, merge it, then push what changed here. */
export async function syncOnce(
  cfg: SyncConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<SyncResult> {
  const base = cfg.url.replace(/\/+$/, '')
  const headers = { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' }
  try {
    const since = readSince()
    const r = await fetchImpl(`${base}/api/tasks?since=${encodeURIComponent(since)}`, { headers })
    if (!r.ok) return { ok: false, pulled: 0, pushed: 0, error: `pull failed (${r.status})` }
    const body = (await r.json()) as { tasks?: Task[]; now?: string }
    const remote = Array.isArray(body.tasks) ? body.tasks : []
    const pulled = mergeTasks(remote)

    // Don't echo back what we just received.
    const remoteStamp = new Map(remote.map((t) => [t.id, t.updatedAt]))
    const dirty = loadTasks({ includeDeleted: true }).filter(
      (t) => t.updatedAt > since && remoteStamp.get(t.id) !== t.updatedAt,
    )
    if (dirty.length > 0) {
      const p = await fetchImpl(`${base}/api/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tasks: dirty }),
      })
      if (!p.ok) return { ok: false, pulled, pushed: 0, error: `push failed (${p.status})` }
    }
    if (typeof body.now === 'string') writeSince(body.now)
    return { ok: true, pulled, pushed: dirty.length }
  } catch (err) {
    return { ok: false, pulled: 0, pushed: 0, error: (err as Error).message }
  }
}
