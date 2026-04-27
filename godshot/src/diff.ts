import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { Preimage, PreimageSkipped } from "./storage.js";

/**
 * Result of diffing a single file from preimage to current state.
 */
export interface FileDiffResult {
  /** Relative path from worktree */
  relPath: string;
  /** Whether this is a real diff or metadata-only */
  kind:
    | "diff"
    | "missing-preimage"
    | "too-large"
    | "binary"
    | "new-file"
    | "deleted"
    | "unchanged"
    | "error";
  /** Unified diff text (if kind === "diff") */
  diffText?: string;
  /** Current file size in bytes */
  currentSize: number;
  /** Preimage size in bytes (0 if didn't exist) */
  preimageSize: number;
  /** Error message if kind === "error" */
  error?: string;
}

export interface DiffSet {
  results: FileDiffResult[];
  totalChars: number;
}

/**
 * Approximate token count from character count.
 * Conservative estimate: ~2.5 chars per token for code.
 */
const CHARS_PER_TOKEN = 2.5;

export function approxTokens(charCount: number): number {
  return Math.ceil(charCount / CHARS_PER_TOKEN);
}

// ─── Diff algorithm ────────────────────────────────────────────────

/**
 * Compute the Longest Common Subsequence using the standard DP algorithm.
 * Falls back to empty LCS for very large inputs to avoid O(m*n) blowup.
 */
function computeLCS(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;

  // Safety limit: ~10M cells max
  if (m * n > 10_000_000) {
    return [];
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp;
}

/**
 * Edit operation in a diff script.
 */
type Edit =
  | { type: "keep"; line: string; oldLine: number; newLine: number }
  | { type: "del"; line: string; oldLine: number }
  | { type: "add"; line: string; newLine: number };

/**
 * Backtrack through LCS table to produce an edit script.
 */
function backtrackEdits(
  a: string[],
  b: string[],
  dp: number[][]
): Edit[] {
  const edits: Edit[] = [];
  let i = a.length;
  let j = b.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      edits.push({ type: "keep", line: a[i - 1], oldLine: i, newLine: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      edits.push({ type: "add", line: b[j - 1], newLine: j });
      j--;
    } else {
      edits.push({ type: "del", line: a[i - 1], oldLine: i });
      i--;
    }
  }

  edits.reverse();
  return edits;
}

/**
 * Group edits into hunks. A hunk contains all edits with context lines
 * (up to 3 lines of surrounding context).
 */
function editsToHunks(edits: Edit[]): Array<{
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}> {
  const CONTEXT = 3;
  const hunks: Array<{
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
    lines: string[];
  }> = [];

  // Find runs of non-keep edits, then extend with context
  const changeIndices: number[] = [];
  for (let i = 0; i < edits.length; i++) {
    if (edits[i].type !== "keep") {
      changeIndices.push(i);
    }
  }

  if (changeIndices.length === 0) return hunks;

  // Expand each change index to include surrounding context
  const included = new Set<number>();
  for (const ci of changeIndices) {
    for (let d = -CONTEXT; d <= CONTEXT; d++) {
      const idx = ci + d;
      if (idx >= 0 && idx < edits.length) {
        included.add(idx);
      }
    }
  }

  // Group consecutive included indices into hunks
  const sorted = [...included].sort((a, b) => a - b);
  let hunkStart = sorted[0];
  let hunkLines: string[] = [];
  let oldLines = 0;
  let newLines = 0;
  let firstOld = 0;
  let firstNew = 0;

  for (let i = 0; i < sorted.length; i++) {
    const idx = sorted[i];
    if (i > 0 && idx !== sorted[i - 1] + 1) {
      // Gap — flush current hunk
      hunks.push({
        oldStart: firstOld,
        oldCount: oldLines,
        newStart: firstNew,
        newCount: newLines,
        lines: hunkLines,
      });
      hunkLines = [];
      oldLines = 0;
      newLines = 0;
    }

    const edit = edits[idx];
    if (hunkLines.length === 0) {
      firstOld = edit.type === "add" ? (edits[idx - 1]?.type === "keep" ? (edits[idx - 1] as { oldLine: number }).oldLine + 1 : Math.max(1, edit.newLine)) : (edit as { oldLine: number }).oldLine;
      firstNew = edit.type === "del" ? (edits[idx - 1]?.type === "keep" ? (edits[idx - 1] as { newLine: number }).newLine + 1 : Math.max(1, edit.oldLine)) : (edit as { newLine: number }).newLine;
    }

    switch (edit.type) {
      case "keep":
        hunkLines.push(` ${edit.line}`);
        oldLines++;
        newLines++;
        break;
      case "del":
        hunkLines.push(`-${edit.line}`);
        oldLines++;
        break;
      case "add":
        hunkLines.push(`+${edit.line}`);
        newLines++;
        break;
    }
  }

  if (hunkLines.length > 0) {
    hunks.push({
      oldStart: firstOld,
      oldCount: oldLines,
      newStart: firstNew,
      newCount: newLines,
      lines: hunkLines,
    });
  }

  return hunks;
}

/**
 * Generate a unified diff string between two file contents.
 */
function generateUnifiedDiff(
  relPath: string,
  before: string,
  after: string
): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");

  // Fast path: identical
  if (before === after) return "";

  // For single-line files, do a trivial diff
  if (beforeLines.length <= 1 && afterLines.length <= 1) {
    const lines: string[] = [];
    lines.push(`--- a/${relPath}`);
    lines.push(`+++ b/${relPath}`);
    lines.push(`@@ -1,${beforeLines.length} +1,${afterLines.length} @@`);
    if (before !== after) {
      if (before) lines.push(`-${before}`);
      if (after) lines.push(`+${after}`);
    }
    return lines.join("\n");
  }

  const dp = computeLCS(beforeLines, afterLines);

  // If LCS computation was skipped (too large), produce a simple line-by-line diff
  if (dp.length === 0) {
    return generateSimpleDiff(relPath, beforeLines, afterLines);
  }

  const edits = backtrackEdits(beforeLines, afterLines, dp);
  const hunks = editsToHunks(edits);

  if (hunks.length === 0) return "";

  const result: string[] = [];
  result.push(`--- a/${relPath}`);
  result.push(`+++ b/${relPath}`);

  for (const hunk of hunks) {
    result.push(
      `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`
    );
    result.push(...hunk.lines);
  }

  return result.join("\n");
}

