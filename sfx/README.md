# SFX — OpenCode Plugin

Plays sound effects for OpenCode session events: agent idle, errors, test failures, and permission requests.

## What it does

- **Idle notification** — plays a sound when the top-level agent finishes and waits for your input (subagent sessions are ignored)
- **Error notification** — plays a sound on session errors
- **Test failure detection** — scans bash tool output for test failure patterns and plays a failure sound
- **Permission requests** — notification ping when the LLM asks for permission

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
  "volume": 1.0,
  "events": {
    "idle": { "enabled": true, "sound": "/System/Library/Sounds/Glass.aiff" },
    "error": { "enabled": true, "sound": "/System/Library/Sounds/Basso.aiff" },
    "testFail": { "enabled": true, "sound": "/System/Library/Sounds/Submarine.aiff" },
    "permission": { "enabled": true, "sound": "/System/Library/Sounds/Ping.aiff" }
  }
}]
```

Plugin options accept:
- `volume` (number) — global volume multiplier from `0` to `1` (default: `1.0`)

Each event config accepts:
- `enabled` (boolean) — whether to play sound (default: `true` for all events)
- `sound` (string) — path to the sound file

### Custom sounds

Override any event sound by setting `sound` in `opencode.jsonc`. Use a relative path for sounds stored in the plugin directory, or an absolute path for sounds anywhere on your system.

```jsonc
["./plugins/sfx", {
  "events": {
    "idle": { "enabled": true, "sound": "./my-sounds/idle.mp3" },
    "error": { "enabled": true, "sound": "/absolute/path/error.wav" },
    "testFail": { "enabled": true, "sound": "./my-sounds/fail.mp3" },
    "permission": { "enabled": true, "sound": "./my-sounds/ping.aiff" }
  }
}]
```

Relative paths are resolved from the plugin directory. Absolute paths work cross-platform too.

## Platform support

| Platform | Player |
|----------|--------|
| macOS | `afplay` (built-in) |
| Linux | `paplay` (PulseAudio) |
| Windows | PowerShell `System.Media.SoundPlayer` |

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
