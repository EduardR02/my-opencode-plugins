import { describe, it, expect } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { buildDiffs, formatDiffSet, approxTokens } from "../src/diff.js";
import { PreimageStore } from "../src/storage.js";

describe("buildDiffs", () => {
  let tmpDir: string;
  let worktree: string;
  let store: PreimageStore;

  async function setup() {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "godshot-diff-test-"));
    worktree = path.join(tmpDir, "worktree");
    await fs.mkdir(worktree, { recursive: true });
    store = new PreimageStore(path.join(tmpDir, "store"));
  }

  async function teardown() {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  it("detects modified files", async () => {
    await setup();
    try {
      const filePath = path.join(worktree, "mod.txt");
      await fs.writeFile(filePath, "line1\nline2\nline3\n", "utf-8");
      await store.captureIfNeeded("sess", worktree, filePath, 1024 * 1024);

      // Modify file
      await fs.writeFile(filePath, "line1\nline2-modified\nline3\nline4\n", "utf-8");

      const preimages = await store.getAllForSession("sess");
      const diffSet = await buildDiffs(preimages, worktree, 10000);

      expect(diffSet.results.length).toBe(1);
      expect(diffSet.results[0].kind).toBe("diff");
      expect(diffSet.results[0].diffText).toBeDefined();
      expect(diffSet.results[0].diffText).toContain("--- a/mod.txt");
      expect(diffSet.results[0].diffText).toContain("+++ b/mod.txt");
    } finally {
      await teardown();
    }
  });

  it("detects new files", async () => {
    await setup();
    try {
      const filePath = path.join(worktree, "new.txt");
      
      // Capture as missing (new file about to be created)
      await store.captureIfNeeded("sess", worktree, filePath, 1024 * 1024);
      
      // Create the file
      await fs.writeFile(filePath, "brand new content\n", "utf-8");

      const preimages = await store.getAllForSession("sess");
      const diffSet = await buildDiffs(preimages, worktree, 10000);

      expect(diffSet.results.length).toBe(1);
      expect(diffSet.results[0].kind).toBe("new-file");
    } finally {
      await teardown();
    }
  });

  it("detects deleted files", async () => {
    await setup();
    try {
      const filePath = path.join(worktree, "del.txt");
      await fs.writeFile(filePath, "will be deleted\n", "utf-8");
      await store.captureIfNeeded("sess", worktree, filePath, 1024 * 1024);

      // Delete file
      await fs.unlink(filePath);

      const preimages = await store.getAllForSession("sess");
      const diffSet = await buildDiffs(preimages, worktree, 10000);

      expect(diffSet.results.length).toBe(1);
      expect(diffSet.results[0].kind).toBe("deleted");
    } finally {
      await teardown();
    }
  });

  it("detects unchanged files", async () => {
    await setup();
    try {
      const filePath = path.join(worktree, "same.txt");
      await fs.writeFile(filePath, "no change\n", "utf-8");
      await store.captureIfNeeded("sess", worktree, filePath, 1024 * 1024);

      // Don't modify file

      const preimages = await store.getAllForSession("sess");
      const diffSet = await buildDiffs(preimages, worktree, 10000);

      expect(diffSet.results.length).toBe(1);
      expect(diffSet.results[0].kind).toBe("unchanged");
    } finally {
      await teardown();
    }
  });

  it("does not read current content through symlinks", async () => {
    await setup();
    try {
      const filePath = path.join(worktree, "link-target.txt");
      const outside = path.join(tmpDir, "outside-current.txt");
      await fs.writeFile(filePath, "safe preimage\n", "utf-8");
      await fs.writeFile(outside, "SECRET OUTSIDE CONTENT\n", "utf-8");
      await store.captureIfNeeded("sess", worktree, filePath, 1024 * 1024);

      await fs.unlink(filePath);
      await fs.symlink(outside, filePath);

      const preimages = await store.getAllForSession("sess");
      const diffSet = await buildDiffs(preimages, worktree, 10000);

      expect(diffSet.results.length).toBe(1);
      expect(diffSet.results[0].kind).toBe("error");
      expect(diffSet.results[0].error).toContain("symbolic link");
      expect(diffSet.results[0].diffText).toBeUndefined();
    } finally {
      await teardown();
    }
  });

  it("handles token budget truncation", async () => {
    await setup();
    try {
      // Create multiple files with preimages
      for (let i = 0; i < 5; i++) {
        const filePath = path.join(worktree, `file${i}.txt`);
        await fs.writeFile(filePath, `original content ${i}\nline2\n`, "utf-8");
        await store.captureIfNeeded("sess", worktree, filePath, 1024 * 1024);
        // Modify
        await fs.writeFile(
          filePath,
          `modified content ${i}\nline2 changed\nline3 new\n`,
          "utf-8"
        );
      }

      const preimages = await store.getAllForSession("sess");

      // Very tight budget — only 5 tokens (~12 chars)
      const diffSet = await buildDiffs(preimages, worktree, 5);

      // Should have results but probably truncated
      expect(diffSet.results.length).toBeGreaterThan(0);
      
      const truncationFound = diffSet.results.some(
        (r) => r.error?.includes("TRUNCATED")
      );
      expect(truncationFound).toBe(true);
    } finally {
      await teardown();
    }
  });
});

describe("formatDiffSet", () => {
  it("handles empty diff set", () => {
    const result = formatDiffSet({ results: [], totalChars: 0 });
    expect(result).toContain("No files were modified");
  });

  it("formats diff results", () => {
    const result = formatDiffSet({
      results: [
        {
          relPath: "src/index.ts",
          kind: "diff",
          diffText: "--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n",
          currentSize: 100,
          preimageSize: 50,
        },
      ],
      totalChars: 60,
    });
    expect(result).toContain("src/index.ts");
    expect(result).toContain("modified");
    expect(result).toContain("--- a/src/index.ts");
  });
});

describe("approxTokens", () => {
  it("approximates tokens from character count", () => {
    expect(approxTokens(0)).toBe(0);
    expect(approxTokens(10)).toBe(4); // 10/2.5 = 4
    expect(approxTokens(100)).toBe(40);
  });
});
