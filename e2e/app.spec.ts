import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'

let app: ElectronApplication
let dir: string
let dataFile: string

test.beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-e2e-'))
  dataFile = path.join(dir, 'tasks.json')
  app = await electron.launch({
    args: [path.join(__dirname, '..')],
    env: { ...process.env, DRIFT_DATA_FILE: dataFile },
  })
})

test.afterEach(async () => {
  await app.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('the page comes back after a renderer crash', async () => {
  const page = await app.firstWindow()
  await expect(page.getByTestId('ball')).toBeVisible()
  const gone = app.evaluate(
    ({ BrowserWindow }) =>
      new Promise<string>((resolve) => {
        const wc = BrowserWindow.getAllWindows()[0].webContents
        wc.once('render-process-gone', (_e, d) => resolve(d.reason))
        wc.forcefullyCrashRenderer()
      }),
  )
  expect(await gone).not.toBe('clean-exit')
  await expect
    .poll(
      () =>
        app
          .evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(
              "!!document.querySelector('[data-testid=ball]')",
            ),
          )
          .catch(() => false), // the frame is briefly gone while it reloads
      { timeout: 10_000 },
    )
    .toBe(true)
})

test('window is always-on-top, frameless and transparent', async () => {
  const first = await app.firstWindow()
  await expect(first.getByTestId('ball')).toBeVisible()
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
    .toBe(true)
  const info = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    return {
      count: BrowserWindow.getAllWindows().length,
      alwaysOnTop: w.isAlwaysOnTop(),
      bounds: w.getBounds(),
      content: w.getContentBounds(),
      resizable: w.isResizable(),
      visible: w.isVisible(),
    }
  })
  expect(info.count).toBe(1)
  expect(info.alwaysOnTop).toBe(true)
  // Frameless: the content area fills the whole window (no title bar or border).
  expect(info.content).toEqual(info.bounds)
  expect(info.resizable).toBe(false)
  expect(info.visible).toBe(true)

  // Transparent: a screenshot of the window has alpha 0 in the empty corner
  // (an opaque window would capture as alpha 255).
  const cornerAlpha = await app.evaluate(async ({ BrowserWindow }) => {
    const image = await BrowserWindow.getAllWindows()[0].capturePage()
    return image.toBitmap()[3] // BGRA: byte 3 of pixel (0,0) is alpha
  })
  expect(cornerAlpha).toBe(0)

  // The page itself paints nothing behind the ball and panel.
  const page = await app.firstWindow()
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(bg).toBe('rgba(0, 0, 0, 0)')
})

test('a task written to the data file by another process appears live', async () => {
  const page = await app.firstWindow()
  await expect(page.getByTestId('ball')).toBeVisible()
  await page.getByTestId('ball').hover()
  await expect(page.getByTestId('panel')).toBeVisible()
  await expect(page.getByTestId('task')).toHaveCount(0)

  // Write the way a connector would: a full re-read-free rewrite via temp file + rename.
  const now = new Date().toISOString()
  const doc = {
    version: 1,
    tasks: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Written by another process',
        category: 'school',
        status: 'todo',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ],
  }
  const tmp = path.join(dir, 'incoming.tmp')
  fs.writeFileSync(tmp, JSON.stringify(doc))
  fs.renameSync(tmp, dataFile)

  await expect(page.getByTestId('task')).toHaveCount(1)
  await expect(page.getByTestId('task')).toContainText('Written by another process')
  await expect(page.getByTestId('count-todo')).toHaveText('1')
  await expect(page.getByTestId('group-school')).toContainText('Written by another process')
})

test('adding and completing a task from the panel is saved to the file', async () => {
  const page = await app.firstWindow()
  await page.getByTestId('ball').hover()
  const box = page.getByTestId('add-work')
  await expect(box).toBeVisible()
  await box.fill('Reply to the landlord')
  await box.press('Enter')
  await expect(page.getByTestId('task')).toContainText('Reply to the landlord')

  const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'))
  expect(saved.version).toBe(1)
  expect(saved.tasks[0]).toMatchObject({ title: 'Reply to the landlord', category: 'work', status: 'todo' })

  await page.getByRole('checkbox').click()
  await expect(page.getByTestId('count-completed')).toHaveText('1')
  expect(JSON.parse(fs.readFileSync(dataFile, 'utf8')).tasks[0].status).toBe('completed')
})

test('a task added through the MCP connector shows up in the panel without a restart', async () => {
  const page = await app.firstWindow()
  await page.getByTestId('ball').hover()
  await expect(page.getByTestId('panel')).toBeVisible()
  await expect(page.getByTestId('task')).toHaveCount(0)

  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  env.DRIFT_DATA_FILE = dataFile
  const client = new Client({ name: 'drift-e2e', version: '0.0.0' })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(__dirname, '..', 'out', 'mcp', 'drift-mcp.mjs')],
      env,
    }),
  )
  try {
    const res = (await client.callTool({
      name: 'add_task',
      arguments: { title: 'Book Friday dinner', category: 'life' },
    })) as { isError?: boolean }
    expect(res.isError).toBeFalsy()
  } finally {
    await client.close()
  }

  await expect(page.getByTestId('task')).toHaveCount(1)
  await expect(page.getByTestId('task')).toContainText('Book Friday dinner')
  await expect(page.getByTestId('group-life')).toContainText('Book Friday dinner')
  await expect(page.getByTestId('count-todo')).toHaveText('1')
})

