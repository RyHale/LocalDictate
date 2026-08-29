import { describe, expect, test } from "bun:test";

import {
  ThemeManifestV1Schema,
  createDemoThemeSignal,
  createThemeSignalBuilder,
  isSafeResolvedThemeAssetUrl,
  resolveThemeAssets,
  validateResolvedThemeManifest,
  validateThemeManifest,
} from "../src/themes";
import { interpolateCanvasSignal } from "../src/themes/renderers/canvas";

const reactiveManifest = {
  schemaVersion: 1,
  id: "test-glow",
  name: "Test glow",
  description: "A test-only reactive image.",
  author: "Tests",
  preview: "preview.png",
  overlay: {
    renderer: "reactive-image",
    width: 320,
    height: 180,
    anchor: "bottom-center",
    pointerMode: "passthrough",
    config: {
      layers: [
        {
          asset: "assets/image.png",
          width: 160,
          height: 160,
          glow: {
            color: "#00ffff",
            radius: { source: "energy", output: [0, 24] },
          },
        },
      ],
    },
  },
} as const;

describe("theme manifest v1", () => {
  test("accepts a strict reactive-image manifest", () => {
    expect(validateThemeManifest(reactiveManifest).success).toBe(true);
  });

  test("rejects unknown properties and schema versions", () => {
    expect(
      ThemeManifestV1Schema.safeParse({ ...reactiveManifest, unknown: true })
        .success,
    ).toBe(false);
    expect(
      ThemeManifestV1Schema.safeParse({ ...reactiveManifest, schemaVersion: 2 })
        .success,
    ).toBe(false);
  });

  test("rejects retired sound presets", () => {
    expect(
      ThemeManifestV1Schema.safeParse({
        ...reactiveManifest,
        preset: { sound: { start: "sounds/start.wav" } },
      }).success,
    ).toBe(false);
  });

  test("rejects asset traversal and Windows-normalization variants", () => {
    for (const asset of [
      "../outside.png",
      "assets/../outside.png",
      "assets\\outside.png",
      "C:/outside.png",
      "assets/outside.png.",
      "assets/outside.png ",
      "assets/outside",
    ]) {
      expect(
        ThemeManifestV1Schema.safeParse({
          ...reactiveManifest,
          overlay: {
            ...reactiveManifest.overlay,
            config: { layers: [{ asset }] },
          },
        }).success,
      ).toBe(false);
    }
  });

  test("accepts every native overlay anchor", () => {
    for (const anchor of [
      "top-left",
      "top-center",
      "top-right",
      "center-left",
      "center",
      "center-right",
      "bottom-left",
      "bottom-center",
      "bottom-right",
    ]) {
      expect(
        ThemeManifestV1Schema.safeParse({
          ...reactiveManifest,
          overlay: { ...reactiveManifest.overlay, anchor },
        }).success,
      ).toBe(true);
    }
  });

  test("validates lifecycle clip references", () => {
    const sprite = {
      ...reactiveManifest,
      overlay: {
        ...reactiveManifest.overlay,
        renderer: "sprite",
        config: {
          layers: [
            {
              atlas: "assets/atlas.png",
              columns: 4,
              rows: 2,
              clips: { idle: { from: 0, to: 0, fps: 1 } },
              lifecycleClips: {
                idle: "idle",
                arming: "missing",
                listening: "idle",
                transcribing: "idle",
                processing: "idle",
              },
              reducedMotionFrame: 0,
            },
          ],
        },
      },
    };
    expect(ThemeManifestV1Schema.safeParse(sprite).success).toBe(false);
  });

  test("resolves assets through one host-owned boundary", () => {
    const manifest = ThemeManifestV1Schema.parse(reactiveManifest);
    const resolved = resolveThemeAssets(
      manifest,
      (reference) => `asset://localhost/${reference}`,
    );
    expect(resolved.preview).toBe("asset://localhost/preview.png");
    if (resolved.overlay.renderer !== "reactive-image") {
      throw new Error("Unexpected renderer");
    }
    expect(resolved.overlay.config.layers[0].asset).toBe(
      "asset://localhost/assets/image.png",
    );
  });

  test("accepts host-resolved app asset URLs at the renderer boundary", () => {
    const manifest = ThemeManifestV1Schema.parse(reactiveManifest);
    const resolved = resolveThemeAssets(
      manifest,
      (reference) => `asset://localhost/${reference}`,
    );

    expect(validateResolvedThemeManifest(resolved).success).toBe(true);
  });

  test("rejects remote asset URLs at the renderer boundary", () => {
    const manifest = ThemeManifestV1Schema.parse(reactiveManifest);
    const resolved = resolveThemeAssets(
      manifest,
      (reference) => `https://example.com/${reference}`,
    );

    expect(validateResolvedThemeManifest(resolved).success).toBe(false);
  });
});

describe("theme signals", () => {
  test("normalizes spectrum and applies attack/release smoothing", () => {
    let nowMs = 0;
    const builder = createThemeSignalBuilder({
      now: () => nowMs,
      reducedMotion: true,
    });
    const quiet = builder.update({
      lifecycle: "listening",
      spectrum: [],
    });
    nowMs += 33;
    const loud = builder.update({
      lifecycle: "listening",
      spectrum: Array(16).fill(1),
    });
    nowMs += 33;
    const releasing = builder.update({
      lifecycle: "listening",
      spectrum: Array(16).fill(0),
    });

    expect(quiet.spectrum).toHaveLength(16);
    expect(loud.energy).toBeGreaterThan(0);
    expect(loud.voiceActivity).toBe(true);
    expect(releasing.energy).toBeGreaterThan(0);
    expect(releasing.energy).toBeLessThan(loud.energy);
    expect(releasing.reducedMotion).toBe(true);
  });

  test("produces deterministic demo signals", () => {
    expect(createDemoThemeSignal(1.25)).toEqual(createDemoThemeSignal(1.25));
  });

  test("interpolates animation time between native signal updates", () => {
    const signal = createDemoThemeSignal(2);
    expect(interpolateCanvasSignal(signal, 1_000, 1_075).elapsedSeconds).toBe(
      2.075,
    );
    expect(
      interpolateCanvasSignal({ ...signal, reducedMotion: true }, 1_000, 1_075)
        .elapsedSeconds,
    ).toBe(2);
  });
});

describe("web asset policy", () => {
  test("allows local app URLs and rejects remote or executable URLs", () => {
    expect(isSafeResolvedThemeAssetUrl("asset://localhost/image.png")).toBe(
      true,
    );
    expect(
      isSafeResolvedThemeAssetUrl("http://asset.localhost/image.png"),
    ).toBe(true);
    expect(isSafeResolvedThemeAssetUrl("https://example.com/theme.js")).toBe(
      false,
    );
    expect(isSafeResolvedThemeAssetUrl("javascript:alert(1)")).toBe(false);
  });
});