/**
 * Fallback simple diff for very large files or LCS failures.
 */
function generateSimpleDiff(
  relPath: string,
  beforeLines: string[],
  afterLines: string[]
): string {
  const result: string[] = [];
  result.push(`--- a/${relPath}`);
  result.push(`+++ b/${relPath}`);

  const maxLen = Math.max(beforeLines.length, afterLines.length);
  let inHunk = false;
  let hunkStart = -1;
  let hunkLines: string[] = [];

  for (let i = 0; i < maxLen; i++) {
    const bLine = i < beforeLines.length ? beforeLines[i] : undefined;
    const aLine = i < afterLines.length ? afterLines[i] : undefined;

    if (bLine === aLine) {
      if (inHunk) {
        // Flush
        result.push(
          `@@ -${hunkStart + 1},${beforeLines.length - hunkStart} +${hunkStart + 1},${afterLines.length - hunkStart} @@`
        );
        result.push(...hunkLines);
        inHunk = false;
        hunkLines = [];
      }
    } else {
      if (!inHunk) {
        inHunk = true;
        hunkStart = i;
      }
      if (bLine !== undefined) hunkLines.push(`-${bLine}`);
      if (aLine !== undefined) hunkLines.push(`+${aLine}`);
    }
  }

  if (inHunk && hunkLines.length > 0) {
    result.push(
      `@@ -${hunkStart + 1},${Math.max(0, beforeLines.length - hunkStart)} +${hunkStart + 1},${Math.max(0, afterLines.length - hunkStart)} @@`
    );
    result.push(...hunkLines);
  }

  return result.length > 2 ? result.join("\n") : "";
}

