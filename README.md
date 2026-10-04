# oc-todo (OpenCode V2 plugin)

Restores a V1-style per-session todo/checklist to OpenCode V2, backed by **real
plugin storage** (not a decorative widget).

## What it is

- **`todo` tool** (server plugin): `list`, `add`, `update`, `complete`, and
  `clear`. Every mutation writes the session's list to plugin storage; every read
  returns exactly what is stored. The list is keyed by session id, so it is
  scoped to the calling session and survives across turns and restarts.
- **`todo.list` RPC**: a read-only contract shared with the CLI side.
- **`tui.tsx` CLI plugin**: a read-only checklist renderer in the sidebar over the
  stored state (via RPC). Refreshes on `rpc.todo.changed`, with a slow poll fallback.

## Layout

A local directory plugin is resolved by **filename at the plugin root** — the
`package.json` `exports` map is only consulted for installed (named) packages,
so the entries must sit at the root:

```
index.ts         server plugin: the `todo` tool + the RPC implementation
tui.tsx          CLI plugin: sidebar checklist renderer
contract.ts      shared RPC contract (plain JSON Schema, no bare imports)
package.json     exports "." -> index.ts, "./tui" -> tui.tsx
```

Both entrypoints are deliberately dependency-free at load time. On the stock
binary the server runtime does not resolve the bare `@opencode/plugin` specifier
for a local directory plugin, so `index.ts` exports a plain `{ id, setup }`
definition (`Plugin.define` is an identity helper) and the shared contract is a
plain object (`Rpc.define` is an identity helper). The TUI entry keeps
`@opencode/plugin/tui`, which the TUI runtime does inject.

## Load

Auto-discovered as a directory under a config root's `plugin/`/`plugins/` folder
(one level, non-recursive). The server side loads from `index.ts`; the TUI side
loads from `tui.tsx`. It can also be listed directly:

- `cli.json` `plugins` wires the **TUI** entry (`"./plugins/oc-todo"`).
- `opencode.jsonc` `plugins` wires the **server** entry (or rely on the
  `plugins/` directory auto-discovery).

There is no recursive directory scan in V2; a `"directory"` config key has no
effect. Only direct children of `plugins/` are discovered.

## Wire format

```jsonc
{ "version": 1, "todos": [
  { "id": "m1a2b", "content": "write docs", "status": "pending",
    "priority": "medium", "createdAt": 0, "updatedAt": 0 }
] }
```

`status`: `pending` | `in_progress` | `completed` | `cancelled`
`priority`: `high` | `medium` | `low`

## Storage

Plugin storage under `todos/session/<sessionID>` (in `~/.local/share/opencode`).
