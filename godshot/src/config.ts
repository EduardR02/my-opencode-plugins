import type { PluginOptions } from "@opencode-ai/plugin";

/**
 * Plugin configuration from opencode.jsonc plugin tuple options.
 * Only `model` is required; everything else has sensible defaults.
 */
export interface GodshotConfig {
  /** Model to use for handoff generation (providerID/modelID, e.g. "openai/gpt-5.5") */
  model: string;
  /** Maximum diff size in approximate tokens (default 64000) */
  maxDiffTokens: number;
  /** Maximum file size in bytes to diff; larger files get metadata only (default 1MB) */
  maxFileBytes: number;
  /** Storage directory for preimages; if relative, resolved against ~/.config/opencode */
  storageDir: string;
}

const DEFAULT_MAX_DIFF_TOKENS = 64000;
const DEFAULT_MAX_FILE_BYTES = 1024 * 1024; // 1 MB
const DEFAULT_STORAGE_DIR = "godshot-preimages";

export function resolveConfig(options?: PluginOptions): GodshotConfig {
  const opts = options ?? {};

  const model = String(opts.model ?? "");
  if (!model) {
    throw new Error(
      "Godshot config error: `model` is required. Set it in opencode.jsonc plugin tuple, e.g. [\"godshot\", { \"model\": \"openai/gpt-5.5\" }]"
    );
  }

  return {
    model,
    maxDiffTokens:
      typeof opts.maxDiffTokens === "number"
        ? opts.maxDiffTokens
        : DEFAULT_MAX_DIFF_TOKENS,
    maxFileBytes:
      typeof opts.maxFileBytes === "number"
        ? opts.maxFileBytes
        : DEFAULT_MAX_FILE_BYTES,
    storageDir:
      typeof opts.storageDir === "string"
        ? opts.storageDir
        : DEFAULT_STORAGE_DIR,
  };
}
