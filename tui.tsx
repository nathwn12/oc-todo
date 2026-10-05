// oc-todo CLI plugin - a read-only checklist over the stored session todo list.
//
// It owns no state. It calls the server plugin's `todo.list` RPC (the same real
// store the `todo` tool writes) and renders it in the sidebar. When the server
// emits `rpc.todo.changed`, the view refreshes; a light poll covers a remote
// server whose events this TUI is not subscribed to.

/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { createSignal, For, Show } from "solid-js"
import { Todo } from "./contract.js"

interface TodoItem {
  id: string
  content: string
  status: string
  priority: string
  notes?: string[]
}

const STATUS_DOT: Record<string, string> = {
  pending: "-",
  in_progress: "~",
  completed: "x",
  cancelled: "-",
}

export default Plugin.define({
  id: "oc-todo",
  setup(context) {
    const client = context.client
    const [todos, setTodos] = createSignal<TodoItem[]>([])
    // undefined = auto (expand while work remains, collapse when all closed);
    // a click sets true/false and that preference wins for this session.
    const [manual, setManual] = createSignal<boolean | undefined>(undefined)
    let sessionID: string | undefined

    // Monotonic request id: only the newest refresh may write the signal, so a
    // slow response for an older session (or an older tick) can never win.
    let requestSeq = 0
    const refresh = async (id: string) => {
      const seq = ++requestSeq
      try {
        // `client.rpc` builds a typed subclient from the shared contract.
        const remote = client.rpc(Todo)
        const result = (await remote.list({ sessionID: id })) as { todos?: TodoItem[] }
        if (seq === requestSeq && sessionID === id) setTodos(result.todos ?? [])
      } catch {
        // A failed refresh must never blank a session we have since moved to.
        if (seq === requestSeq && sessionID === id) setTodos([])
      }
    }

    const unsub = context.data.on("rpc.todo.changed", (event: any) => {
      if (sessionID && event?.data?.sessionID === sessionID) void refresh(sessionID)
    })
    // Fallback: refresh on a slow tick so a missed/filtered event cannot leave
    // the checklist stale. Cheap: one read per 3s for the visible session only.
    const timer = setInterval(() => {
      if (sessionID) void refresh(sessionID)
    }, 3_000)

    context.ui.slot({
      append: "sidebar.content",
      render: ({ sessionID: id }) => {
        if (id !== sessionID) {
          sessionID = id
          setManual(undefined)
          setTodos([])
          void refresh(id)
        }
        const total = () => todos().length
        // "Active" means work still to do. Cancelled is a terminal state, like completed.
        const active = () => todos().filter((t) => t.status !== "completed" && t.status !== "cancelled")
        const closed = () => total() - active().length
        const expanded = () => manual() ?? active().length > 0
        return (
          <Show when={total() > 0}>
            <box flexDirection="column">
              {/* The header is the click target; it stays visible in both states. */}
              <box flexDirection="row" gap={1} onMouseUp={() => setManual(!expanded())}>
                <text fg={context.theme.text.muted}>{expanded() ? "\u25bc" : "\u25b6"}</text>
                <text fg={context.theme.text.base}>
                  {active().length === 0 ? "\u2713 " : ""}
                  <b>Todos</b>{" "}
                  <span style={{ fg: context.theme.text.muted }}>
                    {closed()}/{total()}
                  </span>
                </text>
              </box>
              <Show when={expanded()}>
                <For each={todos()}>
                  {(todo) => (
                    <text
                      fg={
                        todo.status === "completed" || todo.status === "cancelled"
                          ? context.theme.text.muted
                          : context.theme.text.base
                      }
                      wrapMode="none"
                      truncate
                    >
                      {`[${STATUS_DOT[todo.status] ?? "-"}] ${todo.content}${
                        todo.notes && todo.notes.length > 0 ? ` (${todo.notes.length} note${todo.notes.length > 1 ? "s" : ""})` : ""
                      }`}
                    </text>
                  )}
                </For>
              </Show>
            </box>
          </Show>
        )
      },
    })

    return () => {
      unsub()
      clearInterval(timer)
    }
  },
})
