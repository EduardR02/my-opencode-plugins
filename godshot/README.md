# Godshot — OpenCode Plugin

Canonizes a completed task into a clean forked context with a user-only handoff message. The handoff includes concise LLM-generated task metadata plus real mechanical diffs from lazy first-touch preimages to current file contents.

## What it does

When you type `/godshot` (with an optional hint) in an OpenCode session:

1. **Captures preimages lazily** — the plugin intercepts file modification tools (`edit`, `write`, `patch`) and saves a copy of each file *before* it's first modified in the session. Only the exact file path is ever read; no directory walking occurs.

2. **Generates mechanical diffs** — at handoff time, diffs are computed from stored preimages against the current filesystem state. Diffs are not hallucinated by an LLM.

3. **Forks a clean session** — the current session is forked at the last user message. The handoff is inserted as a **user-only message** (no synthetic assistant acknowledgment) in the forked session. The LLM does not respond until you prompt it.

4. **Budgets token usage** — diffs are truncated to fit a configurable token budget (default 64k tokens).

## Configuration

Add the plugin to your `opencode.jsonc`:

```jsonc
{
  "plugin": [
    ["./plugins/godshot", { "model": "openai/gpt-5.5" }]
  ]
}
```

### Plugin options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `model` | string | **Yes** | — | Model used for metadata generation (providerID/modelID) |
| `maxDiffTokens` | number | No | `64000` | Maximum tokens for diff content before truncation |
| `maxFileBytes` | number | No | `1048576` (1 MB) | Skip preimage capture for files larger than this |
| `storageDir` | string | No | `godshot-preimages` | Directory for storing preimages (relative to `~/.config/opencode`) |

## Usage

In any OpenCode session, type:

```
/godshot "Add user authentication"
```

The hint is optional but helps document the task. The plugin will:

1. Display a summary in the current session with the forked session ID
2. Place the full handoff in the forked session as a user-only message

## Safety

- **No whole-workspace snapshots.** Only individual files touched by `edit`/`write`/`patch` are captured.
- **No directory traversal.** Paths are validated to be regular files within the worktree before any read.
- **No git dependency.** Does not create commits, stashes, or branches.
- **Binary/large file safety.** Files > `maxFileBytes` or containing null bytes are captured as metadata-only; their contents are never stored.
- **Hashed filenames.** Preimages are stored with SHA256-hashed filenames to prevent path traversal in storage.

## Limitations / TODOs

- **LLM curation is best-effort.** The plugin creates a scratch session with the configured model and prompts it to produce structured task metadata from the conversation transcript and file summary. If the model call fails or returns empty text, it falls back to programmatic metadata extracted from message summaries. The scratch session is always cleaned up.
- **Session auto-switching.** After a successful fork, the plugin attempts to switch the TUI to the forked session automatically. If the auto-switch fails (e.g., unsupported server version), the forked session ID is still printed for manual navigation.
- **Preimage capture is tool-name dependent.** The plugin intercepts tools named `edit`, `write`, and `patch`. If OpenCode uses different tool names for file modification, preimages will not be captured. File path extraction from args uses common field names (`filePath`, `path`, `file`, `filename`).
- **Diff algorithm is simple line-based LCS.** For very large files (>10M line pairs), the diff falls back to a simpler line-by-line comparison.

## Architecture

```
godshot/
├── src/
│   ├── index.ts      Plugin entry — registers hooks
│   ├── config.ts     Configuration parsing and defaults
│   ├── storage.ts    Lazy first-touch preimage store
│   ├── diff.ts       Diff generation and token budgeting
│   └── command.ts    /godshot command handler
├── tests/
│   ├── storage.test.ts
│   ├── diff.test.ts
│   └── command.test.ts
├── package.json
├── tsconfig.json
└── README.md
```

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Type check
bun x tsc --noEmit
```
