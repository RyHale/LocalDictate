import { describe, expect, test } from "bun:test";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  ThemeManifestV1Schema,
  resolveThemeAssets,
  validateResolvedThemeManifest,
  type ThemeManifestV1,
} from "../src/themes";

const themesRoot = path.resolve(
  import.meta.dir,
  "../src-tauri/resources/themes",
);

function referencedAssets(manifest: ThemeManifestV1): string[] {
  const references = [manifest.preview];
  const { overlay } = manifest;

  switch (overlay.renderer) {
    case "reactive-image":
      references.push(...overlay.config.layers.map((layer) => layer.asset));
      break;
    case "sprite":
      references.push(...overlay.config.layers.map((layer) => layer.atlas));
      break;
    case "particles":
      references.push(overlay.config.reducedMotionAsset);
      break;
    case "web":
      references.push(
        overlay.config.entry,
        overlay.config.reducedMotionAsset,
        ...Object.values(overlay.config.assets ?? {}),
      );
      break;
  }

  return references;
}

describe("bundled theme packs", async () => {
  const directoryEntries = await readdir(themesRoot, { withFileTypes: true });
  const packDirectories = directoryEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  test("ships the four reference renderer packs", () => {
    expect(packDirectories).toEqual([
      "neon-codex",
      "pirate-scribe",
      "signal-garden",
      "stellar-murmuration",
    ]);
  });

  for (const directory of packDirectories) {
    test(`${directory} is schema-valid and self-contained`, async () => {
      const packRoot = path.join(themesRoot, directory);
      const manifest = ThemeManifestV1Schema.parse(
        JSON.parse(
          await readFile(path.join(packRoot, "manifest.json"), "utf8"),
        ),
      );

      expect(manifest.id).toBe(directory);
      for (const reference of referencedAssets(manifest)) {
        expect(path.isAbsolute(reference)).toBe(false);
        expect(reference.includes(".."), reference).toBe(false);
        await access(path.join(packRoot, reference));
      }

      const resolved = resolveThemeAssets(
        manifest,
        (reference) => `asset://localhost/${directory}/${reference}`,
      );
      expect(validateResolvedThemeManifest(resolved).success).toBe(true);

      if (manifest.overlay.renderer === "web") {
        const source = await readFile(
          path.join(packRoot, manifest.overlay.config.entry),
          "utf8",
        );
        expect(source).toMatch(/export\s+(?:default\s+)?(?:function\s+)?mount/);
        expect(source).not.toMatch(/\bimport\s*(?:\(|[{*\w])/);
      }
    });
  }
});
