import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { PreimageStore, type Preimage, type PreimageSkipped } from "../src/storage.js";

describe("PreimageStore", () => {
  let tmpDir: string;
  let store: PreimageStore;
  let worktree: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "godshot-test-"));
    store = new PreimageStore(tmpDir);
    worktree = path.join(tmpDir, "worktree");
    await fs.mkdir(worktree, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("resolveRelPath", () => {
    it("resolves a file path within worktree", () => {
      const rel = store.resolveRelPath(worktree, path.join(worktree, "src", "foo.ts"));
      expect(rel).toBe("src/foo.ts");
    });

    it("resolves a file at worktree root", () => {
      const rel = store.resolveRelPath(worktree, path.join(worktree, "README.md"));
      expect(rel).toBe("README.md");
    });

    it("returns null for paths outside worktree", () => {
      const outside = path.join(os.tmpdir(), "outside.txt");
      const rel = store.resolveRelPath(worktree, outside);
      expect(rel).toBeNull();
    });

    it("returns null for path traversal attempts", () => {
      const traversal = path.join(worktree, "..", "..", "etc", "passwd");
      const rel = store.resolveRelPath(worktree, traversal);
      expect(rel).toBeNull();
    });

    it("returns null for the parent of worktree", () => {
      const parent = path.dirname(worktree);
      const rel = store.resolveRelPath(worktree, parent);
      expect(rel).toBeNull();
    });

    it("returns null for completely different root", () => {
      const rel = store.resolveRelPath(worktree, "/etc/passwd");
      expect(rel).toBeNull();
    });

    it("handles symlink resolution (normalizes paths)", () => {
      // Even if worktree has symlinks, resolve should normalize
      const normalized = store.resolveRelPath(
        path.join(worktree, "subdir", ".."),
        path.join(worktree, "file.txt")
      );
      // The normalized worktree would be just worktree
      expect(normalized).toBe("file.txt");
    });
  });

  describe("captureIfNeeded", () => {
    it("captures preimage for an existing file", async () => {
      const filePath = path.join(worktree, "test.txt");
      await fs.writeFile(filePath, "hello world", "utf-8");

      const result = await store.captureIfNeeded(
        "session-1",
        worktree,
        filePath,
        1024 * 1024
      );

      expect(result).not.toBeNull();
      if (result && "content" in result) {
        expect(result.content).toBe("hello world");
        expect(result.relPath).toBe("test.txt");
        expect(result.existed).toBe(true);
        expect(result.sizeBytes).toBe(11);
      }
    });

    it("captures missing marker for new files", async () => {
      const filePath = path.join(worktree, "nonexistent.txt");

      const result = await store.captureIfNeeded(
        "session-1",
        worktree,
        filePath,
        1024 * 1024
      );

      expect(result).not.toBeNull();
      if (result && "content" in result) {
        expect(result.content).toBeNull();
        expect(result.existed).toBe(false);
      }
    });

    it("skips if already captured (idempotent)", async () => {
      const filePath = path.join(worktree, "test.txt");
      await fs.writeFile(filePath, "v1", "utf-8");

      // First capture
      const first = await store.captureIfNeeded(
        "session-2",
        worktree,
        filePath,
        1024 * 1024
      );

      // Modify file
      await fs.writeFile(filePath, "v2-modified", "utf-8");

      // Second capture should return null (already captured)
      const second = await store.captureIfNeeded(
        "session-2",
        worktree,
        filePath,
        1024 * 1024
      );

      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });

    it("skips directories (safety)", async () => {
      const dirPath = path.join(worktree, "somedir");
      await fs.mkdir(dirPath, { recursive: true });

      const result = await store.captureIfNeeded(
        "session-3",
        worktree,
        dirPath,
        1024 * 1024
      );

      expect(result).toBeNull();
    });

    it("skips files outside worktree", async () => {
      const outside = path.join(tmpDir, "outside.txt");
      await fs.writeFile(outside, "data", "utf-8");

      const result = await store.captureIfNeeded(
        "session-4",
        worktree,
        outside,
        1024 * 1024
      );

      expect(result).toBeNull();
    });

    it("skips symlinks that could resolve outside the worktree", async () => {
      const outside = path.join(tmpDir, "outside-symlink-target.txt");
      const linkPath = path.join(worktree, "outside-link.txt");
      await fs.writeFile(outside, "secret outside data", "utf-8");
      await fs.symlink(outside, linkPath);

      const result = await store.captureIfNeeded(
        "session-4b",
        worktree,
        linkPath,
        1024 * 1024
      );

      expect(result).toBeNull();
    });

    it("skips files larger than maxFileBytes", async () => {
      const filePath = path.join(worktree, "big.txt");
      // Write a 5KB file but set max to 1KB
      const content = "x".repeat(5 * 1024);
      await fs.writeFile(filePath, content, "utf-8");

      const result = await store.captureIfNeeded(
        "session-5",
        worktree,
        filePath,
        1024
      );

      expect(result).not.toBeNull();
      if (result && "reason" in result) {
        expect(result.reason).toBe("too-large");
      }
    });

    it("skips binary files (null byte sniff)", async () => {
      const filePath = path.join(worktree, "binary.bin");
      const buf = Buffer.from([0x00, 0x01, 0x02, 0x48, 0x65, 0x6c, 0x6c, 0x6f]); // null byte + data
      await fs.writeFile(filePath, buf);

      const result = await store.captureIfNeeded(
        "session-6",
        worktree,
        filePath,
        1024 * 1024
      );

      expect(result).not.toBeNull();
      if (result && "reason" in result) {
        expect(result.reason).toBe("binary-sniffed");
      }
    });
  });

  describe("persistence", () => {
    it("stores and retrieves preimages from disk", async () => {
      const store2 = new PreimageStore(tmpDir);
      const filePath = path.join(worktree, "persist.txt");
      await fs.writeFile(filePath, "persist me", "utf-8");

      await store2.captureIfNeeded("sess-p", worktree, filePath, 1024 * 1024);

      // New store instance should read from disk
      const store3 = new PreimageStore(tmpDir);
      const retrieved = await store3.get("sess-p", "persist.txt");
      expect(retrieved).not.toBeNull();
      if (retrieved && "content" in retrieved) {
        expect(retrieved.content).toBe("persist me");
      }
    });

    it("getAllForSession returns all preimages", async () => {
      const store4 = new PreimageStore(tmpDir);
      const f1 = path.join(worktree, "a.txt");
      const f2 = path.join(worktree, "b.txt");
      await fs.writeFile(f1, "A", "utf-8");
      await fs.writeFile(f2, "B", "utf-8");

      await store4.captureIfNeeded("sess-all", worktree, f1, 1024 * 1024);
      await store4.captureIfNeeded("sess-all", worktree, f2, 1024 * 1024);

      const all = await store4.getAllForSession("sess-all");
      expect(all.length).toBe(2);
    });

    it("removeSession cleans up", async () => {
      const store5 = new PreimageStore(tmpDir);
      const f1 = path.join(worktree, "del.txt");
      await fs.writeFile(f1, "to delete", "utf-8");
      await store5.captureIfNeeded("sess-rm", worktree, f1, 1024 * 1024);

      await store5.removeSession("sess-rm");

      const all = await store5.getAllForSession("sess-rm");
      expect(all.length).toBe(0);
    });
  });

  describe("hashed filenames", () => {
    it("produces safe filenames for any path", async () => {
      const store6 = new PreimageStore(tmpDir);
      // Path with special characters
      const tricky = path.join(worktree, "src", "deeply/nested/../path", "file.ts");
      const resolvedActual = path.resolve(tricky); // this resolves the ..
      
      // resolveRelPath will check if it's in worktree
      const rel = store6.resolveRelPath(worktree, resolvedActual);
      if (rel) {
        // The hashed filename should be alphanumeric hex
        const hash = (store6 as any).hashPath(rel);
        expect(hash).toMatch(/^[a-f0-9]{32}$/);
      }
    });
  });
});
