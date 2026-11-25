# drift

A small floating ball on the Windows desktop that holds my to-do list, so checking it never means opening another app.

- Hover the ball to peek at the list; pin it to keep the panel open.
- Tabs: To-do, Pending (started, not finished), Completed, Cancelled.
- Tasks grouped by category: school, emails, work, life.
- Fades to see-through when idle, and clicks pass through to the window underneath.
- Claude (desktop app or Claude Code) can add tasks through a local connector.

Everything is saved in one file on this laptop. No accounts, no cloud.

Status: version 1 (ball, panel and saving) and the Claude connector are built.

## Run it

You need Node 24 on Windows 11.

    npm install
    npm run dev

A soft orb appears near the bottom-right corner of your screen. There is no taskbar button. To quit or hide it, right-click the tray icon (near the clock) and choose Quit or Show/Hide.

## Build an app you can double-click

    npm run dist

This makes `release\win-arm64-unpacked\drift.exe` (starts in about 2 seconds) and `release\drift-1.0.0-portable.exe` (a single file, but it unpacks about 100 MB on every start, so it takes 30 seconds or more). Use `drift.exe`. It is not signed, so Windows may show a "protect your PC" warning the first time; choose More info, then Run anyway.

drift starts at login, pointing at whichever copy you last opened by double-clicking. Open it yourself from File Explorer, not from a terminal inside Claude: Claude's sandbox keeps that setting from reaching Windows. Running from `npm run dev` never registers it.

## Using it

- Hover the orb and the panel opens beside it, toward the middle of the screen. Move away and it closes.
- Click the orb, or the pin in the panel, to keep the panel open. Click again to let it close.
- Drag the orb anywhere. It remembers where you left it and moves back on screen if a monitor goes away.
- The number on the orb is how many things are to-do or pending.
- Tick the circle to finish a task; tick it again to put it back on the to-do list. Hover a task for buttons to move it to Pending, Cancelled, back to To-do, or delete it.
- Double-click a task's title (or use the pencil button) to rename it. The title is selected; Enter or clicking away saves, Escape cancels, and an empty title cancels rather than deleting. The panel stays open while you type.
- Hover a task and click the coloured dot to move it to another category: pick school, emails, work or life.
- Type in a category's "add new item" box and press Enter.
- While a fullscreen app (slideshow, video, game) is in front on the same screen as the orb, drift hides itself and comes back when you leave fullscreen. If you hid drift from the tray, it stays hidden.
- After a few quiet seconds the orb and panel fade almost away and stop catching the mouse. A faded panel never blocks clicks. Hover the orb to wake everything. The orb itself still catches the mouse so you can hover it.

## Where tasks live

`%USERPROFILE%\.drift\tasks.json`. Edits made to that file by another program show up in the panel within a moment. The window position is kept beside it in `settings.json`. Deleted tasks are only marked deleted in the file, never erased. If the file ever gets damaged it is renamed to `tasks.corrupt-<time>.json` and drift starts with an empty list, so nothing is overwritten.

To use a different file (handy for trying things out), set `DRIFT_DATA_FILE` to its path before starting.

## Let Claude add tasks

drift comes with a small connector that lets Claude add tasks to your list. Say "add book Friday dinner to my to-do" and it appears in the panel a moment later, with no restart. It runs on this laptop only and reads and writes the same `tasks.json` as the app.

Claude can add tasks, list them, and change a task's status (to-do, pending, completed, cancelled). It cannot delete anything.

First build it once (this also runs as part of `npm run build`):

    npm install
    npm run build:mcp

That makes `out\mcp\drift-mcp.mjs` inside your drift folder (for example `C:\Users\you\drift\out\mcp\drift-mcp.mjs`). Claude runs exactly that file, and it is a build output, not part of the source. After switching branches, cleaning, or a fresh clone, run `npm run build` again, or Claude loses the drift tools. Re-run it after you change the code too. It needs only Node, not the drift app.

### Claude desktop app

1. In Claude, open Settings, then Developer, then Edit Config. This opens the folder holding `claude_desktop_config.json`. Because Claude is a Microsoft Store install, that file lives under `%LOCALAPPDATA%\Packages\Claude_...\LocalCache\Roaming\Claude\`; Edit Config takes you there, so you don't have to find it.
2. Add a `drift` entry under `mcpServers` (keep anything already there):

```json
{
  "mcpServers": {
    "drift": {
      "command": "node",
      "args": ["C:\\Users\\you\\drift\\out\\mcp\\drift-mcp.mjs"]
    }
  }
}
```

3. Fully quit Claude (right-click its tray icon and choose Quit, not just close the window) and open it again.

### Claude Code

    claude mcp add --scope user drift -- node C:\Users\you\drift\out\mcp\drift-mcp.mjs

### Things to try

- "Add book Friday dinner to my to-do."
- "Put 'reply to the landlord' on my to-do under emails."
- "What's on my to-do list for work?"
- "Mark the Friday dinner task done."
- "Move the school tasks I started to pending."

To point the connector at a different file (for trying it out), set `DRIFT_DATA_FILE` in the entry's `env`, the same as for the app.

## For developers

See `AGENTS.md` for the layout and the checks (`npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run build`).
