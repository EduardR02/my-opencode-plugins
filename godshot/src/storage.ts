import * as path from "node:path";
import * as fs from "node:fs/promises";
import { type Stats } from "node:fs";
import { createHash } from "node:crypto";

/**
 * Represents a stored preimage of a file before OpenCode first touched it.
 */
export interface Preimage {
  /** Relative path from worktree root */
  relPath: string;
  /** Session ID */
  sessionID: string;
  /** File content at capture time (null means file did not exist) */
  content: string | null;
  /** Whether the file existed on disk when preimage was captured */
  existed: boolean;
  /** File size in bytes at capture time (0 for missing files) */
  sizeBytes: number;
  /** Capture timestamp (ms since epoch) */
  capturedAt: number;
}

/**
 * Metadata-only marker for files that are too large or binary.
 */
export interface PreimageSkipped {
  relPath: string;
  sessionID: string;
  reason: "too-large" | "binary-sniffed";
  sizeBytes: number;
  capturedAt: number;
}

function isPathInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Lazy first-touch preimage store.
 *
 * Preimages are stored under `baseDir / sessionID / hashed-rel-path.json`.
 * Hashed filenames prevent path traversal issues and keep flat structure.
 */
export class PreimageStore {
  private baseDir: string;
  private cache: Map<string, Preimage | PreimageSkipped> = new Map();

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private cacheKey(sessionID: string, relPath: string): string {
    return `${sessionID}::${relPath}`;
  }

  private hashPath(relPath: string): string {
    return createHash("sha256").update(relPath).digest("hex").slice(0, 32);
  }

  private async ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }

  /**
   * Check if a preimage already exists for this session+file.
   */
  has(sessionID: string, relPath: string): boolean {
    return this.cache.has(this.cacheKey(sessionID, relPath));
  }

  /**
   * Get a stored preimage from disk (or cache).
   */
  async get(
    sessionID: string,
    relPath: string
  ): Promise<Preimage | PreimageSkipped | null> {
    const key = this.cacheKey(sessionID, relPath);
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    const filePath = path.join(
      this.baseDir,
      sessionID,
      `${this.hashPath(relPath)}.json`
    );

    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const data = JSON.parse(raw) as Preimage | PreimageSkipped;
      this.cache.set(key, data);
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Capture a preimage of a file before it is first modified in this session.
   *
   * @param sessionID - Current session ID
   * @param worktree - Absolute worktree root path
   * @param absPath - Absolute path to the file being edited/written
   * @param maxFileBytes - Max file size in bytes before skipping
   */
  async captureIfNeeded(
    sessionID: string,
    worktree: string,
    absPath: string,
    maxFileBytes: number
  ): Promise<Preimage | PreimageSkipped | null> {
    // Resolve relative path from worktree
    const relPath = this.resolveRelPath(worktree, absPath);
    if (!relPath) return null; // path outside worktree

    const key = this.cacheKey(sessionID, relPath);
    if (this.cache.has(key)) return null; // already captured

    let stat: Stats;
    let realPath: string;
    try {
      const safeFile = await this.resolveExistingFileWithinWorktree(
        worktree,
        absPath
      );
      if (!safeFile) return null;
      stat = safeFile.stat;
      realPath = safeFile.realPath;
    } catch (err: any) {
      if (err?.code !== "ENOENT") {
        // Unreadable or unsafe path — skip silently
        return null;
      }

      // File does not exist (new file being created)
      const preimage: Preimage = {
        relPath,
        sessionID,
        content: null,
        existed: false,
        sizeBytes: 0,
        capturedAt: Date.now(),
      };
      await this.persist(sessionID, preimage);
      this.cache.set(key, preimage);
      return preimage;
    }

    // Skip huge files
    if (stat.size > maxFileBytes) {
      const skipped: PreimageSkipped = {
        relPath,
        sessionID,
        reason: "too-large",
        sizeBytes: stat.size,
        capturedAt: Date.now(),
      };
      await this.persist(sessionID, skipped);
      this.cache.set(key, skipped);
      return skipped;
    }

    // Try to read file; skip if binary
    try {
      const content = await fs.readFile(realPath, "utf-8");

      // Quick binary sniff: if content contains null bytes, it's likely binary
      if (content.includes("\0")) {
        const skipped: PreimageSkipped = {
          relPath,
          sessionID,
          reason: "binary-sniffed",
          sizeBytes: stat.size,
          capturedAt: Date.now(),
        };
        await this.persist(sessionID, skipped);
        this.cache.set(key, skipped);
        return skipped;
      }

      const preimage: Preimage = {
        relPath,
        sessionID,
        content,
        existed: true,
        sizeBytes: stat.size,
        capturedAt: Date.now(),
      };
      await this.persist(sessionID, preimage);
      this.cache.set(key, preimage);
      return preimage;
    } catch {
      // Unreadable file (permissions, etc) — skip silently
      return null;
    }
  }

  private async resolveExistingFileWithinWorktree(
    worktree: string,
    absPath: string
  ): Promise<{ realPath: string; stat: Stats } | null> {
    const stat = await fs.lstat(absPath);

    // Safety: only capture regular file paths, never directories, symlinks,
    // or special files. lstat rejects final symlinks before any read.
    if (!stat.isFile()) {
      return null;
    }

    const realWorktree = await fs.realpath(worktree);
    const realPath = await fs.realpath(absPath);
    if (!isPathInside(realWorktree, realPath)) {
      return null;
    }

    return { realPath, stat };
  }

  /**
   * Resolve a relative path from worktree to absolute path.
   * Returns null if the path escapes the worktree or is invalid.
   */
  resolveRelPath(worktree: string, absPath: string): string | null {
    // Normalize both paths for comparison
    const normalizedWorktree = path.resolve(worktree);
    const normalizedAbs = path.resolve(absPath);

    // Must be within worktree
    if (!normalizedAbs.startsWith(normalizedWorktree + path.sep)) {
      // Allow exact worktree match (file at root)
      if (normalizedAbs !== normalizedWorktree) {
        return null;
      }
    }

    // Compute relative path
    const rel = path.relative(normalizedWorktree, normalizedAbs);
    if (!rel || rel.startsWith("..")) return null;
    return rel;
  }

  /**
   * Get all preimages for a session (from disk).
   */
  async getAllForSession(
    sessionID: string
  ): Promise<Array<Preimage | PreimageSkipped>> {
    const dir = path.join(this.baseDir, sessionID);
    const results: Array<Preimage | PreimageSkipped> = [];

    try {
      const entries = await fs.readdir(dir);
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        try {
          const raw = await fs.readFile(path.join(dir, entry), "utf-8");
          const data = JSON.parse(raw) as Preimage | PreimageSkipped;
          results.push(data);
        } catch {
          // corrupted entry, skip
        }
      }
    } catch {
      // directory doesn't exist yet
    }

    return results;
  }

  /**
   * Remove all preimages for a session.
   */
  async removeSession(sessionID: string): Promise<void> {
    const dir = path.join(this.baseDir, sessionID);
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // nothing to remove
    }
    // Clear cache entries for this session
    for (const [key] of this.cache) {
      if (key.startsWith(`${sessionID}::`)) {
        this.cache.delete(key);
      }
    }
  }

  private async persist(
    sessionID: string,
    data: Preimage | PreimageSkipped
  ): Promise<void> {
    const dir = path.join(this.baseDir, sessionID);
    await this.ensureDir(dir);
    const filePath = path.join(
      dir,
      `${this.hashPath(data.relPath)}.json`
    );
    await fs.writeFile(filePath, JSON.stringify(data), "utf-8");
  }
}
