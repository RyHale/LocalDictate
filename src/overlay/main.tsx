import React from "react";
import ReactDOM from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import RecordingOverlay from "./RecordingOverlay";
import {
  applyTheme,
  applyThemeAccent,
  applyUiFontSize,
  applyWidgetAnimation,
  getStoredTheme,
  getStoredThemeAccent,
  getStoredUiFontSize,
  getStoredWidgetAnimation,
  syncThemeFromSettings,
} from "@/lib/utils/theme";
import type {
  Theme,
  ThemeAccent,
  UiFontSize,
  WidgetAnimation,
} from "@/bindings";
import "@/i18n";

// A separate webview from the settings window, so the overlay has to set
// `data-theme` on its own document: last-known theme before render (shared
// localStorage) to avoid a flash, reconcile with the persisted setting in case
// the overlay booted first, then follow live changes.
applyTheme(getStoredTheme());
applyThemeAccent(getStoredThemeAccent());
applyUiFontSize(getStoredUiFontSize());
applyWidgetAnimation(getStoredWidgetAnimation());
syncThemeFromSettings();
listen<Theme>("theme-changed", (event) => applyTheme(event.payload));
listen<ThemeAccent>("theme-accent-changed", (event) =>
  applyThemeAccent(event.payload),
);
listen<UiFontSize>("ui-font-size-changed", (event) =>
  applyUiFontSize(event.payload),
);
listen<WidgetAnimation>("widget-animation-changed", (event) =>
  applyWidgetAnimation(event.payload),
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RecordingOverlay />
  </React.StrictMode>,
);
