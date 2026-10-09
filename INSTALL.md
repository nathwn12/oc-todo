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

## NO-NPM (directory entry)

```jsonc
{ "plugins": ["<path to repo - a local clone of this repository>"] }
```

Point the plugin entry at a local clone of this repo. Once pushed, the non-local form is
`github:nathwn12/oc-todo@6fab39cef3986d8330871f7425cc2567f536a563` - pending live
verification, not yet verified.

This route needs the repo's `index.ts` and involves no npm install. It is the mechanism
superpowers uses.

## Notes

- Mounting by the git spec was MEASURED WORKING for the server half: the host provisions it through npm into `~/.cache/opencode/npm/git-<name>-<hash>/` and loads the entry resolved from `package.json` (`exports["."]`); the host log then records `msg="loading plugin" id=<spec> entrypoint=file:///… role=server`.
- The npm route is unaffected and remains the stable default.
- The TUI half has no direct observation surface in this build (`opencode plugin list` does not report TUI halves for the npm route either), so the TUI half is verified by its visible effect (the sidebar checklist rendering), not by a command.
