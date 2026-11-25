export const CATEGORIES = ['school', 'emails', 'work', 'life'] as const
export const STATUSES = ['todo', 'pending', 'completed', 'cancelled'] as const

export type Category = (typeof CATEGORIES)[number]
export type Status = (typeof STATUSES)[number]

export interface Task {
  id: string
  title: string
  category: Category
  status: Status
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface TaskFile {
  version: 1
  tasks: Task[]
}
