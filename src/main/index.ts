import path from 'node:path'
import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron'
import {
  BALL_SIZE,
  DEFAULT_MARGIN,
  MAX_TITLE_LENGTH,
  POSITION_SAVE_DEBOUNCE_MS,
  RENDERER_CRASH_WINDOW_MS,
  RENDERER_MAX_RELOADS,
  RENDERER_RELOAD_DELAY_MS,
  READ_RETRY_DELAYS_MS,
  WATCH_DEBOUNCE_MS,
  WINDOW_HEIGHT,
  WINDOW_WIDTH,
} from '../shared/config'
import { CH } from '../shared/ipc'
import { clampBall, computeLayout } from '../shared/layout'
import type { Layout, Point, Rect } from '../shared/layout'
import { addTask, CATEGORIES, deleteTask, getDataFile, loadTasks, setStatus, STATUSES, updateTask } from '../shared/store'
import type { Category, Status, Task } from '../shared/types'
import { readSettings, writeSettings } from './settings'
import { startFullscreenWatcher } from './fullscreen'
import { watchDataFile } from './watcher'

const dataFile = getDataFile()
const settingsFile = path.join(path.dirname(dataFile), 'settings.json')

// A custom data file means a test or side-by-side run: keep it from sharing the
// single-instance lock (which is keyed by the user-data folder) with the real app.
if (process.env.DRIFT_DATA_FILE) {
  app.setPath('userData', path.join(path.dirname(dataFile), 'electron-user-data'))
}

let win: BrowserWindow | null = null
let tray: Tray | null = null
let ball: Point = { x: 0, y: 0 }
let layout: Layout | null = null
let dragStartBall: Point | null = null
let lastTasksJson = ''
let lastTasks: Task[] = []
let retryTimer: NodeJS.Timeout | undefined
let saveTimer: NodeJS.Timeout | undefined
let quitting = false
let crashTimes: number[] = []
// Why the window may be hidden: the user chose Hide in the tray, or a fullscreen app is in front.
// Kept apart so leaving fullscreen never shows a window the user hid.
let userHidden = false
let fullscreenHidden = false
let stopFullscreenWatch: (() => void) | null = null

const resourcePath = (name: string): string => path.join(app.getAppPath(), 'resources', name)

function workAreaFor(p: Point): Rect {
  return screen.getDisplayNearestPoint({
    x: Math.round(p.x + BALL_SIZE / 2),
    y: Math.round(p.y + BALL_SIZE / 2),
  }).workArea
}

function defaultBall(): Point {
  const wa = screen.getPrimaryDisplay().workArea
  return {
    x: wa.x + wa.width - BALL_SIZE - DEFAULT_MARGIN,
    y: wa.y + wa.height - BALL_SIZE - DEFAULT_MARGIN,
  }
}

function applyBounds(x: number, y: number): void {
  // Always give the full size: on scaled displays a bare setPosition can nudge the size.
  win?.setBounds({ x: Math.round(x), y: Math.round(y), width: WINDOW_WIDTH, height: WINDOW_HEIGHT })
}

/** Clamp the ball onto a visible display, then place the window and tell the renderer. */
function relayout(): void {
  if (!win || win.isDestroyed()) return
  ball = clampBall(ball, workAreaFor(ball))
  layout = computeLayout(ball, workAreaFor(ball))
  applyBounds(layout.window.x, layout.window.y)
  win.webContents.send(CH.layout, layout)
}

function scheduleSave(): void {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => writeSettings(settingsFile, { ball }), POSITION_SAVE_DEBOUNCE_MS)
}

/** Read the list; on a transient read error (EBUSY/EPERM from a scanner or sync client) keep the last good one. */
function readTasksSafe(): Task[] | null {
  try {
    return loadTasks()
  } catch {
    return null
  }
}

function pushTasks(force = false, attempt = 0): void {
  if (!win || win.isDestroyed()) return
  clearTimeout(retryTimer)
  const tasks = readTasksSafe()
  if (!tasks) {
    const delay = READ_RETRY_DELAYS_MS[attempt]
    if (delay !== undefined) retryTimer = setTimeout(() => pushTasks(force, attempt + 1), delay)
    return
  }
  lastTasks = tasks
  const json = JSON.stringify(tasks)
  if (!force && json === lastTasksJson) return
  lastTasksJson = json
  win.webContents.send(CH.tasks, tasks)
}

