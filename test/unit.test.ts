import { describe, expect, test } from "bun:test"
import { applyMutation, format } from "../index.js"

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
