import type { OpencodeClient, Message } from "@opencode-ai/sdk";
import type { GodshotConfig } from "./config.js";
import type { DiffSet } from "./diff.js";
import { approxTokens } from "./diff.js";

/** Lightweight message wrapper from the real session. */
type MsgEntry = {
  info: Message;
  parts: Array<unknown>;
};

/** Parsed model identifier. */
export interface ParsedModel {
  providerID: string;
  modelID: string;
}

/**
 * Parse a model string like `"openai/gpt-5.5"` into providerID and modelID.
 * Throws if the format is invalid.
 */
export function parseModelString(model: string): ParsedModel {
  const trimmed = model.trim();
  if (!trimmed) {
    throw new Error("Model string is empty");
  }
  const slashIdx = trimmed.indexOf("/");
  if (slashIdx <= 0) {
    throw new Error(
      `Invalid model string "${trimmed}": expected format "providerID/modelID" (e.g. "openai/gpt-5.5")`
    );
  }
  const providerID = trimmed.slice(0, slashIdx);
  const modelID = trimmed.slice(slashIdx + 1);
  if (!providerID || !modelID) {
    throw new Error(
      `Invalid model string "${trimmed}": both providerID and modelID must be non-empty`
    );
  }
  return { providerID, modelID };
}

/**
 * Build a bounded transcript from real session messages for the curation prompt.
 * Truncates very long messages to keep the prompt manageable.
 */
function buildBoundedTranscript(messages: MsgEntry[], hint: string): string {
  const MAX_TRANSCRIPT_CHARS = 16000;
  const lines: string[] = [];

  // Collect a condensed version of the conversation
  const recentMessages = messages.slice(-30); // last 30 messages

  for (const msg of recentMessages) {
    const role = msg.info.role ?? "unknown";
    const text = extractTextFromParts(msg.parts);
    const header = `[${role.toUpperCase()}]`;
    if (text) {
      const truncated = text.length > 2000 ? text.slice(0, 2000) + "..." : text;
      lines.push(`${header} ${truncated}`);
    } else {
      const summaryTitle = getMessageTitle(msg.info);
      lines.push(
        summaryTitle
          ? `${header} [task: ${summaryTitle}]`
          : `${header} [no text content]`
      );
    }
  }

  // Check total length and trim if needed
  let transcript = lines.join("\n");
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    transcript = transcript.slice(0, MAX_TRANSCRIPT_CHARS) + "\n...[transcript truncated]";
  }

  return transcript;
}

/**
 * Extract text from message parts.
 */
function extractTextFromParts(parts: Array<unknown>): string {
  if (!Array.isArray(parts)) return "";
  const texts: string[] = [];
  for (const part of parts) {
    if (
      part &&
      typeof part === "object" &&
      "type" in part &&
      (part as any).type === "text" &&
      typeof (part as any).text === "string"
    ) {
      texts.push((part as any).text);
    }
  }
  return texts.join(" ").trim();
}

/**
 * Extract a human-readable summary title from a message, if available.
 */
function getMessageTitle(info: Message): string | undefined {
  if (info.role !== "user") return undefined;
  const summary = info.summary;
  if (summary && typeof summary === "object" && "title" in summary) {
    return summary.title;
  }
  return undefined;
}

/**
 * Build a concise file summary (list + stats) for the curation prompt.
 * Avoids sending huge raw diffs to the curation model.
 */
function buildFileSummary(diffSet: DiffSet): string {
  if (diffSet.results.length === 0) {
    return "(No files were modified in this session.)";
  }

  const lines: string[] = [];
  const modified = diffSet.results.filter(
    (r) => r.kind === "diff"
  ).length;
  const created = diffSet.results.filter(
    (r) => r.kind === "new-file"
  ).length;
  const deleted = diffSet.results.filter(
    (r) => r.kind === "deleted"
  ).length;
  const others = diffSet.results.length - modified - created - deleted;

  lines.push(`${diffSet.results.length} total file(s) tracked:`);
  lines.push(`  - Modified: ${modified}`);
  lines.push(`  - Created: ${created}`);
  lines.push(`  - Deleted: ${deleted}`);
  if (others > 0) lines.push(`  - Other (unchanged/error/etc): ${others}`);
  lines.push(`  - Diff content size: ~${approxTokens(diffSet.totalChars)} tokens`);
  lines.push("");

  lines.push("Files:");
  for (const r of diffSet.results) {
    const kindLabel = {
      diff: "modified",
      "new-file": "created",
      deleted: "deleted",
      unchanged: "unchanged",
      "too-large": "too large",
      binary: "binary",
      "missing-preimage": "no preimage",
      error: "error",
    }[r.kind];
    lines.push(`  - \`${r.relPath}\` (${kindLabel})`);
  }

  return lines.join("\n");
}

