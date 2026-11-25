import { useRef } from 'react'
import { BALL_SIZE, DRAG_THRESHOLD_PX } from '../../shared/config'
import type { Rect } from '../../shared/layout'

interface Props {
  rect: Rect
  count: number
  onClick: () => void
  onDragStart: () => void
  onDragEnd: () => void
}

/** The floating orb. Dragging uses pointer events + IPC, never -webkit-app-region. */
export function Ball({ rect, count, onClick, onDragStart, onDragEnd }: Props): React.JSX.Element {
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null)

  // End a press, telling main to clear its drag state if a drag was under way.
  const finish = (): boolean => {
    const p = press.current
    press.current = null
    if (p?.dragging) {
      window.drift.dragEnd()
      onDragEnd()
    }
    return !!p && !p.dragging
  }

  return (
    <div
      className="absolute"
      style={{ left: rect.x, top: rect.y, width: BALL_SIZE, height: BALL_SIZE }}
    >
      <button
        type="button"
        data-zone="ball"
        data-testid="ball"
        aria-label={`drift, ${count} open ${count === 1 ? 'task' : 'tasks'}. Click to pin the list.`}
        className="relative flex h-full w-full cursor-grab items-center justify-center rounded-full border-0 bg-transparent p-0 outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-white/60"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          press.current = { x: e.screenX, y: e.screenY, dragging: false }
        }}
        onPointerMove={(e) => {
          const p = press.current
          if (!p) return
          // The button was released somewhere we never heard about: stop following the pointer.
          if (e.buttons === 0) {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
            finish()
            return
          }
          const dx = e.screenX - p.x
          const dy = e.screenY - p.y
          if (!p.dragging) {
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
            p.dragging = true
            window.drift.dragStart()
            onDragStart()
          }
          window.drift.dragMove(dx, dy)
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
          if (finish()) onClick()
        }}
        onPointerCancel={() => {
          finish()
        }}
      >
        {/* The float animation lives on the orb, so the button itself holds still. */}
        <span
          className="pointer-events-none flex h-full w-full animate-float items-center justify-center rounded-full font-display text-[17px] font-medium leading-none text-[#2b2250]"
          style={{
            background:
              'radial-gradient(circle at 32% 28%, #fff4ec 0%, #fdba9a 32%, #b8a6f2 78%, #8f86e0 100%)',
            boxShadow: '0 8px 24px rgba(143,134,224,0.35), inset 0 -4px 10px rgba(80,60,160,0.25)',
          }}
          aria-hidden="true"
        >
          {count > 0 ? count : '✓'}
        </span>
      </button>
    </div>
  )
}
