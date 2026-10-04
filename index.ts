// oc-todo - a V1-style per-session todo list for OpenCode V2.
//
// The list is REAL, per-session state: every mutation is written to the plugin
// storage under a session-scoped key, and every read returns exactly what is
// stored. Nothing here is ephemeral UI text.
//
// Three surfaces, one store:
//   - the `todo` tool, so the model/agent can add, update, complete, and clear
//   - this server plugin's `todo.list` RPC, so external clients can read it
//   - the `tui.tsx` CLI plugin, a read-only checklist renderer over the RPC
//
// `Plugin.define` is an identity helper, and the stock server runtime does not
// resolve the bare `@opencode/plugin` specifier for local directory plugins, so
// the plugin is exported as a plain `{ id, setup }` definition instead.
//
// Wire format, all JSON-serializable:
//   { version: 1, todos: [{ id, content, status, priority, createdAt, updatedAt }] }
// status:   "pending" | "in_progress" | "completed" | "cancelled"
// priority: "high" | "medium" | "low"

import { Todo } from "./contract.js"

export { Todo } from "./contract.js"

interface TodoItem {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
  priority: "high" | "medium" | "low"
  createdAt: number
  updatedAt: number
}

interface TodoListState {
  version: 1
  todos: TodoItem[]
}

const STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const
const PRIORITIES = ["high", "medium", "low"] as const

// Storage keys are global to the plugin, so the session is folded into the key.
// This is what makes the list session-scoped and durable across server restarts.
const keyOf = (sessionID: string) => `todos/session/${sessionID}`

function emptyState(): TodoListState {
  return { version: 1, todos: [] }
}

function coerce(raw: unknown): TodoListState {
  if (!raw || typeof raw !== "object") return emptyState()
  const value = raw as Partial<TodoListState>
  const todos = Array.isArray(value.todos)
    ? value.todos.filter(
        (item): item is TodoItem =>
          !!item && typeof item === "object" && typeof (item as TodoItem).id === "string",
      )
    : []
  return { version: 1, todos }
}

async function readState(
  store: { get(key: string): Promise<any> },
  sessionID: string,
): Promise<TodoListState> {
  return coerce(await store.get(keyOf(sessionID)))
}

async function writeState(
  store: { set(key: string, value: any): Promise<void> },
  sessionID: string,
  state: TodoListState,
): Promise<void> {
  await store.set(keyOf(sessionID), state as never)
}

/** Apply one mutation, purely, to an immutable state and return the next state. */
export function applyMutation(
  state: TodoListState,
  input: {
    action: "add" | "update" | "complete" | "clear"
    id?: string
    content?: string
    status?: string
    priority?: string
  },
): { state: TodoListState; summary: string } {
  const now = Date.now()
  const todos = state.todos.map((todo) => ({ ...todo }))
  const byId = (id: string | undefined) =>
    id ? todos.findIndex((todo) => todo.id === id || todo.id.startsWith(id)) : -1

  switch (input.action) {
    case "clear":
      return { state: { version: 1, todos: [] }, summary: `Cleared ${todos.length} todo(s)` }

    case "add": {
      const content = (input.content ?? "").trim()
      if (!content) return { state, summary: "add requires content" }
      const status = (STATUSES as readonly string[]).includes(input.status ?? "")
        ? (input.status as TodoItem["status"])
        : "pending"
      const priority = (PRIORITIES as readonly string[]).includes(input.priority ?? "")
        ? (input.priority as TodoItem["priority"])
        : "medium"
      const item: TodoItem = {
        id: `${now.toString(36)}${(todos.length + 1).toString(36)}`,
        content,
        status,
        priority,
        createdAt: now,
        updatedAt: now,
      }
      todos.push(item)
      return { state: { version: 1, todos }, summary: `Added "${content}" (${status}, ${priority})` }
    }

    case "update": {
      const index = byId(input.id)
      if (index < 0) return { state, summary: `update: no todo matching id "${input.id ?? ""}"` }
      const todo = todos[index]
      if (input.content !== undefined) todo.content = input.content
      if (input.status !== undefined && (STATUSES as readonly string[]).includes(input.status))
        todo.status = input.status as TodoItem["status"]
      if (input.priority !== undefined && (PRIORITIES as readonly string[]).includes(input.priority))
        todo.priority = input.priority as TodoItem["priority"]
      todo.updatedAt = now
      return { state: { version: 1, todos }, summary: `Updated "${todo.content}" -> ${todo.status}` }
    }

    case "complete": {
      const index = byId(input.id)
      if (index < 0) return { state, summary: `complete: no todo matching id "${input.id ?? ""}"` }
      const todo = todos[index]
      todo.status = "completed"
      todo.updatedAt = now
      return { state: { version: 1, todos }, summary: `Completed "${todo.content}"` }
    }

    default:
      return { state, summary: `Unknown action "${(input as { action: string }).action}"` }
  }
}

