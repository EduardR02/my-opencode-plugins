import * as path from "node:path";
import { type PluginInput, type Hooks, type PluginOptions } from "@opencode-ai/plugin";
import { resolveConfig, type GodshotConfig } from "./config.js";
import { PreimageStore } from "./storage.js";
import { executeGodshot } from "./command.js";

/**
 * Godshot plugin for OpenCode.
 *
 * Provides a `/godshot` command that canonizes the current completed task
 * by creating a forked clean context with a user-only handoff message
 * containing LLM-generated task metadata and mechanical diffs from
 * lazy first-touch preimages.
 */
export const server = async (
  input: PluginInput,
  options?: PluginOptions
): Promise<Hooks> => {
  const config = resolveConfig(options);
  const { client, worktree } = input;

  // Resolve storage directory
  const storageDir = path.isAbsolute(config.storageDir)
    ? config.storageDir
    : path.join(
        resolveOpenCodeHome(input.directory),
        config.storageDir
      );

  const store = new PreimageStore(storageDir);

  // Track which tools perform file modifications (first-touch capture)
  const FILE_MODIFICATION_TOOLS = new Set(["edit", "write", "patch"]);

  // Track which sessions are active (for cleanup)
  const activeSessions = new Set<string>();

  return {
    /**
     * Intercept /godshot commands.
     */
    "command.execute.before": async (hookInput, output) => {
      const { command, sessionID, arguments: argsStr } = hookInput;

      // Only handle /godshot commands
      if (command !== "godshot") return;

      // Parse optional hint from arguments
      const hint = (argsStr ?? "").trim();

      try {
        const summary = await executeGodshot(
          client,
          store,
          config,
          sessionID,
          worktree,
          hint
        );

        // Return the summary as a text part in the current session
        output.parts = [
          {
            id: `godshot-${Date.now()}`,
            sessionID,
            messageID: "",
            type: "text",
            text: summary,
          } as any,
        ];
      } catch (err: any) {
        output.parts = [
          {
            id: `godshot-error-${Date.now()}`,
            sessionID,
            messageID: "",
            type: "text",
            text: `## Godshot error\n\nFailed to execute godshot: ${err.message}\n\nPlease check the plugin configuration and try again.`,
          } as any,
        ];
      }
    },

    /**
     * Capture lazy first-touch preimages before file-modification tools execute.
     */
    "tool.execute.before": async (hookInput, output) => {
      const { tool, sessionID } = hookInput;

      // Only care about file modification tools
      if (!FILE_MODIFICATION_TOOLS.has(tool)) return;

      // Get the file path from the tool args
      const args = output.args;
      if (!args || typeof args !== "object") return;

      const filePath = extractFilePath(tool, args);
      if (!filePath) return;

      // Track session
      activeSessions.add(sessionID);

      // Resolve to absolute path
      const absPath = path.resolve(worktree, filePath);

      // Capture preimage (does nothing if already captured)
      try {
        await store.captureIfNeeded(
          sessionID,
          worktree,
          absPath,
          config.maxFileBytes
        );
      } catch {
        // Silent failure; preimage capture is best-effort
      }

      // Don't modify args
    },

    /**
     * Clean up preimages when a session is deleted.
     */
    event: async (eventInput) => {
      const evt = eventInput.event as { type?: string; properties?: { info?: { id: string } } };
      if (evt.type === "session.deleted" && evt.properties?.info?.id) {
        const sessionID = evt.properties.info.id;
        if (activeSessions.has(sessionID)) {
          await store.removeSession(sessionID);
          activeSessions.delete(sessionID);
        }
      }
    },
  };
};

/**
 * Extract the file path from tool-specific args.
 * Different tools use different field names.
 */
function extractFilePath(
  tool: string,
  args: Record<string, unknown>
): string | null {
  // Common patterns:
  // - edit/write: { filePath: "..." }
  // - patch: { filePath: "..." }
  const candidates = ["filePath", "path", "file", "filename"];

  // First try exact field name matches
  for (const key of candidates) {
    if (typeof args[key] === "string" && args[key]) {
      return args[key] as string;
    }
  }

  // Some tools nest paths in operations array
  if (tool === "patch" && Array.isArray(args["operations"])) {
    const ops = args["operations"] as Array<Record<string, unknown>>;
    for (const op of ops) {
      for (const key of candidates) {
        if (typeof op[key] === "string" && op[key]) {
          return op[key] as string;
        }
      }
    }
  }

  return null;
}

/**
 * Resolve the OpenCode home directory from a known config path.
 * Falls back to ~/.config/opencode.
 */
function resolveOpenCodeHome(hintDir: string): string {
  // hintDir is typically the project directory from PluginInput
  // We resolve ~/.config/opencode as the default
  const home = process.env.HOME || process.env.USERPROFILE || "/tmp";
  const defaultPath = path.join(home, ".config", "opencode");
  return defaultPath;
}

/**
 * Metadata for the plugin module.
 */
const id = "godshot";

export default server;
