# Changelog

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