function createWindow(): void {
  win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    title: 'drift',
    icon: resourcePath('icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setMenu(null)
  // Click-through until the renderer reports the pointer is over the ball or panel.
  win.setIgnoreMouseEvents(true, { forward: true })

  // The renderer must never navigate away or open other windows.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  win.once('ready-to-show', () => {
    relayout()
    pushTasks(true)
    applyVisibility()
  })
  win.on('closed', () => {
    win = null
  })
  // A crashed page leaves a transparent window that shows nothing, so reload it.
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit' || quitting) return
    // The new page starts with no zone, so make the window click-through again
    // and drop any drag that was under way.
    win?.setIgnoreMouseEvents(true, { forward: true })
    dragStartBall = null
    const now = Date.now()
    crashTimes = crashTimes.filter((t) => now - t < RENDERER_CRASH_WINDOW_MS)
    crashTimes.push(now)
    if (crashTimes.length > RENDERER_MAX_RELOADS) {
      console.error(`renderer gone (${details.reason}); too many crashes, not reloading`)
      return
    }
    console.error(`renderer gone (${details.reason}), reloading`)
    lastTasksJson = ''
    setTimeout(() => win?.webContents.reload(), RENDERER_RELOAD_DELAY_MS * crashTimes.length)
  })
  win.webContents.on('did-finish-load', () => {
    if (!layout) return
    win?.webContents.send(CH.layout, layout)
    pushTasks(true)
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

/** Show or hide the window from the two reasons it may be hidden. Never takes focus. */
function applyVisibility(): void {
  if (!win || win.isDestroyed()) return
  const shouldShow = !userHidden && !fullscreenHidden
  if (shouldShow && !win.isVisible()) {
    win.showInactive()
    win.setAlwaysOnTop(true, 'screen-saver')
  } else if (!shouldShow && win.isVisible()) {
    win.hide()
  }
}

/** Tray Show/Hide acts on what is on screen: an explicit Show also overrides fullscreen hiding. */
function toggleVisible(): void {
  if (!win || win.isDestroyed()) return
  if (win.isVisible()) {
    userHidden = true
  } else {
    userHidden = false
    fullscreenHidden = false
  }
  applyVisibility()
}

function startWatchingFullscreen(): void {
  stopFullscreenWatch = startFullscreenWatcher(
    () => {
      if (!win || win.isDestroyed()) return null
      const h = win.getNativeWindowHandle()
      return h.length >= 8 ? h.readBigUInt64LE(0) : BigInt(h.readUInt32LE(0))
    },
    (fullscreen) => {
      fullscreenHidden = fullscreen
      applyVisibility()
    },
  )
}

/** Tray "Reload": clears the crash count, so it also works after automatic reloads gave up. */
function reloadPage(): void {
  if (!win || win.isDestroyed()) return
  crashTimes = []
  win.setIgnoreMouseEvents(true, { forward: true })
  dragStartBall = null
  lastTasksJson = ''
  userHidden = false
  applyVisibility()
  win.webContents.reload()
}

function createTray(): void {
  tray = new Tray(nativeImage.createFromPath(resourcePath('tray.png')))
  tray.setToolTip('drift')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show/Hide', click: toggleVisible },
      { label: 'Reload', click: reloadPage },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ]),
  )
  tray.on('click', toggleVisible)
}

// ---- IPC: every argument is validated here, whatever the renderer sends ----

const fromWindow = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean =>
  !!win && e.sender === win.webContents

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 100
const isCategory = (v: unknown): v is Category =>
  typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v)
const isStatus = (v: unknown): v is Status =>
  typeof v === 'string' && (STATUSES as readonly string[]).includes(v)
const isDelta = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 100000

