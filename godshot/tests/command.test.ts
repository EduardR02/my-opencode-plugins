import { describe, it, expect } from "bun:test";
import { resolveConfig } from "../src/config.js";

describe("resolveConfig", () => {
  it("throws if model is missing", () => {
    expect(() => resolveConfig({})).toThrow("model");
  });

  it("throws if model is empty string", () => {
    expect(() => resolveConfig({ model: "" })).toThrow("model");
  });

  it("parses model from options", () => {
    const config = resolveConfig({ model: "openai/gpt-5.5" });
    expect(config.model).toBe("openai/gpt-5.5");
  });

  it("provides default maxDiffTokens", () => {
    const config = resolveConfig({ model: "test/model" });
    expect(config.maxDiffTokens).toBe(64000);
  });

  it("overrides maxDiffTokens", () => {
    const config = resolveConfig({
      model: "test/model",
      maxDiffTokens: 10000,
    });
    expect(config.maxDiffTokens).toBe(10000);
  });

  it("provides default maxFileBytes", () => {
    const config = resolveConfig({ model: "test/model" });
    expect(config.maxFileBytes).toBe(1024 * 1024);
  });

  it("overrides maxFileBytes", () => {
    const config = resolveConfig({
      model: "test/model",
      maxFileBytes: 512,
    });
    expect(config.maxFileBytes).toBe(512);
  });

  it("provides default storageDir", () => {
    const config = resolveConfig({ model: "test/model" });
    expect(config.storageDir).toBe("godshot-preimages");
  });

  it("overrides storageDir", () => {
    const config = resolveConfig({
      model: "test/model",
      storageDir: "/custom/path",
    });
    expect(config.storageDir).toBe("/custom/path");
  });
});
