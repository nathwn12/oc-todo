import { describe, expect, test } from "bun:test"
import { aggregateOpen, applyMutation, coerce, findTodo, format, formatOpen } from "../index.js"
import { Todo } from "../contract.js"

const empty = { version: 1 as const, todos: [] as any[] }

describe("applyMutation", () => {
  test("add appends a pending/medium item and reports a summary", () => {
    const { state, summary } = applyMutation(empty, { action: "add", content: "write docs" })
    expect(state.todos).toHaveLength(1)
    expect(state.todos[0]).toMatchObject({ content: "write docs", status: "pending", priority: "medium" })
    expect(summary).toContain("write docs")
  })

  test("add honours valid status and priority", () => {
    const { state } = applyMutation(empty, {
      action: "add",
      content: "ship it",
      status: "in_progress",
      priority: "high",
    })
    expect(state.todos[0]).toMatchObject({ status: "in_progress", priority: "high" })
  })

  test("add rejects blank content", () => {
    const { state, summary } = applyMutation(empty, { action: "add", content: "   " })
    expect(state.todos).toHaveLength(0)
    expect(summary).toContain("requires content")
  })

  test("update changes status/priority by exact id", () => {
    const added = applyMutation(empty, { action: "add", content: "a" }).state
    const id = added.todos[0].id
    const next = applyMutation(added, { action: "update", id, status: "cancelled", priority: "low" }).state
    expect(next.todos[0]).toMatchObject({ status: "cancelled", priority: "low" })
  })

  test("update accepts an unambiguous id prefix", () => {
    const added = applyMutation(empty, { action: "add", content: "a" }).state
    const id = added.todos[0].id
    const next = applyMutation(added, { action: "update", id: id.slice(0, 4), status: "completed" }).state
    expect(next.todos[0].status).toBe("completed")
  })

  test("update with an unknown id leaves the list unchanged", () => {
    const added = applyMutation(empty, { action: "add", content: "a" }).state
    const next = applyMutation(added, { action: "update", id: "nope", status: "completed" }).state
    expect(next.todos).toEqual(added.todos)
  })

  test("complete marks the item completed", () => {
    const added = applyMutation(empty, { action: "add", content: "a" }).state
    const next = applyMutation(added, { action: "complete", id: added.todos[0].id }).state
    expect(next.todos[0].status).toBe("completed")
  })

  test("clear empties the list", () => {
    const added = applyMutation(empty, { action: "add", content: "a" }).state
    const { state, summary } = applyMutation(added, { action: "clear" })
    expect(state.todos).toHaveLength(0)
    expect(summary).toContain("Cleared 1")
  })

  test("write replaces the whole list (V1 todowrite parity)", () => {
    const first = applyMutation(empty, { action: "add", content: "old" }).state
    const { state, summary } = applyMutation(first, {
      action: "write",
      todos: [
        { content: "one", status: "in_progress", priority: "high" },
        { content: "two" },
      ],
    })
    expect(state.todos.map((t) => t.content)).toEqual(["one", "two"])
    expect(state.todos[0]).toMatchObject({ status: "in_progress", priority: "high" })
    expect(state.todos[1]).toMatchObject({ status: "pending", priority: "medium" })
    expect(summary).toContain("Wrote 2")
  })

  test("write keeps an existing item's id and createdAt", () => {
    const added = applyMutation(empty, { action: "add", content: "keep me" }).state
    const existing = added.todos[0]
    const { state } = applyMutation(added, {
      action: "write",
      todos: [{ id: existing.id, content: "keep me", status: "completed" }],
    })
    expect(state.todos[0].id).toBe(existing.id)
    expect(state.todos[0].createdAt).toBe(existing.createdAt)
    expect(state.todos[0].status).toBe("completed")
  })

  test("write drops blank entries and defaults unknown status/priority", () => {
    const { state } = applyMutation(empty, {
      action: "write",
      todos: [{ content: "  " }, { content: "ok", status: "bogus", priority: "bogus" }],
    })
    expect(state.todos).toHaveLength(1)
    expect(state.todos[0]).toMatchObject({ content: "ok", status: "pending", priority: "medium" })
  })

  test("write with an empty array clears the list", () => {
    const added = applyMutation(empty, { action: "add", content: "a" }).state
    const { state } = applyMutation(added, { action: "write", todos: [] })
    expect(state.todos).toHaveLength(0)
  })
})

