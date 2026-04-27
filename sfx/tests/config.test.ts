import { describe, it, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveConfig } from "../src/config.js";

// Compute the expected resolved sound paths relative to the plugin root
const testDir = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(testDir, "..");
const sound = (name: string) => path.resolve(pluginDir, "sounds", name);

describe("resolveConfig", () => {
  it("provides defaults when no options given", () => {
    const config = resolveConfig();
    expect(config.events.idle.enabled).toBe(true);
    expect(config.events.idle.sound).toBe(sound("idle.mp3"));
    expect(config.events.error.enabled).toBe(true);
    expect(config.events.error.sound).toBe(sound("error.mp3"));
    expect(config.events.testFail.enabled).toBe(true);
    expect(config.events.testFail.sound).toBe(sound("test-fail.mp3"));
    expect(config.events.permission.enabled).toBe(true);
    expect(config.events.permission.sound).toBe(sound("permission.mp3"));
  });

  it("handles empty options object", () => {
    const config = resolveConfig({});
    expect(config.events.idle.enabled).toBe(true);
    expect(config.events.idle.sound).toBe(sound("idle.mp3"));
  });

  it("handles null/undefined events field", () => {
    const config = resolveConfig({ events: undefined });
    expect(config.events.idle.enabled).toBe(true);
  });

  it("disables idle event", () => {
    const config = resolveConfig({
      events: { idle: { enabled: false } },
    });
    expect(config.events.idle.enabled).toBe(false);
    expect(config.events.idle.sound).toBe(sound("idle.mp3"));
  });

  it("overrides sound path", () => {
    const config = resolveConfig({
      events: { idle: { sound: "/custom/ding.wav" } },
    });
    expect(config.events.idle.sound).toBe("/custom/ding.wav");
    expect(config.events.idle.enabled).toBe(true);
  });

  it("rejects empty string sound path (falls back to default)", () => {
    const config = resolveConfig({
      events: { idle: { sound: "" } },
    });
    expect(config.events.idle.sound).toBe(sound("idle.mp3"));
  });

  it("disables test fail event", () => {
    const config = resolveConfig({
      events: { testFail: { enabled: false } },
    });
    expect(config.events.testFail.enabled).toBe(false);
  });

  it("does not crash on arbitrary extra keys", () => {
    const config = resolveConfig({
      events: { idle: { enabled: true, extraKey: "ignored" } },
    });
    expect(config.events.idle.enabled).toBe(true);
    expect(config.events.idle.sound).toBe(sound("idle.mp3"));
  });

  it("handles events as non-object gracefully", () => {
    const config = resolveConfig({ events: 42 } as any);
    expect(config.events.idle.enabled).toBe(true);
  });

  it("handles per-event config as non-object gracefully", () => {
    const config = resolveConfig({
      events: { idle: "not-an-object" },
    } as any);
    expect(config.events.idle.enabled).toBe(true);
  });

  it("defaults volume to 1.0", () => {
    const config = resolveConfig();
    expect(config.volume).toBe(1.0);
  });

  it("parses custom volume", () => {
    const config = resolveConfig({ volume: 0.5 } as any);
    expect(config.volume).toBe(0.5);
  });

  it("clamps volume below 0 to 0", () => {
    const config = resolveConfig({ volume: -0.5 } as any);
    expect(config.volume).toBe(0);
  });

  it("clamps volume above 1 to 1", () => {
    const config = resolveConfig({ volume: 1.5 } as any);
    expect(config.volume).toBe(1);
  });
});
