# oc-todo — roadmap

Owner-approved improvement inventory. Source: IDEA/THINKER pass 2026-10-05.
Repo: `Q:\PROJECTS\PERSONAL\oc-todo` (github.com/nathwn12/oc-todo). Golden baseline: v0.1.2.

## Tier 1 — DONE (v0.2.0 → v0.2.3, released + CERTIFIED GOLDEN 2026-10-05)

Shipped: #1 cross-session open, #2 move/reorder, #3 notes, #4 counts summary.
Review/fix history: v0.2.0 blocked (H1 move single-selector) -> v0.2.1; Low polish -> v0.2.2;
certification found non-finite-timestamp `coerce` gap -> v0.2.3.
Certification (isolated, adversarial, cleaned up): 120/120 pass (70 unit + 50 edge/fuzz), 0 fail.
Live ERIS proof on v0.2.3: add+notes, move reorder, H1 refusal, no-op summary, cross-session
`open` across 5 sessions — all correct. `bun run check` = 70 tests + tsc clean.
npm 0.2.3; GitHub Release v0.2.3; local plugin 0.2.3.

## Tier 2 — saved, TBA

- **#5 Bulk operations** — ids-array (`"all"` / `["a","b"]`) for complete/update, plus `--dry-run`.
- **#6 Status transitions with rules** — explicit `reopen`; advisory warning when moving to
  `in_progress` while a predecessor is open. Never blocking.
- **#7 Export/import** — markdown checklist + JSON; makes the list portable and git-friendly.
- **#8 TUI interactivity** — keyboard selection, toggle-complete-in-place, jump-to-item.

## Tier 3 — saved, later

- **#9 Storage hygiene** — manual `prune` for lists older than N days (never auto-prune).
- **#10 `list` filters** — status, priority, has-notes, assigned-agents.
- **#11 RPC parity** — `todo.counts`, `todo.export` on the RPC surface the TUI consumes.
- **#12 Relative timestamps** in `format` ("2h ago" for `updatedAt`).

## Explicitly NOT doing

- Auto-computed n / agent counts — oc-todo stores, never decides (owner rejected 2026-10-05).
- Notifications / runtime nudging — plugin-shaped; the `oc-scribe` plugin was parked for the
  same over-reach. Keep oc-todo storage + render.
- Time tracking / estimates; sync / cloud (host SQLite is the sync boundary).

## Recommended v0.2.0 slice

Tier 1 wholesale (#1 + #2 + #3 + #4) — the biggest usefulness jump per unit of risk.