describe("format", () => {
  test("empty state", () => {
    expect(format({ version: 1, todos: [] })).toBe("No todos.")
  })

  test("renders a mark, id, priority and content per item", () => {
    const state = {
      version: 1 as const,
      todos: [
        { id: "z1", content: "done", status: "completed", priority: "low", createdAt: 0, updatedAt: 0 },
      ] as any[],
    }
    expect(format(state).split("\n")[0]).toBe("[x] (z1) [low] done")
  })

  test("each status has a distinct mark", () => {
    const mk = (status: string) => ({ id: "i", content: "c", status, priority: "medium", createdAt: 0, updatedAt: 0 })
    const state = { version: 1 as const, todos: ["pending", "in_progress", "completed", "cancelled"].map(mk) as any[] }
    const lines = format(state).split("\n")
    expect(lines.slice(0, 4).map((l) => l.slice(0, 3))).toEqual(["[ ]", "[~]", "[x]", "[-]"])
  })
})

// #4 Counts summary line.
describe("counts summary (#4)", () => {
  const mk = (id: string, status: string) => ({ id, content: id, status, priority: "medium", createdAt: 0, updatedAt: 0 })

  test("empty list keeps exactly No todos.", () => {
    expect(format({ version: 1, todos: [] })).toBe("No todos.")
  })

  test("the summary is the final line, numbers then words", () => {
    const state = {
      version: 1 as const,
      todos: [mk("a", "pending"), mk("b", "pending"), mk("c", "in_progress"), mk("d", "completed")] as any[],
    }
    const lines = format(state).split("\n")
    expect(lines[lines.length - 1]).toBe("2 open · 1 in progress · 1 done")
  })

  test("cancelled is excluded from all three counts", () => {
    const state = {
      version: 1 as const,
      todos: [mk("a", "cancelled"), mk("b", "cancelled"), mk("c", "pending")] as any[],
    }
    expect(format(state).split("\n").pop()).toBe("1 open · 0 in progress · 0 done")
  })

  test("all-zero counts still render when the list is non-empty", () => {
    const state = { version: 1 as const, todos: [mk("a", "cancelled")] as any[] }
    expect(format(state).split("\n").pop()).toBe("0 open · 0 in progress · 0 done")
  })
})

describe("id resolution", () => {
  const withIds = (ids: string[]) =>
    ({ version: 1 as const, todos: ids.map((id) => ({ id, content: id, status: "pending", priority: "medium", createdAt: 0, updatedAt: 0 })) as any[] })

  test("an ambiguous prefix is refused, never a silent pick", () => {
    const state = withIds(["abc1", "abc2"])
    const { state: next, summary } = applyMutation(state, { action: "update", id: "abc", status: "completed" })
    expect(summary).toContain("ambiguous")
    expect(next.todos.map((t) => t.status)).toEqual(["pending", "pending"])
  })

  test("an exact id wins over a prefix match", () => {
    // "abcd" starts with "abc", but an item literally named "abc" must win.
    const state = withIds(["abcd", "abc"])
    const { state: next } = applyMutation(state, { action: "complete", id: "abc" })
    expect(next.todos[0].status).toBe("pending")
    expect(next.todos[1].status).toBe("completed")
  })

  test("a unique prefix still works", () => {
    const state = withIds(["zzz9"])
    const { state: next } = applyMutation(state, { action: "complete", id: "zzz" })
    expect(next.todos[0].status).toBe("completed")
  })

  test("findTodo reports the reason it failed", () => {
    const state = withIds(["abc1"])
    expect(findTodo(state.todos, undefined).error).toBe("no id given")
    expect(findTodo(state.todos, "nope").error).toContain("no todo matching")
  })
})

