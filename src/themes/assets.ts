import type { ThemeManifestV1 } from "./schema";

export type ThemeAssetRole =
  | "preview"
  | "image"
  | "sprite-atlas"
  | "reduced-motion"
  | "web-entry"
  | "web-asset";

export interface ThemeAssetContext {
  themeId: string;
  role: ThemeAssetRole;
  key?: string;
}

export type ThemeAssetResolver = (
  reference: string,
  context: ThemeAssetContext,
) => string;

/**
 * Resolves every asset reference without giving renderers filesystem access.
 * Importers should validate files first; the resolver should return app-owned
 * local, blob, or data URLs.
 */
export function resolveThemeAssets(
  manifest: ThemeManifestV1,
  resolve: ThemeAssetResolver,
): ThemeManifestV1 {
  const context = (role: ThemeAssetRole, key?: string): ThemeAssetContext => ({
    themeId: manifest.id,
    role,
    key,
  });

  const preset = manifest.preset ? { ...manifest.preset } : undefined;

  const overlay = (() => {
    switch (manifest.overlay.renderer) {
      case "reactive-image":
        return {
          ...manifest.overlay,
          config: {
            ...manifest.overlay.config,
            layers: manifest.overlay.config.layers.map((layer, index) => ({
              ...layer,
              asset: resolve(
                layer.asset,
                context("image", `layers.${index}.asset`),
              ),
            })),
          },
        };
      case "sprite":
        return {
          ...manifest.overlay,
          config: {
            ...manifest.overlay.config,
            layers: manifest.overlay.config.layers.map((layer, index) => ({
              ...layer,
              atlas: resolve(
                layer.atlas,
                context("sprite-atlas", `layers.${index}.atlas`),
              ),
            })),
          },
        };
      case "particles":
        return {
          ...manifest.overlay,
          config: {
            ...manifest.overlay.config,
            reducedMotionAsset: resolve(
              manifest.overlay.config.reducedMotionAsset,
              context("reduced-motion"),
            ),
          },
        };
      case "web": {
        const assets = manifest.overlay.config.assets
          ? Object.fromEntries(
              Object.entries(manifest.overlay.config.assets).map(
                ([key, reference]) => [
                  key,
                  resolve(reference, context("web-asset", key)),
                ],
              ),
            )
          : undefined;

        return {
          ...manifest.overlay,
          config: {
            ...manifest.overlay.config,
            entry: resolve(manifest.overlay.config.entry, context("web-entry")),
            assets,
            reducedMotionAsset: resolve(
              manifest.overlay.config.reducedMotionAsset,
              context("reduced-motion"),
            ),
          },
        };
      }
    }
  })();

  return {
    ...manifest,
    preview: resolve(manifest.preview, context("preview")),
    overlay,
    preset,
  };
}

const TAURI_LOCAL_HOSTS = new Set(["asset.localhost", "ipc.localhost"]);

/** Rejects remote URLs at the final renderer boundary. */
export function isSafeResolvedThemeAssetUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "blob:") {
      return true;
    }
    if (url.protocol === "asset:" || url.protocol === "ipc:") {
      return (
        url.hostname === "" ||
        TAURI_LOCAL_HOSTS.has(url.hostname) ||
        url.hostname === "localhost"
      );
    }
    if (url.protocol === "data:") {
      return /^(data:image\/|data:audio\/|data:text\/javascript(?:[;,])|data:application\/javascript(?:[;,]))/i.test(
        value,
      );
    }
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      TAURI_LOCAL_HOSTS.has(url.hostname)
    );
  } catch {
    return false;
  }
}

export function assertSafeResolvedThemeAssetUrl(value: string): string {
  if (!isSafeResolvedThemeAssetUrl(value)) {
    throw new Error("Theme asset URL is not an app-owned local URL");
  }
  return value;
}
