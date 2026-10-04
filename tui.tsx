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
    let sessionID: string | undefined

    const refresh = async (id: string) => {
      try {
        // `client.rpc` builds a typed subclient from the shared contract.
        const remote = client.rpc(Todo)
        const result = await remote.list({ sessionID: id })
        // Ignore a late response for a session we have already navigated away from.
        if (sessionID === id) setTodos(result.todos ?? [])
      } catch {
        setTodos([])
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
          void refresh(id)
        }
        const done = () => todos().filter((t) => t.status === "completed").length
        return (
          <Show when={todos().length > 0}>
            <box flexDirection="column">
              <text fg={context.theme.text.base}>
                <b>Todos</b>{" "}
                <span style={{ fg: context.theme.text.muted }}>
                  {done()}/{todos().length}
                </span>
              </text>
              <For each={todos()}>
                {(todo) => (
                  <text
                    fg={todo.status === "completed" ? context.theme.text.muted : context.theme.text.base}
                    wrapMode="none"
                    truncate
                  >
                    {`[${STATUS_DOT[todo.status] ?? "-"}] ${todo.content}`}
                  </text>
                )}
              </For>
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
