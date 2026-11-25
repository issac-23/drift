import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const root = path.join(__dirname, '..')
const bundle = path.join(root, 'out', 'mcp', 'drift-mcp.mjs')

let dir: string
let file: string
let client: Client

const read = (): string => fs.readFileSync(file, 'utf8')
const tasks = () => JSON.parse(read()).tasks as Array<Record<string, unknown>>

async function call(name: string, args: Record<string, unknown>) {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text: string }>
    isError?: boolean
  }
  return { text: res.content[0].text, isError: res.isError === true }
}

beforeAll(() => {
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build-mcp.mjs')], { stdio: 'pipe' })
}, 60_000)

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-mcp-'))
  file = path.join(dir, 'tasks.json')
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  env.DRIFT_DATA_FILE = file
  client = new Client({ name: 'drift-test', version: '0.0.0' })
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [bundle], env }))
})

afterEach(async () => {
  await client.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('drift MCP connector', () => {
  it('lists exactly add_task, list_tasks and set_task_status (no delete)', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(['add_task', 'list_tasks', 'set_task_status'])
    const add = tools.find((t) => t.name === 'add_task')
    expect(add?.description).toMatch(/short/i)
    expect(add?.description).toMatch(/category/i)
  })

  it('adds, lists and updates a task, and the file reflects it', async () => {
    const added = await call('add_task', { title: '  Book Friday dinner ', category: 'life' })
    expect(added.isError).toBe(false)
    const id = tasks()[0].id as string
    expect(added.text).toContain(id)
    expect(tasks()).toHaveLength(1)
    expect(tasks()[0]).toMatchObject({ title: 'Book Friday dinner', category: 'life', status: 'todo', deletedAt: null })

    await call('add_task', { title: 'Reply to the landlord', category: 'emails', status: 'pending' })
    expect(tasks()[1]).toMatchObject({ category: 'emails', status: 'pending' })

    const all = await call('list_tasks', {})
    expect(all.text).toContain(`${id} | todo | life | Book Friday dinner`)
    expect(all.text).toContain('Reply to the landlord')
    const onlyPending = await call('list_tasks', { status: 'pending' })
    expect(onlyPending.text).toContain('Reply to the landlord')
    expect(onlyPending.text).not.toContain('Book Friday dinner')
    const onlyWork = await call('list_tasks', { category: 'work' })
    expect(onlyWork.text).toBe('No matching tasks.')

    const done = await call('set_task_status', { id, status: 'completed' })
    expect(done.isError).toBe(false)
    expect(done.text).toContain(id)
    expect(tasks()[0].status).toBe('completed')
  })

  it('leaves soft-deleted tasks out of list_tasks', async () => {
    await call('add_task', { title: 'keep', category: 'work' })
    await call('add_task', { title: 'gone', category: 'work' })
    const doc = JSON.parse(read())
    doc.tasks[1].deletedAt = new Date().toISOString()
    fs.writeFileSync(file, JSON.stringify(doc))
    const res = await call('list_tasks', {})
    expect(res.text).toContain('keep')
    expect(res.text).not.toContain('gone')
  })

  it('rejects bad arguments and leaves the file unchanged', async () => {
    await call('add_task', { title: 'real', category: 'work' })
    const before = read()
    const id = tasks()[0].id as string

    const bad: Array<[string, Record<string, unknown>]> = [
      ['add_task', { title: 'x', category: 'fun' }],
      ['add_task', { title: '', category: 'work' }],
      ['add_task', { title: '   ', category: 'work' }],
      ['add_task', { title: 'x', category: 'work', status: 'completed' }],
      ['add_task', { category: 'work' }],
      ['list_tasks', { status: 'nope' }],
      ['set_task_status', { id, status: 'nope' }],
      ['set_task_status', { id: 'no-such-id', status: 'completed' }],
    ]
    for (const [name, args] of bad) {
      const res = await call(name, args)
      expect(res.isError, `${name} ${JSON.stringify(args)}`).toBe(true)
    }
    expect(read()).toBe(before)
  })
})
