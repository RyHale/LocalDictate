import { describe, expect, test } from "bun:test";

import {
  LEGACY_THEME_STORAGE_KEY,
  readStoredTheme,
  reducesWidgetMotion,
  THEME_STORAGE_KEY,
  UI_FONT_SIZE_OPTIONS,
  uiFontSizeAttribute,
  WIDGET_ANIMATION_OPTIONS,
  widgetAnimationAttribute,
} from "../src/lib/utils/theme";

const memoryStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
};

describe("appearance runtime choices", () => {
  test("migrates the legacy Handy theme key and prefers LocalDictate", () => {
    const legacyOnly = memoryStorage({
      [LEGACY_THEME_STORAGE_KEY]: "dark",
    });
    expect(readStoredTheme(legacyOnly)).toBe("dark");
    expect(legacyOnly.values.get(THEME_STORAGE_KEY)).toBe("dark");

    const both = memoryStorage({
      [THEME_STORAGE_KEY]: "light",
      [LEGACY_THEME_STORAGE_KEY]: "dark",
    });
    expect(readStoredTheme(both)).toBe("light");
  });

  test("keeps the existing interface scale as the default", () => {
    expect(UI_FONT_SIZE_OPTIONS).toEqual(["small", "default", "large"]);
    expect(uiFontSizeAttribute("small")).toBe("small");
    expect(uiFontSizeAttribute("default")).toBeUndefined();
    expect(uiFontSizeAttribute("large")).toBe("large");
  });

  test("maps Full, Reduced, and Off to explicit widget behavior", () => {
    expect(WIDGET_ANIMATION_OPTIONS).toEqual(["full", "reduced", "off"]);
    expect(widgetAnimationAttribute("full")).toBeUndefined();
    expect(widgetAnimationAttribute("reduced")).toBe("reduced");
    expect(widgetAnimationAttribute("off")).toBe("off");
    expect(reducesWidgetMotion("full")).toBe(false);
    expect(reducesWidgetMotion("reduced")).toBe(true);
    expect(reducesWidgetMotion("off")).toBe(true);
  });
});
