// oc-todo CLI plugin - a read-only checklist over the stored session todo list.
//
// It owns no state. It calls the server plugin's `todo.list` RPC (the same real
// store the `todo` tool writes) and renders it in the sidebar. When the server
// emits `rpc.todo.changed`, the view refreshes; a light poll covers a remote
// server whose events this TUI is not subscribed to.
//
// The line text is built by `sidebarLines`, a pure renderer kept out of the JSX
// so it is trivial to test: every row is a one-cell label column, its guaranteed
// separator, then a clipped value, and every glyph the renderer emits is exactly
// one cell wide.

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

/** One already-clipped sidebar line, before it is themed. */
export interface SidebarLine {
  /** The final line text; the renderer truncates nothing further. */
  text: string
  /** True for a closed (completed/cancelled) item row. */
  muted: boolean
}

/**
 * The four status marks: pending `-`, in_progress `~`, completed `x`,
 * cancelled `/`. Exactly one cell each and all four distinct - the old `[x]`
 * three-cell tokens and the shared `-` for pending/cancelled are both gone.
 */
const STATUS_MARK: Record<string, string> = {
  pending: "-",
  in_progress: "~",
  completed: "x",
  cancelled: "/",
}

/** The mark for an unknown stored status: read it as still pending. */
const UNKNOWN_MARK = "-"

/** ASCII toggle marks: `v` expanded, `>` collapsed. Never the U+25BC/U+25B6 triangles. */
const TOGGLE_EXPANDED = "v"
const TOGGLE_COLLAPSED = ">"

/**
 * Value-column budget for an item, in cells.
 *
 * The sidebar is roughly thirty-odd columns wide, so the mark's one-cell label
 * column plus its separator plus this budget stays inside the panel. Without it
 * a long todo wraps the sidebar, which costs the reader more than a shortened
 * line.
 */
export const CONTENT_WIDTH = 28

/** The label column every row uses: one cell, the mark or the toggle. */
const LABEL_WIDTH = 1

/**
 * Flatten control characters in anything about to be drawn.
 *
 * A row is one line, so a newline or an escape sequence in a host-supplied
 * string does not get seen - it moves the cursor. The same rule the Flight Deck
 * rail applies to every value it draws.
 */
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g
function plain(value: string): string {
  return value.replace(CONTROL_CHARS, " ")
}

/**
 * The label column plus its guaranteed separator, before a row's value.
 *
 * A label wider than its column still gets a separator, so a value can never
 * begin inside the label column.
 */
function labelPrefix(label: string, labelWidth: number): string {
  return `${label.padEnd(labelWidth)}${label.length >= labelWidth ? " " : ""}`
}

/** One padded row: the label in its column, its separator, then the flattened value. */
function formatRow(label: string, value: string, labelWidth: number): string {
  return `${labelPrefix(label, labelWidth)}${plain(value)}`
}

/**
 * Shorten a value for the narrow sidebar.
 *
 * Width-aware and surrogate-safe: the ellipsis tells the reader the value was
 * cut rather than being the value, and a surrogate pair is never sliced in half.
 */
function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, Math.max(1, max - 1))
  const safe = /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut
  return `${safe}\u2026`
}

/** The compact note count suffix, or the empty string when the item has none. */
function notesSuffix(notes: readonly string[] | undefined): string {
  const count = notes?.length ?? 0
  if (count === 0) return ""
  return ` (${count} note${count > 1 ? "s" : ""})`
}

/**
 * The sidebar's lines for a stored list: the header first, then the item rows
 * when expanded. Pure, so the rendering is asserted directly rather than
 * through the JSX.
 *
 * The header is always the first line when the list is non-empty, so the
 * collapsed and expanded headers never differ in column offset. A closed
 * (completed or cancelled) item row is `muted`; every row is exactly one label
 * cell, its separator, then the clipped value.
 */
export function sidebarLines(
  todos: readonly TodoItem[],
  opts?: { expanded?: boolean; labelWidth?: number; contentWidth?: number },
): SidebarLine[] {
  if (todos.length === 0) return []
  const labelWidth = opts?.labelWidth ?? LABEL_WIDTH
  const contentWidth = opts?.contentWidth ?? CONTENT_WIDTH
  const total = todos.length
  const closed = todos.filter((todo) => todo.status === "completed" || todo.status === "cancelled").length
  const expanded = opts?.expanded ?? total - closed > 0

  const lines: SidebarLine[] = [
    {
      text: formatRow(expanded ? TOGGLE_EXPANDED : TOGGLE_COLLAPSED, `Todos ${closed}/${total}`, labelWidth),
      muted: false,
    },
  ]
  if (!expanded) return lines

  for (const todo of todos) {
    const closedRow = todo.status === "completed" || todo.status === "cancelled"
    const mark = STATUS_MARK[todo.status] ?? UNKNOWN_MARK
    const value = clip(`${todo.content}${notesSuffix(todo.notes)}`, contentWidth)
    lines.push({ text: formatRow(mark, value, labelWidth), muted: closedRow })
  }
  return lines
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
        // "Active" means work still to do. Cancelled is a terminal state, like completed.
        const active = () => todos().filter((t) => t.status !== "completed" && t.status !== "cancelled")
        const expanded = () => manual() ?? active().length > 0
        const lines = () => sidebarLines(todos(), { expanded: expanded() })
        return (
          <Show when={todos().length > 0}>
            <box flexDirection="column">
              {/* The header is the click target; it stays visible in both states. */}
              <box flexDirection="row" onMouseUp={() => setManual(!expanded())}>
                <text fg={context.theme.text.base} wrapMode="none" truncate>
                  {lines()[0]?.text ?? ""}
                </text>
              </box>
              <Show when={expanded()}>
                <For each={lines().slice(1)}>
                  {(line) => (
                    <text fg={line.muted ? context.theme.text.muted : context.theme.text.base} wrapMode="none" truncate>
                      {line.text}
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
