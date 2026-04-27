import type { PluginOptions } from "@opencode-ai/plugin";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Get the plugin's own root directory (parent of src/)
const pluginDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Per-event configuration.
 */
export interface SoundEventConfig {
  /** Whether the sound effect is enabled. */
  enabled: boolean;
  /** Path to the sound file to play. */
  sound: string;
}

/**
 * Plugin configuration from opencode.jsonc plugin tuple options.
 * All fields are optional; sensible defaults are provided (sounds ship with the plugin).
 */
export interface SfxConfig {
  events: {
    idle: SoundEventConfig;
    error: SoundEventConfig;
    testFail: SoundEventConfig;
    permission: SoundEventConfig;
  };
}

/** Default sound files shipped in the plugin's own sounds/ directory. */
const DEFAULT_SOUNDS = {
  idle: "./sounds/idle.mp3",
  error: "./sounds/error.mp3",
  testFail: "./sounds/test-fail.mp3",
  permission: "./sounds/permission.mp3",
} as const;

/** Default enabled states. */
const DEFAULT_ENABLED = {
  idle: true,
  error: true,
  testFail: true,
  permission: false,
} as const;

/**
 * Resolve a sound path. If absolute, use as-is. If relative, resolve against plugin directory.
 */
function resolveSoundPath(sound: string): string {
  if (path.isAbsolute(sound)) return sound;
  return path.resolve(pluginDir, sound);
}

/**
 * Resolve user config against defaults. Handles undefined/missing options gracefully.
 */
export function resolveConfig(options?: PluginOptions): SfxConfig {
  const eventsOpt = (options?.events as Record<string, unknown>) ?? {};

  return {
    events: {
      idle: resolveEventConfig(eventsOpt["idle"], {
        enabled: DEFAULT_ENABLED.idle,
        sound: resolveSoundPath(DEFAULT_SOUNDS.idle),
      }),
      error: resolveEventConfig(eventsOpt["error"], {
        enabled: DEFAULT_ENABLED.error,
        sound: resolveSoundPath(DEFAULT_SOUNDS.error),
      }),
      testFail: resolveEventConfig(eventsOpt["testFail"], {
        enabled: DEFAULT_ENABLED.testFail,
        sound: resolveSoundPath(DEFAULT_SOUNDS.testFail),
      }),
      permission: resolveEventConfig(eventsOpt["permission"], {
        enabled: DEFAULT_ENABLED.permission,
        sound: resolveSoundPath(DEFAULT_SOUNDS.permission),
      }),
    },
  };
}

function resolveEventConfig(
  raw: unknown,
  defaults: SoundEventConfig,
): SoundEventConfig {
  if (raw === null || raw === undefined || typeof raw !== "object") {
    return { ...defaults };
  }

  const obj = raw as Record<string, unknown>;

  return {
    enabled:
      typeof obj.enabled === "boolean" ? obj.enabled : defaults.enabled,
    sound:
      typeof obj.sound === "string" && obj.sound.length > 0
        ? resolveSoundPath(obj.sound)
        : defaults.sound,
  };
}