/** One compact line per todo, the same text a caller reads back. */
export function format(state: TodoListState): string {
  if (state.todos.length === 0) return "No todos."
  const mark = (s: TodoItem["status"]) =>
    s === "completed" ? "[x]" : s === "in_progress" ? "[~]" : s === "cancelled" ? "[-]" : "[ ]"
  return state.todos
    .map((todo) => `${mark(todo.status)} (${todo.id}) [${todo.priority}] ${todo.content}`)
    .join("\n")
}

export default {
  id: "oc-todo",
  async setup(ctx: any) {
    // The context the tool closes over, narrowed to just what the store needs.
    const store = {
      get: (key: string) => ctx.storage.get(key),
      set: (key: string, value: unknown) => ctx.storage.set(key, value as never),
    }

    const registration = await ctx.rpc.register(Todo, {
      // The TUI's read path: real stored state.
      async list(input: { sessionID: string }) {
        const { sessionID } = input
        const state = await readState(store, sessionID)
        return { todos: state.todos }
      },
    })

    await ctx.tool.transform((editor: any) => {
      editor.add({
        name: "todo",
        description:
          "Manage the current session's todo list. Read back the real stored list for this session with action 'list'. " +
          "Mutations: 'add' (content [status] [priority]), 'update' (id [content] [status] [priority]), " +
          "'complete' (id), 'clear' (wipes the list). Statuses: pending, in_progress, completed, cancelled. " +
          "Priorities: high, medium, low. The list persists per session across turns.",
        input: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["list", "add", "update", "complete", "clear"],
              description: "What to do with the session todo list.",
            },
            id: {
              type: "string",
              description: "Todo id (exact, or an unambiguous prefix) for update/complete.",
            },
            content: { type: "string", description: "Todo text for add, or replacement text for update." },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "completed", "cancelled"],
              description: "Status for update.",
            },
            priority: {
              type: "string",
              enum: ["high", "medium", "low"],
              description: "Priority for add or update.",
            },
          },
          required: ["action"],
          additionalProperties: false,
        },
        options: { codemode: true },
        async execute(input: any, context: any) {
          const request = input as {
            action: "list" | "add" | "update" | "complete" | "clear"
            id?: string
            content?: string
            status?: string
            priority?: string
          }
          // Session scope comes from the tool call context, not from the caller.
          const sessionID = String(context.sessionID)

          if (request.action === "list") {
            const state = await readState(store, sessionID)
            return { content: `${format(state)}\n${state.todos.length} todo(s) for session ${sessionID}.` }
          }

          const current = await readState(store, sessionID)
          const { state, summary } = applyMutation(current, request)
          await writeState(store, sessionID, state)
          await registration.events.emit("changed", { sessionID })
          return {
            content: `${summary}\n\n${format(state)}\n${state.todos.length} todo(s) for session ${sessionID}.`,
          }
        },
      })
    })

    return async () => {
      await registration.dispose()
    }
  },
}
