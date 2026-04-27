import { type PluginInput, type Hooks, type PluginOptions } from "@opencode-ai/plugin";
import { resolveConfig, type SfxConfig } from "./config.js";
import { playSound } from "./sound.js";
import { containsTestFailure } from "./detectors.js";



/**
 * Sound effects plugin for OpenCode.
 *
 * Plays system sounds for:
 * - Top-level agent idle (waiting for user input)
 * - Session errors
 * - Test failures (detected from bash tool output)
 * - Permission requests (optional, disabled by default)
 */
export const server = async (
  input: PluginInput,
  options?: PluginOptions,
): Promise<Hooks> => {
  const config = resolveConfig(options);
  const { client } = input;

  // Debounce state: prevent replaying idle sound for the same session
  // within a short window (3 seconds).
  const idleCooldowns = new Map<string, number>();
  const IDLE_COOLDOWN_MS = 3000;

  // Suppress idle sound after an error in the same session (e.g., Escape interrupt)
  const recentErrors = new Map<string, number>();
  const ERROR_SUPPRESS_MS = 2000;

  return {
    /**
     * Listen for session events.
     */
    event: async (eventInput) => {
      const evt = eventInput.event;

      // Handle permission events
      if (
        (evt.type as string) === "permission.asked"
      ) {
        if (config.events.permission.enabled) {
          const perm = evt.properties as { permission?: string; sessionID: string };
          playSound(config.events.permission.sound);
        }
        return;
      }

      switch (evt.type) {
        case "session.idle": {
          if (!config.events.idle.enabled) return;

          const sessionID = evt.properties.sessionID;
          if (!sessionID) return;

          // Deduplicate: skip if this session recently triggered idle
          const last = idleCooldowns.get(sessionID);
          if (last && Date.now() - last < IDLE_COOLDOWN_MS) return;

          // Suppress idle if this session recently had an error (e.g., user interrupted)
          const lastError = recentErrors.get(sessionID);
          if (lastError && Date.now() - lastError < ERROR_SUPPRESS_MS) {
            recentErrors.delete(sessionID);
            return;
          }

          // Only play for top-level sessions (no parentID)
          try {
            const result = await client.session.get({
              path: { id: sessionID },
            });
            const session = result.data;

            if (!session || session.parentID) {
              // Subagent session — skip
              return;
            }

            idleCooldowns.set(sessionID, Date.now());
            playSound(config.events.idle.sound);
          } catch {
          }
          break;
        }

        case "session.error": {
          if (!config.events.error.enabled) return;

          // Record the error so idle is suppressed for this session
          recentErrors.set(evt.properties.sessionID ?? "", Date.now());

          // User-initiated interrupt (Escape) — skip error sound
          const err = evt.properties.error;
          if (err && (err as any).name === "MessageAbortedError") return;

          playSound(config.events.error.sound);
          break;
        }

        default: {
          // Log other event types at trace level for debugging
          break;
        }
      }
    },

    /**
     * Detect test failures from bash tool output.
     */
    "tool.execute.after": async (hookInput, output) => {


      if (!config.events.testFail.enabled) return;

      const SHELL_TOOLS = new Set(["bash", "shell", "exec", "run", "command"]);
      if (!SHELL_TOOLS.has(hookInput.tool)) return;

      const metadata =
        output.metadata != null &&
        typeof output.metadata === "object" &&
        !Array.isArray(output.metadata)
          ? (output.metadata as Record<string, unknown>)
          : undefined;

      if (containsTestFailure(output.output, metadata, hookInput.args || output.args)) {
        playSound(config.events.testFail.sound);
      }
    },
  };
};

/**
 * Metadata for the plugin module.
 */
const id = "sfx";

export default server;
