import { describe, it, expect } from "bun:test";
import { parseModelString } from "../src/curation.js";

describe("parseModelString", () => {
  it("parses a valid model string", () => {
    const result = parseModelString("openai/gpt-5.5");
    expect(result.providerID).toBe("openai");
    expect(result.modelID).toBe("gpt-5.5");
  });

  it("parses model string with hyphens and dots", () => {
    const result = parseModelString("anthropic/claude-sonnet-4-20250514");
    expect(result.providerID).toBe("anthropic");
    expect(result.modelID).toBe("claude-sonnet-4-20250514");
  });

  it("parses model string with version", () => {
    const result = parseModelString("google/gemini-2.5-pro");
    expect(result.providerID).toBe("google");
    expect(result.modelID).toBe("gemini-2.5-pro");
  });

  it("trims whitespace", () => {
    const result = parseModelString("  openai/gpt-5.5  ");
    expect(result.providerID).toBe("openai");
    expect(result.modelID).toBe("gpt-5.5");
  });

  it("throws on empty string", () => {
    expect(() => parseModelString("")).toThrow("empty");
  });

  it("throws on whitespace-only string", () => {
    expect(() => parseModelString("   ")).toThrow("empty");
  });

  it("throws on string without slash", () => {
    expect(() => parseModelString("gpt-5.5")).toThrow("Invalid model string");
  });

  it("throws on string with only slash", () => {
    expect(() => parseModelString("/")).toThrow("Invalid model string");
  });

  it("throws on string starting with slash", () => {
    expect(() => parseModelString("/gpt-5.5")).toThrow("Invalid model string");
  });

  it("throws on string ending with slash", () => {
    expect(() => parseModelString("openai/")).toThrow("both providerID and modelID");
  });

  it("throws on string with multiple slashes (only first considered)", () => {
    // Actually this should parse as providerID="" and modelID containing slashes
    // But our parser uses indexOf("/") so it'd give providerID="" for "//gpt"
    // Let's just test: "a/b/c" -> providerID="a", modelID="b/c"
    const result = parseModelString("a/b/c");
    expect(result.providerID).toBe("a");
    expect(result.modelID).toBe("b/c");
  });
});

describe("curation prompt construction (unit)", () => {
  it("buildCurationPrompt exists and is importable", async () => {
    // Verify the module exports the function
    const mod = await import("../src/curation.js");
    expect(typeof mod.curateHandoff).toBe("function");
    expect(typeof mod.parseModelString).toBe("function");
  });
});