// #3 Notes on an item.
describe("notes (#3)", () => {
  test("add stores coerced notes", () => {
    const { state } = applyMutation(empty, {
      action: "add",
      content: "a",
      notes: ["  step one  ", "", "step two", 5 as any, "   "],
    })
    expect(state.todos[0].notes).toEqual(["step one", "step two"])
  })

  test("add with no usable notes omits the field", () => {
    const omitted = applyMutation(empty, { action: "add", content: "a" }).state
    const emptyish = applyMutation(empty, { action: "add", content: "b", notes: ["  ", ""] }).state
    expect(omitted.todos[0]).not.toHaveProperty("notes")
    expect(emptyish.todos[0]).not.toHaveProperty("notes")
  })

  test("a non-array notes on add is ignored, not a throw", () => {
    const { state } = applyMutation(empty, { action: "add", content: "a", notes: "nope" as any })
    expect(state.todos[0]).not.toHaveProperty("notes")
  })

  test("a non-array notes on update is ignored, not a delete", () => {
    const added = applyMutation(empty, { action: "add", content: "a", notes: ["keep"] }).state
    const before = added.todos[0].updatedAt
    const { state, summary } = applyMutation(added, { action: "update", id: added.todos[0].id, notes: "nope" as any })
    expect(state.todos[0].notes).toEqual(["keep"])
    expect(summary).toContain("nothing to change")
    expect(state.todos[0].updatedAt).toBe(before)
  })

  test("update replaces the notes array", () => {
    const added = applyMutation(empty, { action: "add", content: "a", notes: ["old"] }).state
    const next = applyMutation(added, { action: "update", id: added.todos[0].id, notes: ["new", "more"] }).state
    expect(next.todos[0].notes).toEqual(["new", "more"])
  })

  test("update with an empty array clears the field", () => {
    const added = applyMutation(empty, { action: "add", content: "a", notes: ["old"] }).state
    const next = applyMutation(added, { action: "update", id: added.todos[0].id, notes: [] }).state
    expect(next.todos[0]).not.toHaveProperty("notes")
  })

  test("update re-supplying the same notes is a no-op", () => {
    const added = applyMutation(empty, { action: "add", content: "a", notes: ["x"] }).state
    const before = added.todos[0].updatedAt
    const { state, summary } = applyMutation(added, { action: "update", id: added.todos[0].id, notes: ["x"] })
    expect(summary).toContain("nothing to change")
    expect(state.todos[0].updatedAt).toBe(before)
    expect(state.todos[0].notes).toEqual(["x"])
  })

  test("write carries notes through", () => {
    const { state } = applyMutation(empty, {
      action: "write",
      todos: [{ content: "one", notes: ["n1"] }, { content: "two" }],
    })
    expect(state.todos[0].notes).toEqual(["n1"])
    expect(state.todos[1]).not.toHaveProperty("notes")
  })

  test("coerce repairs a malformed stored notes array", () => {
    const state = coerce({
      version: 1,
      todos: [
        { id: "a", notes: ["ok", "", 5, "  pad  "] },
        { id: "b", notes: "not an array" },
        { id: "c", notes: [{}] },
      ],
    })
    expect(state.todos[0].notes).toEqual(["ok", "pad"])
    expect(state.todos[1]).not.toHaveProperty("notes")
    expect(state.todos[2]).not.toHaveProperty("notes")
  })

  test("format indents notes under the item line and keeps the summary last", () => {
    const added = applyMutation(empty, { action: "add", content: "with notes", notes: ["one", "two"] }).state
    const lines = format(added).split("\n")
    expect(lines[0]).toContain("with notes")
    expect(lines[1]).toBe("  - one")
    expect(lines[2]).toBe("  - two")
    expect(lines[lines.length - 1]).toBe("1 open · 0 in progress · 0 done")
  })
})

