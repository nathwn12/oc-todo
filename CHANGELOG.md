# Changelog

## 0.2.0

Tier 1 slice. Contract change: item shape, tool schema, and RPC.

- **#1 Cross-session list** — new `todo.open` RPC returns every unfinished todo
  across all stored sessions, each tagged with its `sessionID`; a new `open` tool
  action renders it. `todo.list` stays per-session.
- **#2 Move / reorder** — new `move` action with `before` / `after` / `position`
  (id resolved by exact/prefix). Position is clamped after removal; a no-op move
  does not bump `updatedAt`.
- **#3 Notes on an item** — optional `notes: string[]` on `add`, `update`
  (replace; empty clears), and `write`; malformed stored notes are repaired by
  `coerce`; `format` indents them under their item line.
- **#4 Counts summary line** — `format` ends with `3 open · 1 in progress · 2 done`;
  `cancelled` is counted in none of the three.
- Sidebar: each item shows a compact note count when it has notes.
- Tests: 32 -> 61.

## 0.1.2

- A no-op `update` is now correctly reported. Re-supplying a todo's current
  content, status, or priority is reported as `nothing to change` and no longer
  bumps `updatedAt`; a field that genuinely differs still updates.
- Tests: 28 -> 32.

## 0.1.1

- Post-release review pass. No behaviour change for normal use.
- An ambiguous id prefix is refused with a reason instead of silently editing
  the first match; an exact id now always wins over a prefix match.
- Per-session serial queue around read → mutate → write, so concurrent
  code-mode calls cannot drop a mutation.
- Sidebar: a stale failed refresh can no longer blank the session you moved to.
- `package.json` declares `@opencode/plugin` and the OpenTUI/solid-js peers.
- Hardening: malformed stored rows are repaired instead of rejecting the list;
  non-string content can no longer throw or corrupt state; `write` de-duplicates
  a repeated id; no-op mutations no longer rewrite storage or emit `changed`.
- Tests: 15 → 28.

## 0.1.0

- Initial release.
- `todo` tool: `list`, `write` (V1 `todowrite` parity), `add`, `update`,
  `complete`, `clear`.
- Per-session storage under `todos/session/<sessionID>`; survives turns and
  server restarts.
- `todo.list` RPC contract (plain JSON Schema) read by the TUI.
- Sidebar checklist (`tui.tsx`): hides when empty, full list while work
  remains, collapses to `✓ Todos n/n` when every item is closed.
- Dependency-free entrypoints (the stock server runtime does not inject
  `@opencode/plugin` for local directory plugins).
