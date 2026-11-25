# AGENTS.md

drift is an Electron + Vite + React + TypeScript + Tailwind desktop app for Windows 11. Node 24, npm.

## Layout

- `src/shared/` holds code used by more than one process. `store.ts` is the task store and must stay free of Electron imports, so a plain Node process (the MCP connector) can import it. `config.ts` holds every tunable number (sizes, delays, fade opacity).
- `src/main/` is the Electron main process, `src/preload/` the typed bridge, `src/renderer/` the React UI.
- Hiding for fullscreen apps: `src/shared/fullscreen.ts` is the pure decision (unit-tested); `src/main/fullscreen.ts` polls the foreground window via `koffi` (Win32, prebuilt binary, unpacked from asar by `asarUnpack` in `electron-builder.yml`) and turns itself off if koffi fails to load. `index.ts` keeps "hidden by user" and "hidden for fullscreen" separate. `DRIFT_DEBUG_FULLSCREEN=1` logs watcher events to the console and to `drift-fullscreen.log` beside `DRIFT_DATA_FILE`.
- `src/mcp/server.ts` is the stdio MCP connector (tools `add_task`, `list_tasks`, `set_task_status`; no delete). `scripts/build-mcp.mjs` bundles it with esbuild, SDK and zod included, into `out/mcp/drift-mcp.mjs`, which runs with plain `node` and no Electron.
- `tests/` has the vitest unit tests, `e2e/` the Playwright Electron test.

## Install

    npm install

## Run in dev

    npm run dev

The ball appears at the bottom-right of the main display. Quit from the tray icon (there is no taskbar entry). To keep dev data away from your real tasks, set `DRIFT_DATA_FILE` first, for example `$env:DRIFT_DATA_FILE = "$env:TEMP\drift-dev\tasks.json"` in PowerShell.

## Checks

    npm run typecheck    # tsc over the node side and the renderer
    npm test             # vitest unit tests (store, lock, layout, MCP round trip)
    npm run test:e2e     # builds (app and connector), then launches the real app with Playwright
    npm run build        # electron-vite production build into out/, then build:mcp
    npm run build:mcp    # only the connector bundle, out/mcp/drift-mcp.mjs
    npm run dist         # build, then a portable Windows exe in release/ (unsigned)

`test:e2e` opens the real window on screen for a few seconds and uses a temp data file through `DRIFT_DATA_FILE`, so it never touches your tasks. `npm test` builds the connector itself before the MCP round-trip test, which spawns it with `DRIFT_DATA_FILE` set to a temp file. It can run while the installed drift is running.

## Data file

`DRIFT_DATA_FILE` if set, otherwise `%USERPROFILE%\.drift\tasks.json`. Shape: `{ "version": 1, "tasks": Task[] }`. Always go through `src/shared/store.ts`: every write takes a cross-process lock (`tasks.json.lock`, created exclusively, retried with short backoff, taken over when older than 5 s), re-reads, writes a temp file and renames it, soft-deletes, and moves a corrupt file aside as `tasks.corrupt-<timestamp>.json`. The app watches the file and updates live.

## Conventions

- Balance and timing numbers go in `src/shared/config.ts`, not in components.
- Validate every IPC argument in `src/main/index.ts`.
- Do not use `-webkit-app-region`; dragging is pointer events plus IPC.
- No attribution lines for tools or assistants in commits, code or docs.
