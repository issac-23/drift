import { useCallback, useEffect, useRef, useState } from 'react'
import { CLOSE_DELAY_MS, IDLE_FADE_MS, OPEN_DELAY_MS } from '../../shared/config'
import type { Layout } from '../../shared/layout'
import type { Task } from '../../shared/types'

export function useTasks(): Task[] {
  const [tasks, setTasks] = useState<Task[]>([])
  useEffect(() => {
    let alive = true
    void window.drift.getTasks().then((t) => alive && setTasks(t))
    const off = window.drift.onTasks(setTasks)
    return () => {
      alive = false
      off()
    }
  }, [])
  return tasks
}

export function useLayout(): Layout | null {
  const [layout, setLayout] = useState<Layout | null>(null)
  useEffect(() => {
    let alive = true
    void window.drift.getLayout().then((l) => alive && l && setLayout(l))
    const off = window.drift.onLayout(setLayout)
    return () => {
      alive = false
      off()
    }
  }, [])
  return layout
}

export type Zone = 'ball' | 'panel' | null

/**
 * True while a title edit input has focus, or a rename failed and its error is showing:
 * the panel must neither close nor fade then.
 */
function isEditing(): boolean {
  return !!document.activeElement?.matches('[data-edit-input]') || !!document.querySelector('[data-testid="edit-error"]')
}

export interface Shell {
  open: boolean
  pinned: boolean
  faded: boolean
  togglePin: () => void
  /** The ball was clicked (not dragged). */
  ballClicked: () => void
  dragStarted: () => void
  dragEnded: () => void
}

/**
 * Hover, open/close, pin and idle-fade behaviour. Elements opt in as hit areas
 * with data-zone="ball" or data-zone="panel"; everywhere else the window is
 * click-through (the main process is told whenever that changes).
 */
export function useShell(): Shell {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [faded, setFaded] = useState(false)

  const zone = useRef<Zone>(null)
  const pinnedRef = useRef(false)
  const openRef = useRef(false)
  const dragging = useRef(false)
  // After a click or drag the panel should not pop open until the pointer leaves and returns.
  const suppressOpen = useRef(false)
  const openTimer = useRef<number>(undefined)
  const closeTimer = useRef<number>(undefined)
  const idleTimer = useRef<number>(undefined)

  const setOpenBoth = useCallback((v: boolean) => {
    openRef.current = v
    setOpen(v)
  }, [])

  const touch = useCallback(() => {
    window.clearTimeout(idleTimer.current)
    setFaded(false)
    idleTimer.current = window.setTimeout(() => {
      if (zone.current === null && !isEditing()) setFaded(true)
    }, IDLE_FADE_MS)
  }, [])

  const scheduleClose = useCallback(() => {
    window.clearTimeout(closeTimer.current)
    if (!openRef.current || pinnedRef.current) return
    closeTimer.current = window.setTimeout(() => {
      if (zone.current === null && !pinnedRef.current && !isEditing()) setOpenBoth(false)
    }, CLOSE_DELAY_MS)
  }, [setOpenBoth])

  const enterZone = useCallback(
    (next: Zone) => {
      // While the orb is being dragged the window can lag the pointer, so leave/enter events
      // are unreliable: never go click-through mid-drag. The next move after release resyncs.
      if (dragging.current) return
      const prev = zone.current
      zone.current = next
      if (prev === next) return
      window.drift.setIgnoreMouse(next === null)
      touch()
      if (next === null) {
        suppressOpen.current = false
        window.clearTimeout(openTimer.current)
        scheduleClose()
        return
      }
      window.clearTimeout(closeTimer.current)
      if (next === 'ball' && !openRef.current && !suppressOpen.current && !dragging.current) {
        window.clearTimeout(openTimer.current)
        openTimer.current = window.setTimeout(() => {
          if (zone.current !== null && !dragging.current) setOpenBoth(true)
        }, OPEN_DELAY_MS)
      }
    },
    [scheduleClose, setOpenBoth, touch],
  )

  useEffect(() => {
    const onMove = (e: PointerEvent | MouseEvent): void => {
      const el = (e.target as Element | null)?.closest?.('[data-zone]')
      const z = (el?.getAttribute('data-zone') as Zone | null) ?? null
      enterZone(z)
      if (z) touch()
    }
    const onLeave = (): void => enterZone(null)
    const onActivity = (): void => touch()
    window.addEventListener('pointermove', onMove)
    window.addEventListener('mousemove', onMove)
    document.addEventListener('mouseleave', onLeave)
    window.addEventListener('keydown', onActivity)
    // Leaving an edit input restarts the idle and close clocks that were held back while it had focus.
    const onFocusOut = (e: FocusEvent): void => {
      if (!(e.target as Element | null)?.matches?.('[data-edit-input]')) return
      touch()
      scheduleClose()
    }
    document.addEventListener('focusout', onFocusOut)
    touch() // start the idle clock so the ball fades even if never hovered
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
      window.removeEventListener('keydown', onActivity)
      document.removeEventListener('focusout', onFocusOut)
      window.clearTimeout(openTimer.current)
      window.clearTimeout(closeTimer.current)
      window.clearTimeout(idleTimer.current)
    }
  }, [enterZone, scheduleClose, touch])

  const setPin = useCallback(
    (v: boolean) => {
      pinnedRef.current = v
      setPinned(v)
      if (v) {
        window.clearTimeout(closeTimer.current)
        setOpenBoth(true)
      } else {
        scheduleClose()
      }
    },
    [scheduleClose, setOpenBoth],
  )

  return {
    open,
    pinned,
    faded,
    togglePin: () => setPin(!pinnedRef.current),
    ballClicked: () => {
      suppressOpen.current = true
      setPin(!pinnedRef.current)
    },
    dragStarted: () => {
      dragging.current = true
      suppressOpen.current = true
      window.clearTimeout(openTimer.current)
      window.clearTimeout(closeTimer.current)
      setOpenBoth(false)
    },
    dragEnded: () => {
      dragging.current = false
      if (pinnedRef.current) setOpenBoth(true)
      touch()
    },
  }
}
