import { describe, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dir, "..");

async function findWaveFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const matches = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return findWaveFiles(entryPath);
      }
      return entry.name.toLowerCase().endsWith(".wav") ? [entryPath] : [];
    }),
  );
  return matches.flat();
}

describe("feedback sounds are retired", () => {
  test("the transcription path and settings UI contain no playback hooks", async () => {
    const productionFiles = [
      "src-tauri/Cargo.toml",
      "src-tauri/src/actions.rs",
      "src-tauri/src/commands/audio.rs",
      "src-tauri/src/lib.rs",
      "src-tauri/src/shortcut/mod.rs",
      "src/bindings.ts",
      "src/stores/settingsStore.ts",
      "src/components/settings/general/GeneralSettings.tsx",
      "src/components/settings/debug/DebugSettings.tsx",
    ];
    const productionSource = (
      await Promise.all(
        productionFiles.map((file) =>
          readFile(path.join(repositoryRoot, file), "utf8"),
        ),
      )
    ).join("\n");

    for (const retiredHook of [
      "audio_feedback",
      "play_feedback_sound",
      "play_test_sound",
      "selected_output_device",
      "SoundPicker",
      "AudioFeedback",
      "rodio",
    ]) {
      expect(productionSource).not.toContain(retiredHook);
    }
  });

  test("no feedback cue files are bundled", async () => {
    const waveFiles = await findWaveFiles(
      path.join(repositoryRoot, "src-tauri/resources"),
    );
    expect(waveFiles).toEqual([]);
  });
});