function registerIpc(): void {
  ipcMain.handle(CH.getTasks, (e): Task[] => (fromWindow(e) ? (readTasksSafe() ?? lastTasks) : []))
  ipcMain.handle(CH.getLayout, (e) => (fromWindow(e) ? layout : null))

  ipcMain.handle(CH.addTask, (e, input: unknown) => {
    if (!fromWindow(e)) return
    const i = input as { title?: unknown; category?: unknown } | null
    if (!i || typeof i.title !== 'string' || !isCategory(i.category)) throw new Error('invalid task')
    addTask({ title: i.title, category: i.category })
    pushTasks()
  })
  ipcMain.handle(CH.setStatus, (e, id: unknown, status: unknown) => {
    if (!fromWindow(e)) return
    if (!isId(id) || !isStatus(status)) throw new Error('invalid status change')
    setStatus(id, status)
    pushTasks()
  })
  ipcMain.handle(CH.updateTask, (e, id: unknown, patch: unknown) => {
    if (!fromWindow(e)) return
    if (!isId(id) || typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      throw new Error('invalid update')
    }
    const keys = Object.keys(patch)
    if (keys.length === 0 || keys.some((k) => k !== 'title' && k !== 'category')) throw new Error('invalid update')
    const p = patch as { title?: unknown; category?: unknown }
    const next: { title?: string; category?: Category } = {}
    if ('title' in p) {
      if (typeof p.title !== 'string' || !p.title.trim() || p.title.trim().length > MAX_TITLE_LENGTH) {
        throw new Error('invalid title')
      }
      next.title = p.title
    }
    if ('category' in p) {
      if (!isCategory(p.category)) throw new Error('invalid category')
      next.category = p.category
    }
    if (!updateTask(id, next)) throw new Error('task not found')
    pushTasks()
  })
  ipcMain.handle(CH.deleteTask, (e, id: unknown) => {
    if (!fromWindow(e)) return
    if (!isId(id)) throw new Error('invalid id')
    deleteTask(id)
    pushTasks()
  })

  ipcMain.on(CH.ignoreMouse, (e, ignore: unknown) => {
    if (!fromWindow(e) || typeof ignore !== 'boolean') return
    if (ignore) win?.setIgnoreMouseEvents(true, { forward: true })
    else win?.setIgnoreMouseEvents(false)
  })

  ipcMain.on(CH.dragStart, (e) => {
    if (fromWindow(e)) dragStartBall = { ...ball }
  })
  ipcMain.on(CH.dragMove, (e, dx: unknown, dy: unknown) => {
    if (!fromWindow(e) || !dragStartBall || !layout || !isDelta(dx) || !isDelta(dy)) return
    const target = { x: dragStartBall.x + dx, y: dragStartBall.y + dy }
    ball = clampBall(target, workAreaFor(target))
    // While dragging, keep the same ball offset inside the window; which side the
    // panel opens on is recomputed on release.
    applyBounds(ball.x - layout.ball.x, ball.y - layout.ball.y)
  })
  ipcMain.on(CH.dragEnd, (e) => {
    if (!fromWindow(e) || !dragStartBall) return
    dragStartBall = null
    relayout()
    scheduleSave()
  })
}

// ---- app lifecycle ----

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (userHidden) toggleVisible()
  })

  // Only the installed app starts at login; never register the dev electron.exe.
  // A portable exe unpacks itself to a temp folder, so point the login item at the real exe.
  // Register once only: on Windows, setting it again re-enables the StartupApproved entry and
  // would undo the user turning drift off in Task Manager.
  // If the exe has moved since then, register once more for the new path.
  // A custom data file means a test run, which must not touch the real login item.
  if (app.isPackaged && !process.env.DRIFT_DATA_FILE) {
    const exePath = process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath
    const saved = readSettings(settingsFile)
    const registeredHere = saved.loginItemPath ? saved.loginItemPath === exePath : !!saved.loginItemRegistered
    if (!saved.loginItemRegistered || !registeredHere) {
      app.setLoginItemSettings({ openAtLogin: true, path: exePath })
      writeSettings(settingsFile, { loginItemRegistered: true, loginItemPath: exePath })
    } else if (!saved.loginItemPath) {
      writeSettings(settingsFile, { loginItemPath: exePath })
    }
  }

  // The tray is the only way out, so closing every window must not quit.
  app.on('will-quit', () => stopFullscreenWatch?.())
  app.on('window-all-closed', () => {
    if (quitting) app.quit()
  })

  void app.whenReady().then(() => {
    ball = readSettings(settingsFile).ball ?? defaultBall()
    registerIpc()
    createWindow()
    createTray()
    startWatchingFullscreen()
    watchDataFile(dataFile, WATCH_DEBOUNCE_MS, () => pushTasks())

    const onDisplayChange = (): void => relayout()
    screen.on('display-metrics-changed', onDisplayChange)
    screen.on('display-removed', onDisplayChange)
    screen.on('display-added', onDisplayChange)
  })
}