// #2 Move / reorder.
describe("move (#2)", () => {
  const three = applyMutation(empty, { action: "write", todos: [{ content: "a" }, { content: "b" }, { content: "c" }] }).state
  const ids = () => three.todos.map((t) => t.id)

  test("move by position reorders and bumps updatedAt", () => {
    const last = three.todos[2].id
    const before = three.todos[2].updatedAt
    const { state, summary } = applyMutation(three, { action: "move", id: last, position: 0 })
    expect(state.todos.map((t) => t.content)).toEqual(["c", "a", "b"])
    expect(summary).toContain("Moved")
    expect(summary).toContain("position 0")
    // The MOVED item's own updatedAt must strictly increase — comparing against a
    // different item created at the same `now` would pass even if the bump were
    // removed (the bug this replaces).
    expect(state.todos[0].updatedAt).toBeGreaterThan(before)
  })

  test("move by before inserts ahead of the target", () => {
    const [a, , c] = ids()
    const { state } = applyMutation(three, { action: "move", id: c, before: a })
    expect(state.todos.map((t) => t.content)).toEqual(["c", "a", "b"])
  })

  test("move by after inserts behind the target", () => {
    const [a, , c] = ids()
    const { state } = applyMutation(three, { action: "move", id: a, after: c })
    expect(state.todos.map((t) => t.content)).toEqual(["b", "c", "a"])
  })

  test("an out-of-range position is clamped after removal", () => {
    const low = applyMutation(three, { action: "move", id: ids()[0], position: 99 })
    const high = applyMutation(three, { action: "move", id: ids()[2], position: -5 })
    expect(low.state.todos.map((t) => t.content)).toEqual(["b", "c", "a"])
    expect(high.state.todos.map((t) => t.content)).toEqual(["c", "a", "b"])
  })

  test("a no-op move reports nothing to change and keeps updatedAt", () => {
    const before = three.todos[1].updatedAt
    const { state, summary } = applyMutation(three, { action: "move", id: ids()[1], position: 1 })
    expect(summary).toContain("nothing to change")
    expect(state.todos[1].updatedAt).toBe(before)
  })

  test("no selector is an explicit error", () => {
    const { state, summary } = applyMutation(three, { action: "move", id: ids()[0] })
    expect(summary).toBe("move: give before, after, or position")
    expect(state.todos.map((t) => t.content)).toEqual(["a", "b", "c"])
  })

  test("two selectors are refused and change nothing (before + after)", () => {
    const [a, b, c] = ids()
    const { state, summary } = applyMutation(three, { action: "move", id: c, before: a, after: b })
    expect(summary).toBe("move: give exactly one of before, after, or position")
    expect(state.todos.map((t) => t.content)).toEqual(["a", "b", "c"])
  })

  test("two selectors are refused and change nothing (before + position)", () => {
    const [a, , c] = ids()
    const { state, summary } = applyMutation(three, { action: "move", id: c, before: a, position: 2 })
    expect(summary).toBe("move: give exactly one of before, after, or position")
    expect(state.todos.map((t) => t.content)).toEqual(["a", "b", "c"])
  })

  test("an unknown target id names the failure and changes nothing", () => {
    const { state, summary } = applyMutation(three, { action: "move", id: ids()[0], before: "nope" })
    expect(summary).toContain("nope")
    expect(state.todos.map((t) => t.content)).toEqual(["a", "b", "c"])
  })

  test("an unknown move id itself changes nothing", () => {
    const { state, summary } = applyMutation(three, { action: "move", id: "nope", position: 0 })
    expect(summary).toContain("move:")
    expect(state.todos.map((t) => t.content)).toEqual(["a", "b", "c"])
  })

  test("an ambiguous target id is refused", () => {
    const state = applyMutation(empty, { action: "write", todos: [{ id: "abc1", content: "a" }, { id: "abc2", content: "b" }, { id: "z", content: "c" }] }).state
    const { state: next, summary } = applyMutation(state, { action: "move", id: "z", before: "abc" })
    expect(summary).toContain("ambiguous")
    expect(next.todos.map((t) => t.content)).toEqual(["a", "b", "c"])
  })
})