/**
 * Build the system and user prompt for the curation LLM call.
 */
function buildCurationPrompt(
  messages: MsgEntry[],
  hint: string,
  diffSet: DiffSet
): { system: string; user: string } {
  const transcript = buildBoundedTranscript(messages, hint);
  const fileSummary = buildFileSummary(diffSet);

  const system = `You are a concise task summarization assistant for a development tool called godshot.
Your job is to produce structured metadata for a task handoff based on the conversation transcript and file changes provided.
You must ONLY respond with plain text. No markdown headers, no tool calls, no code blocks, no reasoning tags.
Keep each section brief and factual. Do not hallucinate or invent information not present in the transcript.

The output should follow this exact format:

OBJECTIVE: [1-2 sentences describing what the user wanted to accomplish]
REQUIREMENTS/CORRECTIONS: [key requirements, corrections, or constraints mentioned in the conversation — bullet points prefixed with -, or "None noted"]
DECISIONS: [key design or implementation decisions made — bullet points prefixed with -, or "None noted"]
IMPORTANT NOTES: [important notes, warnings, or context for continuing work — bullet points prefixed with -, or "None noted"]
VERIFICATION: [whether there is evidence the task was verified/tested, or "Not seen in transcript"]
RELEVANT FILES: [list of files that are most relevant to the task, based on the file changes and conversation — bullet points prefixed with -]

Respond ONLY with the metadata in the format above. Do not include any other text.`;

  const userParts: string[] = [];
  userParts.push("## Conversation transcript (condensed)");
  userParts.push("");
  userParts.push(transcript);
  userParts.push("");
  userParts.push("## File changes summary");
  userParts.push("");
  userParts.push(fileSummary);

  if (hint) {
    userParts.push("");
    userParts.push("## Additional context from user");
    userParts.push("");
    userParts.push(hint);
  }

  userParts.push("");
  userParts.push(
    "Based on the conversation and file changes above, produce the structured metadata for the handoff."
  );

  return { system, user: userParts.join("\n") };
}

/**
 * Use the configured model to curate the handoff metadata.
 *
 * Creates a temporary scratch session, prompts the model with the curated
 * transcript and file summary, extracts the text response, and cleans up.
 *
 * Returns the curated text on success, or `null` if curation fails
 * (in which case the caller should fall back to the programmatic summary).
 */
export async function curateHandoff(
  client: OpencodeClient,
  config: GodshotConfig,
  messages: MsgEntry[],
  hint: string,
  diffSet: DiffSet
): Promise<string | null> {
  let scratchSessionID: string | null = null;

  try {
    // 1. Parse model string
    const parsedModel = parseModelString(config.model);

    // 2. Build the curation prompt
    const { system, user } = buildCurationPrompt(messages, hint, diffSet);

    // 3. Create a scratch session
    const createResult = await client.session.create({});

    if (!createResult.data) {
      return null;
    }

    const session = createResult.data;
    scratchSessionID = session.id;

    // 4. Prompt the scratch session with the curation task
    //    Use `tools: {}` so the model can only respond textually
    const promptResult = await client.session.prompt({
      path: { id: scratchSessionID },
      body: {
        model: {
          providerID: parsedModel.providerID,
          modelID: parsedModel.modelID,
        },
        system,
        tools: {},
        parts: [
          {
            type: "text",
            text: user,
          },
        ],
      },
    });

    if (!promptResult.data) {
      return null;
    }

    // 5. Extract text parts from the response
    const response = promptResult.data;
    const parts = response.parts ?? [];

    const textParts: string[] = [];
    for (const part of parts) {
      if (part && part.type === "text" && typeof (part as any).text === "string") {
        textParts.push((part as any).text);
      }
    }

    const curatedText = textParts.join("\n").trim();
    if (!curatedText) {
      return null;
    }

    return curatedText;
  } catch {
    // Curation failed — caller will fall back to programmatic summary
    return null;
  } finally {
    // 6. Always clean up the scratch session
    if (scratchSessionID) {
      try {
        await client.session.delete({ path: { id: scratchSessionID } });
      } catch {
        // Best-effort cleanup
      }
    }
  }
}
