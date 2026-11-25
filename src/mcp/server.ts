// Local MCP connector: lets Claude add and update drift tasks. Runs over stdio, no Electron.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { MAX_TITLE_LENGTH } from '../shared/config'
import { addTask, CATEGORIES, getDataFile, loadTasks, setStatus, STATUSES } from '../shared/store'
import type { Task } from '../shared/store'

const text = (message: string, isError = false) => ({
  content: [{ type: 'text' as const, text: message }],
  ...(isError ? { isError: true } : {}),
})

const line = (t: Task): string => `${t.id} | ${t.status} | ${t.category} | ${t.title}`

function failure(err: unknown) {
  return text(`Error: ${err instanceof Error ? err.message : String(err)}`, true)
}

export function createServer(): McpServer {
  const server = new McpServer({ name: 'drift', version: '1.0.0' })

  server.registerTool(
    'add_task',
    {
      description:
        "Add a task to the user's drift to-do list. Keep the title short and action-first " +
        '(for example "Book Friday dinner"). Pick the best-fitting category from context: ' +
        'school = classes, homework, exams, studying; ' +
        'emails = replying to or sending emails and messages that need writing; ' +
        'work = their job; life = errands, personal and social things. ' +
        'Use status "pending" only if the task is already started.',
      inputSchema: {
        title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
        category: z.enum(CATEGORIES),
        status: z.enum(['todo', 'pending']).default('todo'),
      },
    },
    async ({ title, category, status }) => {
      try {
        const t = addTask({ title, category, status })
        return text(`Added "${t.title}" to ${t.category} (${t.status}). id: ${t.id}`)
      } catch (err) {
        return failure(err)
      }
    },
  )

  server.registerTool(
    'list_tasks',
    {
      description:
        'List tasks on the drift to-do list, one per line as "id | status | category | title". ' +
        'Deleted tasks are not shown. Use the id with set_task_status.',
      inputSchema: {
        status: z.enum(STATUSES).optional(),
        category: z.enum(CATEGORIES).optional(),
      },
    },
    async ({ status, category }) => {
      try {
        const tasks = loadTasks().filter(
          (t) => (!status || t.status === status) && (!category || t.category === category),
        )
        if (tasks.length === 0) return text('No matching tasks.')
        return text(`${tasks.length} task(s):\n${tasks.map(line).join('\n')}`)
      } catch (err) {
        return failure(err)
      }
    },
  )

  server.registerTool(
    'set_task_status',
    {
      description:
        'Change a task\'s status: todo, pending (started, not finished), completed (use this for ' +
        '"mark it done"), or cancelled. Get the id from list_tasks.',
      inputSchema: {
        id: z.string().min(1),
        status: z.enum(STATUSES),
      },
    },
    async ({ id, status }) => {
      try {
        const t = setStatus(id, status)
        if (!t) return text(`Error: no task with id ${id}. Call list_tasks to see current ids.`, true)
        return text(`Marked "${t.title}" as ${t.status}. id: ${t.id}`)
      } catch (err) {
        return failure(err)
      }
    },
  )

  return server
}

async function main(): Promise<void> {
  const server = createServer()
  await server.connect(new StdioServerTransport())
  // stdout carries the protocol, so diagnostics go to stderr.
  console.error(`drift connector ready, data file: ${getDataFile()}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