describe("input hardening", () => {
  test("add with a non-string content does not throw", () => {
    const { state, summary } = applyMutation(empty, { action: "add", content: 5 as any })
    expect(state.todos).toHaveLength(0)
    expect(summary).toContain("requires content")
  })

  test("update with a non-string content is refused", () => {
    const added = applyMutation(empty, { action: "add", content: "a" }).state
    const { state, summary } = applyMutation(added, { action: "update", id: added.todos[0].id, content: 5 as any })
    expect(summary).toContain("must be a string")
    expect(state.todos[0].content).toBe("a")
  })

  test("update with nothing to change does not bump updatedAt", () => {
    const added = applyMutation(empty, { action: "add", content: "a" }).state
    const before = added.todos[0].updatedAt
    const { state, summary } = applyMutation(added, { action: "update", id: added.todos[0].id })
    expect(summary).toContain("nothing to change")
    expect(state.todos[0].updatedAt).toBe(before)
  })

  test("update that re-supplies the same status is a no-op", () => {
    const added = applyMutation(empty, { action: "add", content: "a", status: "pending" }).state
    const before = added.todos[0].updatedAt
    const { state, summary } = applyMutation(added, {
      action: "update",
      id: added.todos[0].id,
      status: "pending",
    })
    expect(summary).toContain("nothing to change")
    expect(state.todos[0].updatedAt).toBe(before)
  })

  test("update that re-supplies the same priority is a no-op", () => {
    const added = applyMutation(empty, { action: "add", content: "a", priority: "medium" }).state
    const before = added.todos[0].updatedAt
    const { summary, state } = applyMutation(added, {
      action: "update",
      id: added.todos[0].id,
      priority: "medium",
    })
    expect(summary).toContain("nothing to change")
    expect(state.todos[0].updatedAt).toBe(before)
  })

  test("update that re-supplies the same content is a no-op", () => {
    const added = applyMutation(empty, { action: "add", content: "a" }).state
    const before = added.todos[0].updatedAt
    const { summary, state } = applyMutation(added, {
      action: "update",
      id: added.todos[0].id,
      content: "a",
    })
    expect(summary).toContain("nothing to change")
    expect(state.todos[0].updatedAt).toBe(before)
  })

  test("update still reports a change when one field genuinely differs", () => {
    const added = applyMutation(empty, { action: "add", content: "a", status: "pending", priority: "medium" }).state
    const { summary, state } = applyMutation(added, {
      action: "update",
      id: added.todos[0].id,
      status: "pending",
      priority: "high",
    })
    expect(summary).toContain("Updated")
    expect(state.todos[0].priority).toBe("high")
    expect(state.todos[0].status).toBe("pending")
  })

  test("write re-checks a regenerated id against both used and previous", () => {
    // Pin `now` so the regenerated id is predictable, then plant a colliding id
    // in `previous` so a single regeneration (the old behaviour) would still
    // collide and silently overwrite identity.
    const realNow = Date.now
    Date.now = () => 1_000_000
    try {
      const now36 = (1_000_000).toString(36)
      // Previous list already owns the id the regeneration would pick for entry 1.
      const previous = {
        version: 1 as const,
        todos: [
          { id: `${now36}21`, content: "old", status: "pending", priority: "medium", createdAt: 0, updatedAt: 0 },
        ] as any[],
      }
      const { state } = applyMutation(previous, {
        action: "write",
        todos: [
          { id: "dup", content: "one" },
          { id: "dup", content: "two" },
        ],
      })
      expect(state.todos).toHaveLength(2)
      expect(new Set(state.todos.map((t) => t.id)).size).toBe(2)
      // The second item must not have stolen the id age of the previous row.
      expect(state.todos[1].createdAt).toBe(1_000_000)
    } finally {
      Date.now = realNow
    }
  })

  test("write de-duplicates a repeated id", () => {
    const { state } = applyMutation(empty, {
      action: "write",
      todos: [
        { id: "dup", content: "one" },
        { id: "dup", content: "two" },
      ],
    })
    expect(state.todos).toHaveLength(2)
    expect(new Set(state.todos.map((t) => t.id)).size).toBe(2)
  })

  test("write skips non-object entries", () => {
    const { state } = applyMutation(empty, { action: "write", todos: [null as any, { content: "ok" }] })
    expect(state.todos.map((t) => t.content)).toEqual(["ok"])
  })
})

