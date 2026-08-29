import {
  commands,
  type Theme,
  type ThemeAccent,
  type UiFontSize,
  type WidgetAnimation,
} from "@/bindings";

/**
 * Appearance theme handling.
 *
 * LocalDictate ships a full light palette and a full dark palette (see
 * `App.css`). This module lets the user pick which one is used instead of
 * always following the OS:
 *  - `system` removes the override so the `prefers-color-scheme` media query
 *    governs (the historical behaviour).
 *  - `light` / `dark` set `data-theme` on the document root, whose
 *    higher-specificity CSS selectors win over the media query.
 *
 * The choice is persisted in `AppSettings` (source of truth) and mirrored to
 * localStorage so it can be applied synchronously on boot, before React mounts,
 * avoiding a flash of the wrong palette.
 */

export const THEME_STORAGE_KEY = "localdictate.theme";
export const LEGACY_THEME_STORAGE_KEY = "handy.theme";
export const THEME_ACCENT_STORAGE_KEY = "localdictate.theme-accent";
export const UI_FONT_SIZE_STORAGE_KEY = "localdictate.ui-font-size";
export const WIDGET_ANIMATION_STORAGE_KEY = "localdictate.widget-animation";

export const THEME_OPTIONS: Theme[] = ["system", "light", "dark"];
export const THEME_ACCENT_OPTIONS: ThemeAccent[] = [
  "blue",
  "violet",
  "teal",
  "rose",
  "amber",
];
export const UI_FONT_SIZE_OPTIONS: UiFontSize[] = ["small", "default", "large"];
export const WIDGET_ANIMATION_OPTIONS: WidgetAnimation[] = [
  "full",
  "reduced",
  "off",
];

const isTheme = (value: unknown): value is Theme =>
  value === "system" || value === "light" || value === "dark";

const isThemeAccent = (value: unknown): value is ThemeAccent =>
  THEME_ACCENT_OPTIONS.includes(value as ThemeAccent);

const isUiFontSize = (value: unknown): value is UiFontSize =>
  UI_FONT_SIZE_OPTIONS.includes(value as UiFontSize);

const isWidgetAnimation = (value: unknown): value is WidgetAnimation =>
  WIDGET_ANIMATION_OPTIONS.includes(value as WidgetAnimation);

export const uiFontSizeAttribute = (size: UiFontSize): string | undefined =>
  size === "default" ? undefined : size;

export const widgetAnimationAttribute = (
  level: WidgetAnimation,
): string | undefined => (level === "full" ? undefined : level);

export const reducesWidgetMotion = (level: WidgetAnimation): boolean =>
  level !== "full";

/** Apply a theme to the document root and remember it for the next launch. */
export const applyTheme = (theme: Theme): void => {
  const root = document.documentElement;
  if (theme === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = theme;
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // localStorage may be unavailable (e.g. private mode); the setting still
    // persists in AppSettings, so this only costs a one-frame flash on boot.
  }
};

/** Read the last-applied theme for synchronous boot-time application. */
export const readStoredTheme = (
  storage: Pick<Storage, "getItem" | "setItem">,
): Theme => {
  const stored = storage.getItem(THEME_STORAGE_KEY);
  if (isTheme(stored)) return stored;

  const legacy = storage.getItem(LEGACY_THEME_STORAGE_KEY);
  if (isTheme(legacy)) {
    storage.setItem(THEME_STORAGE_KEY, legacy);
    return legacy;
  }

  return "system";
};

export const getStoredTheme = (): Theme => {
  try {
    return readStoredTheme(localStorage);
  } catch {
    return "system";
  }
};

export const applyThemeAccent = (accent: ThemeAccent): void => {
  const root = document.documentElement;
  if (accent === "blue") delete root.dataset.accent;
  else root.dataset.accent = accent;
  try {
    localStorage.setItem(THEME_ACCENT_STORAGE_KEY, accent);
  } catch {
    // The persisted Rust setting remains the source of truth.
  }
};

export const getStoredThemeAccent = (): ThemeAccent => {
  try {
    const stored = localStorage.getItem(THEME_ACCENT_STORAGE_KEY);
    if (isThemeAccent(stored)) return stored;
  } catch {
    // Ignore storage failures and use the restrained blue default.
  }
  return "blue";
};

export const applyUiFontSize = (size: UiFontSize): void => {
  const root = document.documentElement;
  const attribute = uiFontSizeAttribute(size);
  if (attribute === undefined) delete root.dataset.uiFontSize;
  else root.dataset.uiFontSize = attribute;
  try {
    localStorage.setItem(UI_FONT_SIZE_STORAGE_KEY, size);
  } catch {
    // The persisted Rust setting remains the source of truth.
  }
};

export const getStoredUiFontSize = (): UiFontSize => {
  try {
    const stored = localStorage.getItem(UI_FONT_SIZE_STORAGE_KEY);
    if (isUiFontSize(stored)) return stored;
  } catch {
    // Ignore storage failures and preserve the existing interface scale.
  }
  return "default";
};

export const applyWidgetAnimation = (level: WidgetAnimation): void => {
  const root = document.documentElement;
  const attribute = widgetAnimationAttribute(level);
  if (attribute === undefined) delete root.dataset.widgetAnimation;
  else root.dataset.widgetAnimation = attribute;
  try {
    localStorage.setItem(WIDGET_ANIMATION_STORAGE_KEY, level);
  } catch {
    // The persisted Rust setting remains the source of truth.
  }
};

export const getStoredWidgetAnimation = (): WidgetAnimation => {
  try {
    const stored = localStorage.getItem(WIDGET_ANIMATION_STORAGE_KEY);
    if (isWidgetAnimation(stored)) return stored;
  } catch {
    // Ignore storage failures and preserve the existing full-motion default.
  }
  return "full";
};

/** Apply the persisted theme from AppSettings (the source of truth). */
export const syncThemeFromSettings = async (): Promise<void> => {
  try {
    const result = await commands.getAppSettings();
    if (result.status === "ok") {
      applyTheme(result.data.theme ?? "system");
      applyThemeAccent(result.data.theme_accent ?? "blue");
      applyUiFontSize(result.data.ui_font_size ?? "default");
      applyWidgetAnimation(result.data.widget_animation ?? "full");
    }
  } catch (e) {
    console.warn("Failed to sync theme from settings:", e);
  }
};
