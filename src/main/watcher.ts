import fs from 'node:fs'
import path from 'node:path'

/**
 * Calls onChange (debounced) whenever the data file is created, changed or
 * replaced. Watches the folder, because an atomic rename replaces the file's inode.
 */
export function watchDataFile(file: string, debounceMs: number, onChange: () => void): () => void {
  const dir = path.dirname(file)
  const name = path.basename(file)
  let timer: NodeJS.Timeout | undefined
  let watcher: fs.FSWatcher | undefined
  let retry: NodeJS.Timeout | undefined
  let closed = false

  const fire = (): void => {
    clearTimeout(timer)
    timer = setTimeout(onChange, debounceMs)
  }

  const start = (): void => {
    if (closed) return
    try {
      fs.mkdirSync(dir, { recursive: true })
      watcher = fs.watch(dir, (_event, changed) => {
        if (!changed || changed.toString() === name) fire()
      })
      watcher.on('error', () => {
        watcher?.close()
        retry = setTimeout(start, 1000)
      })
    } catch {
      retry = setTimeout(start, 1000)
    }
  }
  start()

  return () => {
    closed = true
    clearTimeout(timer)
    clearTimeout(retry)
    watcher?.close()
  }
}
