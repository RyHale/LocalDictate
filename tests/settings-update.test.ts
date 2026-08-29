import { describe, expect, test } from "bun:test";

import { executeSettingCommand } from "../src/stores/settingsUpdate";

describe("settings command result handling", () => {
  test("accepts a successful generated Result", async () => {
    await expect(
      executeSettingCommand(async () => ({ status: "ok", data: null })),
    ).resolves.toBeUndefined();
  });

  test("turns a returned generated error into a rejection", async () => {
    await expect(
      executeSettingCommand(async () => ({
        status: "error",
        error: "backend rejected the setting",
      })),
    ).rejects.toThrow("backend rejected the setting");
  });

  test("preserves a thrown Tauri invocation error", async () => {
    const invocationError = new Error("invoke failed");
    await expect(
      executeSettingCommand(async () => {
        throw invocationError;
      }),
    ).rejects.toBe(invocationError);
  });

  test("accepts commands whose generated binding returns void", async () => {
    await expect(
      executeSettingCommand(async () => undefined),
    ).resolves.toBeUndefined();
  });
});