describe("coerce", () => {
  test("repairs malformed stored rows instead of rejecting the list", () => {
    const state = coerce({
      version: 1,
      todos: [
        { id: "a", content: 5, status: "bogus", priority: null },
        { id: "b" },
        { content: "no id" },
        "junk",
      ],
    })
    expect(state.todos.map((t) => t.id)).toEqual(["a", "b"])
    expect(state.todos[0]).toMatchObject({ content: "", status: "pending", priority: "medium" })
    expect(state.todos[1]).toMatchObject({ content: "", status: "pending", priority: "medium" })
  })

  test("non-object input is an empty list", () => {
    expect(coerce(undefined).todos).toEqual([])
    expect(coerce("nope").todos).toEqual([])
  })
})

describe("cross-session open (#1)", () => {
  const row = (sessionID: string, todos: any[]) => ({ key: `todos/session/${sessionID}`, value: { version: 1, todos } })
  const t = (id: string, status: string) => ({ id, content: id, status, priority: "high", createdAt: 1, updatedAt: 7 })

  test("aggregates unfinished todos across sessions, tagged by sessionID", () => {
    const result = aggregateOpen([
      row("s1", [t("a", "pending"), t("b", "completed")]),
      row("s2", [t("c", "in_progress"), t("d", "cancelled")]),
    ])
    expect(result.todos.map((x) => x.id)).toEqual(["a", "c"])
    expect(result.todos.map((x) => x.sessionID)).toEqual(["s1", "s2"])
  })

  test("excludes completed and cancelled, and keeps the contract keys", () => {
    const result = aggregateOpen([row("s1", [t("a", "completed"), t("b", "cancelled")])])
    expect(result.todos).toHaveLength(0)
    const open = aggregateOpen([row("s1", [t("c", "pending")])]).todos[0]
    expect(Object.keys(open).sort()).toEqual(["content", "id", "priority", "sessionID", "status", "updatedAt"])
  })

  test("ignores keys that are not session todo rows", () => {
    const result = aggregateOpen([
      { key: "todos/session/s1", value: { version: 1, todos: [t("a", "pending")] } },
      { key: "wellknown:sources", value: ["https://example.com"] },
      { key: "todos/session/broken", value: null },
    ])
    expect(result.todos.map((x) => x.id)).toEqual(["a"])
  })

  test("empty storage is an empty result", () => {
    expect(aggregateOpen([])).toEqual({ todos: [] })
  })

  test("formatOpen renders one line per open todo plus the summary last", () => {
    const { todos } = aggregateOpen([
      row("s1", [t("a", "pending"), t("b", "completed")]),
      row("s2", [t("c", "in_progress")]),
    ])
    const lines = formatOpen(todos).split("\n")
    expect(lines[0]).toBe("(s1) [high] a")
    expect(lines[1]).toBe("(s2) [high] c")
    expect(lines[lines.length - 1]).toBe("1 open · 1 in progress · 0 done")
  })

  test("formatOpen with no open todos still ends in a summary line", () => {
    const lines = formatOpen([]).split("\n")
    expect(lines[lines.length - 1]).toBe("0 open · 0 in progress · 0 done")
  })
})

describe("RPC contract", () => {
  test("the contract declares the methods and event the plugin uses", () => {
    expect(Todo.id).toBe("todo")
    expect(Object.keys(Todo.methods)).toEqual(["list", "open"])
    expect(Object.keys(Todo.events)).toEqual(["changed"])
  })

  test("a list output row carries exactly the contract's required keys plus optional notes", () => {
    const added = applyMutation(empty, { action: "add", content: "x" }).state
    const item = added.todos[0]
    const schema = (Todo.methods.list.output as any).properties.todos.items
    const required = schema.required as string[]
    const declared = Object.keys(schema.properties).filter((key) => !(required as string[]).includes(key))
    // Required keys are always present; optional keys may be omitted.
    for (const key of required) expect(item).toHaveProperty(key)
    for (const key of Object.keys(item)) expect(schema.properties).toHaveProperty(key)
    expect(declared.sort()).toEqual(["createdAt", "notes", "updatedAt"])
  })

  test("the open method output tags each row with sessionID", () => {
    const schema = (Todo.methods.open.output as any).properties.todos.items
    expect(schema.required.sort()).toEqual(["content", "id", "priority", "sessionID", "status", "updatedAt"])
  })
})
