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
// `Plugin.define` is an identity helper, so the plugin is exported as a plain
// `{ id, setup }` definition. That keeps the server entry loadable even where
// the bare `@opencode/plugin` specifier is not resolvable (observed on the
// stock 2.0.22 binary for local directory plugins).
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

const isStatus = (value: unknown): value is TodoItem["status"] =>
  (STATUSES as readonly unknown[]).includes(value)
const isPriority = (value: unknown): value is TodoItem["priority"] =>
  (PRIORITIES as readonly unknown[]).includes(value)

// Storage keys are global to the plugin, so the session is folded into the key.
// This is what makes the list session-scoped and durable across server restarts.
const keyOf = (sessionID: string) => `todos/session/${sessionID}`

function emptyState(): TodoListState {
  return { version: 1, todos: [] }
}

/**
 * Read stored state defensively: a hand-edited or partially-written row must
 * never make `todo.list` violate its output contract (that would reject the
 * whole call and blank the TUI). Every field is repaired to a valid value.
 */
export function coerce(raw: unknown): TodoListState {
  if (!raw || typeof raw !== "object") return emptyState()
  const value = raw as Partial<TodoListState>
  const todos: TodoItem[] = []
  if (Array.isArray(value.todos)) {
    for (const item of value.todos) {
      if (!item || typeof item !== "object") continue
      const todo = item as Partial<TodoItem>
      if (typeof todo.id !== "string") continue
      todos.push({
        id: todo.id,
        content: typeof todo.content === "string" ? todo.content : "",
        status: isStatus(todo.status) ? todo.status : "pending",
        priority: isPriority(todo.priority) ? todo.priority : "medium",
        createdAt: typeof todo.createdAt === "number" ? todo.createdAt : 0,
        updatedAt: typeof todo.updatedAt === "number" ? todo.updatedAt : 0,
      })
    }
  }
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

/**
 * Resolve a todo by exact id, then by a unique prefix. An ambiguous prefix is
 * an error, never a silent pick of the first match.
 */
export function findTodo(todos: TodoItem[], id: string | undefined): { index: number; error?: string } {
  if (!id) return { index: -1, error: "no id given" }
  const exact = todos.findIndex((todo) => todo.id === id)
  if (exact >= 0) return { index: exact }
  const matches = todos.flatMap((todo, index) => (todo.id.startsWith(id) ? [index] : []))
  if (matches.length === 0) return { index: -1, error: `no todo matching id "${id}"` }
  if (matches.length > 1) return { index: -1, error: `ambiguous id "${id}" matches ${matches.length} todos` }
  return { index: matches[0] }
}

/** Apply one mutation, purely, to an immutable state and return the next state. */
export function applyMutation(
  state: TodoListState,
  input: {
    action: "add" | "update" | "complete" | "clear" | "write"
    id?: string
    content?: string
    status?: string
    priority?: string
    todos?: ReadonlyArray<{ id?: string; content?: string; status?: string; priority?: string }>
  },
): { state: TodoListState; summary: string } {
  const now = Date.now()
  const todos = state.todos.map((todo) => ({ ...todo }))

  switch (input.action) {
    case "clear":
      if (todos.length === 0) return { state, summary: "List is already empty" }
      return { state: { version: 1, todos: [] }, summary: `Cleared ${todos.length} todo(s)` }

    // V1 `todowrite` parity: the caller supplies the whole list and it replaces
    // the previous one. Existing ids are kept, new items get fresh ids, blank
    // items are dropped, and a repeated id within one write is de-duplicated.
    case "write": {
      const previous = new Map(state.todos.map((todo) => [todo.id, todo]))
      const used = new Set<string>()
      const next: TodoItem[] = []
      for (const [index, entry] of (input.todos ?? []).entries()) {
        if (!entry || typeof entry !== "object") continue
        const content = typeof entry.content === "string" ? entry.content.trim() : ""
        if (!content) continue
        const status = isStatus(entry.status) ? entry.status : "pending"
        const priority = isPriority(entry.priority) ? entry.priority : "medium"
        let id =
          typeof entry.id === "string" && entry.id ? entry.id : `${now.toString(36)}${(index + 1).toString(36)}`
        if (used.has(id)) id = `${now.toString(36)}${(index + 1).toString(36)}${next.length.toString(36)}`
        used.add(id)
        const prior = previous.get(id)
        next.push({ id, content, status, priority, createdAt: prior?.createdAt ?? now, updatedAt: now })
      }
      return { state: { version: 1, todos: next }, summary: `Wrote ${next.length} todo(s)` }
    }

    case "add": {
      const content = typeof input.content === "string" ? input.content.trim() : ""
      if (!content) return { state, summary: "add requires content" }
      const status = isStatus(input.status) ? input.status : "pending"
      const priority = isPriority(input.priority) ? input.priority : "medium"
      todos.push({
        id: `${now.toString(36)}${(todos.length + 1).toString(36)}`,
        content,
        status,
        priority,
        createdAt: now,
        updatedAt: now,
      })
      return { state: { version: 1, todos }, summary: `Added "${content}" (${status}, ${priority})` }
    }

    case "update": {
      const found = findTodo(todos, input.id)
      if (found.index < 0) return { state, summary: `update: ${found.error}` }
      const todo = todos[found.index]
      let changed = false
      if (input.content !== undefined) {
        if (typeof input.content !== "string") return { state, summary: "update: content must be a string" }
        todo.content = input.content
        changed = true
      }
      if (input.status !== undefined && isStatus(input.status)) {
        todo.status = input.status
        changed = true
      }
      if (input.priority !== undefined && isPriority(input.priority)) {
        todo.priority = input.priority
        changed = true
      }
      if (!changed) return { state, summary: `update: nothing to change for "${todo.content}"` }
      todo.updatedAt = now
      return { state: { version: 1, todos }, summary: `Updated "${todo.content}" -> ${todo.status}` }
    }

    case "complete": {
      const found = findTodo(todos, input.id)
      if (found.index < 0) return { state, summary: `complete: ${found.error}` }
      const todo = todos[found.index]
      if (todo.status === "completed") return { state, summary: `"${todo.content}" is already completed` }
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

    // Storage has no compare-and-swap, so read → mutate → write for one session
    // must not interleave. Concurrent tool calls are normal (and code-mode makes
    // them easy), so each session gets a serial queue.
    const queues = new Map<string, Promise<unknown>>()
    const serialize = <T>(sessionID: string, task: () => Promise<T>): Promise<T> => {
      const previous = queues.get(sessionID) ?? Promise.resolve()
      const next = previous.then(task, task)
      queues.set(
        sessionID,
        next.catch(() => {}),
      )
      return next
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
          "Mutations: 'write' (V1 todowrite parity: replace the whole list from `todos`), 'add' (content [status] [priority]), " +
          "'update' (id [content] [status] [priority]), 'complete' (id), 'clear' (wipes the list). " +
          "Statuses: pending, in_progress, completed, cancelled. Priorities: high, medium, low. " +
          "The list persists per session across turns and is not auto-pruned.",
        input: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["list", "add", "update", "complete", "clear", "write"],
              description: "What to do with the session todo list.",
            },
            todos: {
              type: "array",
              description:
                "Full replacement list for action 'write' (V1 todowrite parity). Each item needs content; " +
                "id/status/priority are optional (id keeps an existing item's identity and createdAt).",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  content: { type: "string" },
                  status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled"] },
                  priority: { type: "string", enum: ["high", "medium", "low"] },
                },
                required: ["content"],
              },
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
            action: "list" | "add" | "update" | "complete" | "clear" | "write"
            id?: string
            content?: string
            status?: string
            priority?: string
            todos?: ReadonlyArray<{ id?: string; content?: string; status?: string; priority?: string }>
          }
          // Session scope comes from the tool call context, not from the caller.
          const sessionID = String(context.sessionID)

          if (request.action === "list") {
            const state = await readState(store, sessionID)
            return { content: `${format(state)}\n${state.todos.length} todo(s) for session ${sessionID}.` }
          }

          const { state, summary } = await serialize(sessionID, async () => {
            const current = await readState(store, sessionID)
            const outcome = applyMutation(current, request)
            // A no-op must not rewrite storage or fire a change event.
            if (JSON.stringify(outcome.state) !== JSON.stringify(current)) {
              await writeState(store, sessionID, outcome.state)
              await registration.events.emit("changed", { sessionID })
            }
            return outcome
          })
          return {
            content: `${summary}\n\n${format(state)}\n${state.todos.length} todo(s) for session ${sessionID}.`,
          }
        },
      })
    })

    return async () => {
      queues.clear()
      await registration.dispose()
    }
  },
}
