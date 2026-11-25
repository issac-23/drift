import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MAX_TITLE_LENGTH, NOTICE_MS } from '../../shared/config'
import type { Rect, Side } from '../../shared/layout'
import { CATEGORIES, STATUSES } from '../../shared/types'
import type { Category, Status, Task } from '../../shared/types'
import { TaskRow } from './TaskRow'

const TAB_LABEL: Record<Status, string> = {
  todo: 'To-do',
  pending: 'Pending',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const EMPTY_COPY: Record<Status, string> = {
  todo: 'Nothing floating here. Add something below.',
  pending: 'Nothing under way. Start something and it will drift in here.',
  completed: 'No finished things yet. They will gather here.',
  cancelled: 'Nothing let go of. That is fine too.',
}

const DOT: Record<Category, string> = {
  school: 'bg-school',
  emails: 'bg-emails',
  work: 'bg-work',
  life: 'bg-life',
}

interface Props {
  rect: Rect
  side: Side
  open: boolean
  faded: boolean
  pinned: boolean
  tasks: Task[]
  onTogglePin: () => void
}

function AddBox({ category }: { category: Category }): React.JSX.Element {
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)
  const submit = async (): Promise<void> => {
    const title = value.trim()
    if (!title) return
    setValue('')
    setError(false)
    try {
      await window.drift.addTask({ title, category })
    } catch {
      // Give the text back, unless they have already started typing something else.
      setValue((current) => (current === '' ? title : current))
      setError(true)
    }
  }
  return (
    <>
    <input
      data-testid={`add-${category}`}
      value={value}
      maxLength={MAX_TITLE_LENGTH}
      placeholder="add new item"
      aria-label={`Add new ${category} item`}
      aria-invalid={error}
      onChange={(e) => {
        setValue(e.target.value)
        setError(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void submit()
        if (e.key === 'Escape') e.currentTarget.blur()
      }}
      className="mt-0.5 w-full rounded-xl border border-transparent bg-transparent px-2 py-1.5 text-text outline-none placeholder:text-muted/70 hover:bg-surface2/50 focus:border-border focus:bg-surface2"
    />
    {error && (
      <p role="alert" data-testid={`add-error-${category}`} className="m-0 px-2 pb-1 text-[12px] italic text-muted">
        Couldn't save that just now. Your text is still here, so try Enter again.
      </p>
    )}
    </>
  )
}

export function Panel({ rect, side, open, faded, pinned, tasks, onTogglePin }: Props): React.JSX.Element {
  const [tab, setTab] = useState<Status>('todo')

  const counts = useMemo(() => {
    const c: Record<Status, number> = { todo: 0, pending: 0, completed: 0, cancelled: 0 }
    for (const t of tasks) c[t.status]++
    return c
  }, [tasks])

  const inTab = tasks.filter((t) => t.status === tab)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(noticeTimer.current), [])
  const attempt = useCallback((action: Promise<void>, message: string): void => {
    action.catch(() => {
      setNotice(message)
      window.clearTimeout(noticeTimer.current)
      noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS)
    })
  }, [])
  const setStatus = (id: string, status: Status): void =>
    attempt(window.drift.setStatus(id, status), "Couldn't update that task just now. Try again in a moment.")
  const rename = (id: string, title: string): Promise<void> => window.drift.updateTask(id, { title })
  const setCategory = (id: string, category: Category): void =>
    attempt(window.drift.updateTask(id, { category }), "Couldn't move that task just now. Try again in a moment.")
  const remove = (id: string): void =>
    attempt(window.drift.deleteTask(id), "Couldn't delete that task just now. Try again in a moment.")

  // Only a visible, awake panel catches the mouse; a faded one stays click-through.
  const hit = open && !faded

  return (
    <section
      data-testid="panel"
      data-zone={hit ? 'panel' : undefined}
      aria-hidden={!open}
      className="absolute flex flex-col overflow-hidden rounded-[24px] border border-border bg-surface/[0.97]"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        opacity: open ? 1 : 0,
        visibility: open ? 'visible' : 'hidden',
        transform: open ? 'scale(1)' : 'scale(0.94)',
        transformOrigin: side === 'right' ? 'left center' : 'right center',
        transition: `opacity 180ms ease-out, transform 180ms ease-out, visibility 0s linear ${open ? '0s' : '180ms'}`,
        boxShadow: '0 18px 48px rgba(0,0,0,0.5)',
        pointerEvents: hit ? 'auto' : 'none',
      }}
    >
      <header className="flex items-center justify-between px-5 pt-4">
        <h1 className="m-0 font-display text-[22px] font-medium italic leading-none tracking-tight text-text">drift</h1>
        <button
          type="button"
          data-testid="pin"
          aria-pressed={pinned}
          aria-label={pinned ? 'Unpin panel' : 'Pin panel open'}
          title={pinned ? 'Unpin' : 'Keep open'}
          onClick={onTogglePin}
          className={`flex h-7 w-7 items-center justify-center rounded-full border-0 p-0 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/50 ${pinned ? 'bg-text text-surface' : 'bg-transparent text-muted hover:bg-surface2 hover:text-text'}`}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9.5 2.5l4 4-2 .8-2 2.6.2 2.6-1 .9-2.6-2.6-3.4 3.4M5.5 7l-1.2.1-.9-1 2.6-1.9 2.8-.3" />
          </svg>
        </button>
      </header>

      <nav role="tablist" aria-label="Task lists" className="mx-4 mt-3 flex gap-1 rounded-full bg-bg p-1">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            data-testid={`tab-${s}`}
            aria-selected={tab === s}
            onClick={() => setTab(s)}
            className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded-full border-0 px-0.5 py-1.5 text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/50 ${tab === s ? 'bg-surface2 text-text' : 'bg-transparent text-muted hover:text-text'}`}
          >
            <span className="truncate">{TAB_LABEL[s]}</span>
            <span data-testid={`count-${s}`} className="text-[10px] tabular-nums opacity-70">
              {counts[s]}
            </span>
          </button>
        ))}
      </nav>

      <div role="tabpanel" className="no-scrollbar mt-2 flex-1 overflow-y-auto px-3 pb-4">
        {inTab.length === 0 && tab !== 'todo' ? (
          <p data-testid="empty" className="mx-4 mt-10 text-center font-display text-[15px] italic leading-snug text-muted">
            {EMPTY_COPY[tab]}
          </p>
        ) : (
          CATEGORIES.map((cat) => {
            const rows = inTab.filter((t) => t.category === cat)
            if (rows.length === 0 && tab !== 'todo') return null
            return (
              <div key={cat} data-testid={`group-${cat}`} className="mt-3">
                <h2 className="m-0 flex items-center gap-2 px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                  <span className={`h-2 w-2 rounded-full ${DOT[cat]}`} />
                  {cat}
                  <span className="font-normal normal-case tracking-normal opacity-60">{rows.length || ''}</span>
                </h2>
                <ul className="m-0 list-none p-0">
                  {rows.map((t) => (
                    <TaskRow key={t.id} task={t} onStatus={setStatus} onDelete={remove} onRename={rename} onCategory={setCategory} />
                  ))}
                </ul>
                {tab === 'todo' && rows.length === 0 && (
                  <p className="m-0 px-2 pb-0.5 text-[12px] italic text-muted/60">nothing here yet</p>
                )}
                {tab === 'todo' && <AddBox category={cat} />}
              </div>
            )
          })
        )}
      </div>
      {notice && (
        <p
          role="status"
          data-testid="notice"
          className="m-0 mx-4 mb-3 rounded-full bg-surface2 px-3 py-1.5 text-center text-[12px] italic text-muted"
        >
          {notice}
        </p>
      )}
    </section>
  )
}
