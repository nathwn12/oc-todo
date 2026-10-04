import { describe, expect, test } from "bun:test"
import { applyMutation, coerce, findTodo, format } from "../index.js"
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
    expect(format(state)).toBe("[x] (z1) [low] done")
  })

  test("each status has a distinct mark", () => {
    const mk = (status: string) => ({ id: "i", content: "c", status, priority: "medium", createdAt: 0, updatedAt: 0 })
    const state = { version: 1 as const, todos: ["pending", "in_progress", "completed", "cancelled"].map(mk) as any[] }
    const lines = format(state).split("\n")
    expect(lines.map((l) => l.slice(0, 3))).toEqual(["[ ]", "[~]", "[x]", "[-]"])
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

describe("RPC contract", () => {
  test("a list output row carries exactly the contract's required keys", () => {
    const added = applyMutation(empty, { action: "add", content: "x" }).state
    const item = added.todos[0]
    const schema = (Todo.methods.list.output as any).properties.todos.items
    const required = schema.required as string[]
    const declared = Object.keys(schema.properties)
    expect(Object.keys(item).sort()).toEqual([...declared].sort())
    for (const key of required) expect(item).toHaveProperty(key)
  })

  test("the contract declares the method and event the plugin uses", () => {
    expect(Todo.id).toBe("todo")
    expect(Object.keys(Todo.methods)).toEqual(["list"])
    expect(Object.keys(Todo.events)).toEqual(["changed"])
  })
})
