# SFX — OpenCode Plugin

Plays sound effects for OpenCode session events: agent idle, errors, test failures, and permission requests.

## What it does

- **Idle notification** — plays a sound when the top-level agent finishes and waits for your input (subagent sessions are ignored)
- **Error notification** — plays a sound on session errors
- **Test failure detection** — scans bash tool output for test failure patterns and plays a failure sound
- **Permission requests** — optional notification ping when the LLM asks for permission

## Configuration

Add the plugin to your `opencode.jsonc`:

```jsonc
{
  "plugin": [
    ["./plugins/sfx"]
  ]
}
```

### Plugin options

All options are optional. Defaults use macOS system sounds:

```jsonc
["./plugins/sfx", {
  "events": {
    "idle": { "enabled": true, "sound": "/System/Library/Sounds/Glass.aiff" },
    "error": { "enabled": true, "sound": "/System/Library/Sounds/Basso.aiff" },
    "testFail": { "enabled": true, "sound": "/System/Library/Sounds/Submarine.aiff" },
    "permission": { "enabled": false, "sound": "/System/Library/Sounds/Ping.aiff" }
  }
}]
```

Each event config accepts:
- `enabled` (boolean) — whether to play sound (default: `true` for idle/error/testFail, `false` for permission)
- `sound` (string) — path to the sound file

## Platform support

| Platform | Player |
|----------|--------|
| macOS | `afplay` (built-in) |
| Linux | `paplay` (PulseAudio), fallback to `aplay` (ALSA), fallback to terminal bell |
| Windows | PowerShell `Media.SoundPlayer`, fallback to terminal bell |

Missing sound files log a warning and don't crash.

## Architecture

```
sfx/
├── src/
│   ├── index.ts      Plugin entry — registers hooks
│   ├── config.ts     Configuration parsing and defaults
│   ├── sound.ts      Cross-platform sound player
│   └── detectors.ts  Test failure detection logic
├── package.json
├── tsconfig.json
└── README.md
```
