import type { Category, Status, Task } from './types'
import type { Layout } from './layout'

/** The typed bridge the preload script exposes to the renderer as window.drift. */
export interface DriftApi {
  getTasks(): Promise<Task[]>
  onTasks(cb: (tasks: Task[]) => void): () => void
  addTask(input: { title: string; category: Category }): Promise<void>
  setStatus(id: string, status: Status): Promise<void>
  deleteTask(id: string): Promise<void>
  updateTask(id: string, patch: { title?: string; category?: Category }): Promise<void>
  /** Let mouse events pass through the window (true) or be caught by it (false). */
  setIgnoreMouse(ignore: boolean): void
  getLayout(): Promise<Layout | null>
  onLayout(cb: (layout: Layout) => void): () => void
  dragStart(): void
  dragMove(dx: number, dy: number): void
  dragEnd(): void
}

export const CH = {
  getTasks: 'tasks:get',
  tasks: 'tasks:changed',
  addTask: 'tasks:add',
  setStatus: 'tasks:set-status',
  deleteTask: 'tasks:delete',
  updateTask: 'tasks:update',
  ignoreMouse: 'window:ignore-mouse',
  getLayout: 'window:get-layout',
  layout: 'window:layout',
  dragStart: 'window:drag-start',
  dragMove: 'window:drag-move',
  dragEnd: 'window:drag-end',
} as const
