import { FADE_TRANSITION_MS, OPACITY_ACTIVE, OPACITY_IDLE } from '../../shared/config'
import { Ball } from './Ball'
import { useLayout, useShell, useTasks } from './hooks'
import { Panel } from './Panel'

export default function App(): React.JSX.Element | null {
  const tasks = useTasks()
  const layout = useLayout()
  const shell = useShell()

  if (!layout) return null
  const openCount = tasks.filter((t) => t.status === 'todo' || t.status === 'pending').length

  return (
    <div
      data-testid="shell"
      className="relative h-full w-full"
      style={{
        opacity: shell.faded ? OPACITY_IDLE : OPACITY_ACTIVE,
        transition: `opacity ${FADE_TRANSITION_MS}ms ease-in-out`,
      }}
    >
      <Panel
        rect={layout.panel}
        side={layout.side}
        open={shell.open}
        faded={shell.faded}
        pinned={shell.pinned}
        tasks={tasks}
        onTogglePin={shell.togglePin}
      />
      <Ball
        rect={layout.ball}
        count={openCount}
        onClick={shell.ballClicked}
        onDragStart={shell.dragStarted}
        onDragEnd={shell.dragEnded}
      />
    </div>
  )
}
