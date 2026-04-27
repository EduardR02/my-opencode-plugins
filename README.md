# OpenCode Plugins

Personal plugins for OpenCode.

## Plugins

- **sfx** — Sound effects for session events (idle, errors, test failures, permissions)
- **godshot** — Canonize completed tasks into clean forked contexts

## Usage

Add to `opencode.jsonc`:
```jsonc
"plugin": [
  "./plugins/sfx",
  ["./plugins/godshot", { "model": "deepseek/deepseek-v4-pro" }]
]
```
