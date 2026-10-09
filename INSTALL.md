# Install — oc-todo

Two routes. Both entries are bare strings in the `plugins` array of `opencode.jsonc`.

## NPM — stable, slow release

```jsonc
{ "plugins": ["oc-todo@0.4.0"] }
```

Stable default. Use this unless you have a reason not to.

## GITHUB — bleeding edge, experimental

```jsonc
{ "plugins": ["oc-todo@git+https://github.com/nathwn12/oc-todo.git#6fdf78abf3ed08f147eea2e0632ba238898c18dc"] }
```

Experimental, unsupported, may be broken. Every commit is installable, so this route carries unreleased changes.

## Notes

- Mounting by the git spec was MEASURED WORKING for the server half: the host provisions it through npm into `~/.cache/opencode/npm/git-<name>-<hash>/` and loads the entry resolved from `package.json` (`exports["."]`); the host log then records `msg="loading plugin" id=<spec> entrypoint=file:///… role=server`.
- The npm route is unaffected and remains the stable default.
- The TUI half has no direct observation surface in this build (`opencode plugin list` does not report TUI halves for the npm route either), so the TUI half is verified by its visible effect (the sidebar checklist rendering), not by a command.