test('drift hides while another window is fullscreen and comes back after', async () => {
  await app.firstWindow()
  const visible = (): Promise<boolean> =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())
  await expect.poll(visible).toBe(true)
  // Stands in for a slideshow or game: a second, frameless, fullscreen window that takes the foreground.
  await app.evaluate(({ BrowserWindow }) => {
    const w = new BrowserWindow({ fullscreen: true, frame: false, show: false })
    void w.loadURL('data:text/html,<body style="background:#123"></body>')
    w.once('ready-to-show', () => {
      w.show()
      w.focus()
    })
  })
  await expect.poll(visible, { timeout: 15_000 }).toBe(false)
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w.isFullScreen())?.destroy()
  })
  await expect.poll(visible, { timeout: 15_000 }).toBe(true)
})

function seed(titles: Array<{ title: string; category: string }>): void {
  const now = new Date().toISOString()
  const doc = {
    version: 1,
    tasks: titles.map((t, i) => ({
      id: `0000000${i}-1111-4111-8111-111111111111`,
      title: t.title,
      category: t.category,
      status: 'todo',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })),
  }
  fs.writeFileSync(dataFile, JSON.stringify(doc))
}

test('double-clicking a title renames the task, and Enter saves it to the file', async () => {
  seed([{ title: 'Reply to the landord', category: 'emails' }])
  const page = await app.firstWindow()
  await page.getByTestId('ball').hover()
  const row = page.getByTestId('task')
  await expect(row).toContainText('Reply to the landord')

  await row.getByText('Reply to the landord').dblclick()
  await expect(page.getByTestId('edit-title')).toBeFocused()
  // The whole title starts selected, so typing replaces it.
  await page.keyboard.type('Reply to the landlord')
  await page.keyboard.press('Enter')

  await expect(page.getByTestId('edit-title')).toHaveCount(0)
  await expect(row).toContainText('Reply to the landlord')
  const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'))
  expect(saved.tasks[0]).toMatchObject({ title: 'Reply to the landlord', category: 'emails' })
})

test('Escape cancels a rename, and an empty title does not delete the task', async () => {
  seed([{ title: 'Keep me as I am', category: 'work' }])
  const page = await app.firstWindow()
  await page.getByTestId('ball').hover()
  const row = page.getByTestId('task')

  await row.getByText('Keep me as I am').dblclick()
  await page.keyboard.type('Something else entirely')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('edit-title')).toHaveCount(0)
  await expect(row).toContainText('Keep me as I am')
  expect(JSON.parse(fs.readFileSync(dataFile, 'utf8')).tasks[0].title).toBe('Keep me as I am')

  await row.getByText('Keep me as I am').dblclick()
  await page.keyboard.type('   ')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('edit-title')).toHaveCount(0)
  await expect(row).toContainText('Keep me as I am')
  const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'))
  expect(saved.tasks[0]).toMatchObject({ title: 'Keep me as I am', deletedAt: null })
})

test('blurring the edit input saves the new title', async () => {
  seed([{ title: 'Old title', category: 'life' }])
  const page = await app.firstWindow()
  await page.getByTestId('ball').hover()
  await page.getByTestId('task').getByText('Old title').dblclick()
  await page.keyboard.type('New title')
  await page.getByTestId('panel').locator('h1').click()
  await expect(page.getByTestId('task')).toContainText('New title')
  expect(JSON.parse(fs.readFileSync(dataFile, 'utf8')).tasks[0].title).toBe('New title')
})

test('the category picker moves a task to another group and saves it', async () => {
  seed([{ title: 'Wrong group', category: 'school' }])
  const page = await app.firstWindow()
  await page.getByTestId('ball').hover()
  await expect(page.getByTestId('group-school')).toContainText('Wrong group')

  await page.getByTestId('task').hover()
  await page.getByRole('button', { name: 'Change category' }).click()
  await page.getByRole('button', { name: 'Move to work' }).click()

  await expect(page.getByTestId('group-work')).toContainText('Wrong group')
  await expect(page.getByTestId('group-school')).not.toContainText('Wrong group')
  expect(JSON.parse(fs.readFileSync(dataFile, 'utf8')).tasks[0].category).toBe('work')
})

test('the panel stays open and awake while a title is being edited', async () => {
  seed([{ title: 'Hold the panel', category: 'life' }])
  const page = await app.firstWindow()
  await page.getByTestId('ball').hover()
  await page.getByTestId('task').getByText('Hold the panel').dblclick()
  await expect(page.getByTestId('edit-title')).toBeFocused()
  // Move the pointer out of every hit area, then wait past the close and idle-fade delays.
  await page.mouse.move(2, 2)
  await page.waitForTimeout(4500)
  await expect(page.getByTestId('panel')).toHaveCSS('opacity', '1')
  await expect(page.getByTestId('shell')).toHaveCSS('opacity', '1')
  await expect(page.getByTestId('edit-title')).toBeFocused()
})