// ─── File diff computation ────────────────────────────────────────

/**
 * Compute the diff between a stored preimage and the current file on disk.
 */
async function computeFileDiff(
  worktree: string,
  preimage: Preimage
): Promise<FileDiffResult> {
  try {
    const safeFile = await readCurrentFileWithinWorktree(
      worktree,
      preimage.relPath
    );
    const currentContent = safeFile.content;
    const currentSize = safeFile.sizeBytes;

    // Binary sniff
    if (currentContent.includes("\0")) {
      return {
        relPath: preimage.relPath,
        kind: "binary",
        currentSize,
        preimageSize: preimage.sizeBytes,
      };
    }

    // New file (didn't exist at preimage time)
    if (!preimage.existed) {
      return {
        relPath: preimage.relPath,
        kind: "new-file",
        currentSize,
        preimageSize: 0,
      };
    }

    // Unchanged
    if (preimage.content === currentContent) {
      return {
        relPath: preimage.relPath,
        kind: "unchanged",
        currentSize,
        preimageSize: preimage.sizeBytes,
      };
    }

    // Generate diff
    const diffText = generateUnifiedDiff(
      preimage.relPath,
      preimage.content ?? "",
      currentContent
    );

    return {
      relPath: preimage.relPath,
      kind: diffText ? "diff" : "unchanged",
      diffText: diffText || undefined,
      currentSize,
      preimageSize: preimage.sizeBytes,
    };
  } catch (err: any) {
    if (err.code === "ENOENT") {
      if (!preimage.existed) {
        return {
          relPath: preimage.relPath,
          kind: "unchanged",
          currentSize: 0,
          preimageSize: 0,
        };
      }

      // File deleted
      return {
        relPath: preimage.relPath,
        kind: "deleted",
        currentSize: 0,
        preimageSize: preimage.sizeBytes,
      };
    }
    return {
      relPath: preimage.relPath,
      kind: "error",
      currentSize: 0,
      preimageSize: preimage.sizeBytes,
      error: err.message,
    };
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

async function readCurrentFileWithinWorktree(
  worktree: string,
  relPath: string
): Promise<{ content: string; sizeBytes: number }> {
  const absPath = path.resolve(worktree, relPath);
  const normalizedWorktree = path.resolve(worktree);
  if (!isPathInside(normalizedWorktree, absPath)) {
    throw new Error("current file path escapes worktree");
  }

  const stat = await fs.lstat(absPath);
  if (stat.isSymbolicLink()) {
    throw new Error("current file is a symbolic link; diff omitted for safety");
  }
  if (!stat.isFile()) {
    throw new Error("current path is not a regular file; diff omitted for safety");
  }

  const realWorktree = await fs.realpath(worktree);
  const realPath = await fs.realpath(absPath);
  if (!isPathInside(realWorktree, realPath)) {
    throw new Error("current file resolves outside worktree; diff omitted for safety");
  }

  const content = await fs.readFile(realPath, "utf-8");
  return { content, sizeBytes: Buffer.byteLength(content, "utf-8") };
}

// ─── Diff set building ──────────────────────────────────────────────

function isPreimage(entry: Preimage | PreimageSkipped): entry is Preimage {
  return "content" in entry;
}

/**
 * Build diffs for all preimages in a session, applying a token budget.
 */
export async function buildDiffs(
  preimages: Array<Preimage | PreimageSkipped>,
  worktree: string,
  maxTokens: number
): Promise<DiffSet> {
  const results: FileDiffResult[] = [];

  // Sort deterministically
  const sorted = [...preimages].sort((a, b) =>
    a.relPath.localeCompare(b.relPath)
  );

  for (const entry of sorted) {
    if (isPreimage(entry)) {
      results.push(await computeFileDiff(worktree, entry));
    } else {
      // Map PreimageSkipped reason to FileDiffResult kind
      const kind: FileDiffResult["kind"] =
        entry.reason === "binary-sniffed" ? "binary" : entry.reason;
      results.push({
        relPath: entry.relPath,
        kind,
        currentSize: 0,
        preimageSize: entry.sizeBytes,
      });
    }
  }

  return applyTokenBudget(results, maxTokens);
}

function applyTokenBudget(
  results: FileDiffResult[],
  maxTokens: number
): DiffSet {
  let totalChars = 0;
  const maxChars = Math.floor(maxTokens * CHARS_PER_TOKEN);
  const trimmed: FileDiffResult[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];

    if (totalChars >= maxChars) {
      trimmed.push({
        relPath: "(remaining)",
        kind: "error",
        currentSize: 0,
        preimageSize: 0,
        error: `[TRUNCATED] Diff budget exhausted. ${results.length - i} remaining file(s) omitted.`,
      });
      break;
    }

    if (result.kind === "diff" && result.diffText) {
      const diffChars = result.diffText.length;
      if (totalChars + diffChars <= maxChars) {
        trimmed.push(result);
        totalChars += diffChars;
      } else {
        const available = maxChars - totalChars;
        if (available < 200) {
          // Too little space to be useful
          trimmed.push({
            relPath: result.relPath,
            kind: "error",
            currentSize: result.currentSize,
            preimageSize: result.preimageSize,
            error: `[TRUNCATED] Insufficient budget remaining for diff (~${approxTokens(available)} tokens).`,
          });
          totalChars = maxChars;
        } else {
          const truncatedDiff =
            result.diffText.slice(0, available) +
            `\n...\n[TRUNCATED: diff exceeds remaining token budget]`;
          trimmed.push({
            ...result,
            diffText: truncatedDiff,
          });
          totalChars = maxChars;
        }
      }
    } else {
      // Metadata-only entries consume negligible budget
      trimmed.push(result);
    }
  }

  return { results: trimmed, totalChars };
}

// ─── Formatting ─────────────────────────────────────────────────────

/**
 * Format a DiffSet into a human-readable markdown section for the handoff message.
 */
export function formatDiffSet(diffSet: DiffSet): string {
  if (diffSet.results.length === 0) {
    return "*(No files were modified in this session.)*\n";
  }

  const lines: string[] = [];
  lines.push(`## Modified files (${diffSet.results.length})\n`);

  for (const result of diffSet.results) {
    lines.push(`### \`${result.relPath}\` — ${kindLabel(result.kind)}\n`);

    switch (result.kind) {
      case "diff":
        lines.push("```diff");
        lines.push(result.diffText!);
        lines.push("```\n");
        break;
      case "new-file":
        lines.push(
          `File was created during this session (current size: ${formatSize(result.currentSize)}).\n`
        );
        break;
      case "deleted":
        lines.push(
          `File was deleted during this session (was ${formatSize(result.preimageSize)}).\n`
        );
        break;
      case "unchanged":
        lines.push(
          `No changes detected (${formatSize(result.currentSize)}).\n`
        );
        break;
      case "too-large":
        lines.push(
          `File too large to diff (${formatSize(result.preimageSize)}). Only metadata captured.\n`
        );
        break;
      case "binary":
        lines.push(
          `Binary file detected (${formatSize(result.preimageSize)}). Diff omitted.\n`
        );
        break;
      case "missing-preimage":
        lines.push(
          `No preimage available. Current size: ${formatSize(result.currentSize)}.\n`
        );
        break;
      case "error":
        lines.push(`Error: ${result.error || "unknown"}\n`);
        break;
    }
  }

  if (diffSet.totalChars > 0) {
    lines.push(
      `---\n*Diff content: ~${diffSet.totalChars.toLocaleString()} chars (~${approxTokens(diffSet.totalChars).toLocaleString()} tokens)*\n`
    );
  }

  return lines.join("\n");
}

function kindLabel(kind: FileDiffResult["kind"]): string {
  const labels: Record<string, string> = {
    diff: "modified",
    "new-file": "created",
    deleted: "deleted",
    unchanged: "unchanged",
    "too-large": "metadata-only (too large)",
    binary: "binary",
    "missing-preimage": "no preimage",
    error: "error",
  };
  return labels[kind];
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
