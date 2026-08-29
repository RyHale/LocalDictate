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
