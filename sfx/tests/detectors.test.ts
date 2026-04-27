import { describe, it, expect } from "bun:test";
import { containsTestFailure } from "../src/detectors.js";

describe("containsTestFailure", () => {
  it("returns false for empty output and no metadata", () => {
    expect(containsTestFailure("", undefined, undefined)).toBe(false);
    expect(containsTestFailure("", null, undefined)).toBe(false);
    expect(containsTestFailure("", {}, undefined)).toBe(false);
  });

  it("uses exitCode, exit_code, and exit metadata for test commands", () => {
    expect(containsTestFailure("", { exitCode: 1 }, { command: "npm test" })).toBe(true);
    expect(containsTestFailure("", { exit_code: 2 }, { command: "npm test" })).toBe(true);
    expect(containsTestFailure("", { exit: 99 }, { command: "npm test" })).toBe(true);
    expect(containsTestFailure("", { exitCode: 0 }, { command: "npm test" })).toBe(false);
  });

  it("trusts exit code for test commands and does not scan output", () => {
    expect(
      containsTestFailure("Tests: 1 failed\n5 failing\nAssertionError", { exitCode: 0 }, { command: "npm test" }),
    ).toBe(false);
    expect(containsTestFailure("all good", { exitCode: 1 }, { command: "bun test" })).toBe(true);
    expect(containsTestFailure("Tests: 1 failed", undefined, { command: "npm test" })).toBe(false);
  });

  it("does not use non-zero exit code for non-test commands", () => {
    expect(containsTestFailure("", { exitCode: 1 }, undefined)).toBe(false);
    expect(containsTestFailure("", { exitCode: 1 }, { command: "ls -la" })).toBe(false);
  });

  it("recognizes test commands across common runners", () => {
    const commands = [
      "npm test",
      "yarn test",
      "pnpm t",
      "bun test",
      "npx jest",
      "bunx vitest",
      "mocha tests",
      "pytest",
      "python -m unittest",
      "tox",
      "cargo test",
      "go test ./...",
      "make check",
      "rspec",
      "phpunit",
      "dotnet test",
      "ctest",
    ];

    for (const command of commands) {
      expect(containsTestFailure("", { exitCode: 1 }, { command })).toBe(true);
    }
  });

  it("extracts commands from supported argument shapes", () => {
    expect(containsTestFailure("", { exitCode: 1 }, "npm test")).toBe(true);
    expect(containsTestFailure("", { exitCode: 1 }, { cmd: "bun test" })).toBe(true);
    expect(containsTestFailure("", { exitCode: 1 }, { script: "pytest" })).toBe(true);
    expect(containsTestFailure("", { exitCode: 1 }, { args: ["go", "test", "./..."] })).toBe(true);
    expect(containsTestFailure("", { exitCode: 1 }, { argv: ["cargo", "test"] })).toBe(true);
  });

  it("detects explicit 'Tests: N failed' summaries for non-test commands", () => {
    expect(containsTestFailure("Tests: 1 failed, 5 passed, 6 total", undefined, undefined)).toBe(true);
    expect(containsTestFailure("Tests: 2 failed, 0 passed", undefined, { command: "ls" })).toBe(true);
    expect(containsTestFailure("Tests:       1 failed, 1 passed, 2 total", undefined, undefined)).toBe(true);
  });

  it("does not flag 'Tests: 0 failed' summaries", () => {
    expect(containsTestFailure("Tests: 0 failed, 5 passed, 5 total", undefined, undefined)).toBe(false);
  });

  it("detects 'N failing' summaries for non-test commands", () => {
    expect(containsTestFailure("1 failing", undefined, undefined)).toBe(true);
    expect(containsTestFailure("Test Suites: 1 failed, 1 passed\nTests: 2 failing", undefined, undefined)).toBe(true);
  });

  it("does not flag generic failure keywords or assertion output", () => {
    expect(containsTestFailure("something FAIL here", undefined, undefined)).toBe(false);
    expect(containsTestFailure("Command failed: connection refused", undefined, { command: "ls" })).toBe(false);
    expect(containsTestFailure("assertion failed: expected X", undefined, undefined)).toBe(false);
    expect(containsTestFailure("AssertionError: expected ...", undefined, undefined)).toBe(false);
    expect(containsTestFailure("Error: expected true but received false", undefined, undefined)).toBe(false);
  });

  it("does not flag failure symbols", () => {
    expect(containsTestFailure("test ✗ failed", undefined, undefined)).toBe(false);
    expect(containsTestFailure("× test failed", undefined, undefined)).toBe(false);
    expect(containsTestFailure("❌ assertion error", undefined, undefined)).toBe(false);
  });
});
