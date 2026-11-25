import { useRef, useState } from 'react'
import { MAX_TITLE_LENGTH } from '../../shared/config'
import { CATEGORIES } from '../../shared/types'
import type { Category, Status, Task } from '../../shared/types'

interface Props {
  task: Task
  onStatus: (id: string, status: Status) => void
  onDelete: (id: string) => void
  /** Rejects when the save fails, so the row can show its inline error. */
  onRename: (id: string, title: string) => Promise<void>
  onCategory: (id: string, category: Category) => void
}

const ringColor: Record<Task['category'], string> = {
  school: 'border-school',
  emails: 'border-emails',
  work: 'border-work',
  life: 'border-life',
}
const fillColor: Record<Task['category'], string> = {
  school: 'bg-school',
  emails: 'bg-emails',
  work: 'bg-work',
  life: 'bg-life',
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded-full border-0 bg-transparent p-0 text-muted outline-none hover:bg-surface2 hover:text-text focus-visible:ring-1 focus-visible:ring-white/50"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </button>
  )
}

export function TaskRow({ task, onStatus, onDelete, onRename, onCategory }: Props): React.JSX.Element {
  const done = task.status === 'completed'
  const cancelled = task.status === 'cancelled'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState(false)
  const [picking, setPicking] = useState(false)
  // Set once an edit has been saved or cancelled, so the blur that follows does not save again.
  const finished = useRef(false)
  const saving = useRef(false)

  const startEdit = (): void => {
    finished.current = false
    setDraft(task.title)
    setError(false)
    setPicking(false)
    setEditing(true)
  }
  const cancelEdit = (): void => {
    finished.current = true
    setEditing(false)
    setError(false)
  }
  const commitEdit = async (): Promise<void> => {
    if (finished.current || saving.current) return
    const title = draft.trim()
    if (!title || title === task.title) return cancelEdit()
    saving.current = true
    try {
      await onRename(task.id, title)
      finished.current = true
      setEditing(false)
      setError(false)
    } catch {
      setError(true)
    } finally {
      saving.current = false
    }
  }

  return (
    <li
      data-testid="task"
      className="group relative flex animate-fade-in items-start gap-2.5 rounded-xl px-2 py-1.5 hover:bg-surface2/70 focus-within:bg-surface2/70"
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark "${task.title}" as to-do` : `Mark "${task.title}" as completed`}
        onClick={() => onStatus(task.id, done ? 'todo' : 'completed')}
        className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] bg-transparent p-0 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/50 ${ringColor[task.category]} ${done ? fillColor[task.category] : ''}`}
      >
        {done && (
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#161616" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2.5 6.5l2.2 2.2L9.5 3.8" />
          </svg>
        )}
      </button>

      {editing ? (
        <div className="min-w-0 flex-1">
          <input
            data-testid="edit-title"
            data-edit-input
            autoFocus
            value={draft}
            maxLength={MAX_TITLE_LENGTH}
            aria-label={`Edit "${task.title}"`}
            aria-invalid={error}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              setDraft(e.target.value)
              setError(false)
            }}
            onBlur={() => void commitEdit()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitEdit()
              if (e.key === 'Escape') cancelEdit()
            }}
            className="w-full rounded-lg border border-border bg-surface2 px-1.5 py-0.5 leading-[1.45] text-text outline-none focus:border-white/30"
          />
          {error && (
            <p role="alert" data-testid="edit-error" className="m-0 pt-0.5 text-[12px] italic text-muted">
              Couldn't save that just now. Your text is still here, so try Enter again.
            </p>
          )}
        </div>
      ) : (
      <span
        onDoubleClick={startEdit}
        className={`min-w-0 flex-1 break-words leading-[1.45] [overflow-wrap:anywhere] line-clamp-3 ${done || cancelled ? 'text-muted' : 'text-text'} ${done ? 'line-through decoration-muted/60' : ''} ${cancelled ? 'italic' : ''}`}
        title={task.title}
      >
        {task.status === 'pending' && (
          <span className="mr-1.5 inline-block rounded-full bg-surface2 px-1.5 py-px align-[1px] text-[10px] text-muted">
            started
          </span>
        )}
        {task.title}
      </span>
      )}

      {!editing && (
      <span
        className={`absolute right-1 top-1 flex items-center rounded-full bg-surface2 shadow-sm transition-opacity ${picking ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100'}`}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setPicking(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && picking) {
            e.stopPropagation()
            setPicking(false)
          }
        }}
      >
        {picking ? (
          <div role="group" aria-label="Move to category" className="flex items-center">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                data-testid={`pick-${cat}`}
                title={`Move to ${cat}`}
                aria-label={`Move to ${cat}`}
                aria-current={cat === task.category}
                autoFocus={cat === task.category}
                onClick={() => {
                  setPicking(false)
                  if (cat !== task.category) onCategory(task.id, cat)
                }}
                className="flex h-6 w-6 items-center justify-center rounded-full border-0 bg-transparent p-0 outline-none hover:bg-surface2 focus-visible:ring-1 focus-visible:ring-white/50"
              >
                <span className={`h-3 w-3 rounded-full ${fillColor[cat]} ${cat === task.category ? 'ring-1 ring-white/60 ring-offset-1 ring-offset-surface2' : ''}`} />
              </button>
            ))}
          </div>
        ) : (
          <>
        <IconButton label="Rename" onClick={startEdit}>
          <path d="M10.5 3.5l2 2L6 12l-2.8.8L4 10z" />
        </IconButton>
        <button
          type="button"
          data-testid="change-category"
          title="Change category"
          aria-label="Change category"
          aria-haspopup="true"
          onClick={() => setPicking(true)}
          className="flex h-6 w-6 items-center justify-center rounded-full border-0 bg-transparent p-0 outline-none hover:bg-surface2 focus-visible:ring-1 focus-visible:ring-white/50"
        >
          <span className={`h-3 w-3 rounded-full ${fillColor[task.category]}`} />
        </button>
        {task.status !== 'pending' && !done && !cancelled && (
          <IconButton label="Move to Pending" onClick={() => onStatus(task.id, 'pending')}>
            <circle cx="8" cy="8" r="5.5" />
            <path d="M8 5v3.2l2 1.2" />
          </IconButton>
        )}
        {(task.status === 'pending' || cancelled) && (
          <IconButton label="Back to To-do" onClick={() => onStatus(task.id, 'todo')}>
            <path d="M3 8h9M8.5 4L12.5 8l-4 4" />
          </IconButton>
        )}
        {!cancelled && (
          <IconButton label="Move to Cancelled" onClick={() => onStatus(task.id, 'cancelled')}>
            <path d="M4 4l8 8M12 4l-8 8" />
          </IconButton>
        )}
        <IconButton label="Delete" onClick={() => onDelete(task.id)}>
          <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8h5.8l.6-8" />
        </IconButton>
          </>
        )}
      </span>
      )}
    </li>
  )
}
