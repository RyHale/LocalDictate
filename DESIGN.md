# LocalDictate Design System

## Direction

LocalDictate is a quiet Windows utility, not an assistant persona. The settings window should feel native, compact, and dependable. The recording overlay is the product's signature surface: small enough to ignore, clear enough to trust at a glance.

## Color

Use OKLCH tokens only for new or changed color values.

- Light background: `oklch(0.985 0.004 240)`
- Light text: `oklch(0.205 0.018 250)`
- Dark background: `oklch(0.205 0.012 250)`
- Dark text: `oklch(0.955 0.006 240)`
- Accent: `oklch(0.62 0.15 238)`
- Accent soft: derive from the accent with `color-mix`
- Recording: `oklch(0.64 0.2 25)`
- Success: `oklch(0.62 0.15 155)`
- Warning: `oklch(0.72 0.16 75)`
- Error: `oklch(0.62 0.2 25)`

Accent is reserved for the active selection, primary action, live caret, and processing state. Recording state uses both a red status mark and the word “Listening,” never color alone.

## Typography

Use the Windows system stack: `"Segoe UI Variable", "Segoe UI", system-ui, sans-serif`. Use one family throughout. Body text is 15px/24px. Labels and overlay state text are 12–13px. Headings are restrained and semibold; no display typography.

## Layout

The settings window uses the existing sidebar and grouped settings structure. Keep controls aligned to a predictable grid and keep the primary workflow above advanced controls. The bottom overlay remains horizontally centered near the screen edge and never steals focus.

## Components

- Overlay: compact pill at rest, clear listening waveform, timer, cancel control, and distinct transcribing/polishing labels.
- Buttons: one shared shape and hierarchy with visible hover, focus, active, disabled, loading, and error behavior.
- Inputs and selectors: standard Windows-friendly form controls with persistent labels and visible focus rings.
- Model cards: show model name, local/downloaded state, size, streaming capability, and one plain-language recommendation badge.
- Alerts: pair icon, title, and concise recovery action. Never rely on color alone.

## Shape and Elevation

Use modest radii: 8px for fields and cards, 12px for grouped surfaces, and a fully rounded recording pill. Prefer one-pixel borders and surface contrast over shadows. The overlay stays flat and opaque enough to read; no glass effects.

## Motion

Motion communicates state only. Use 150–250ms transitions for fades, focus, and control state. The live overlay may expand as text arrives, but it should not bounce or perform decorative entrance sequences. Respect `prefers-reduced-motion` by removing scaling, pulsing, caret blinking, and continuous waveform placeholders while keeping state text visible.

Opt-in theme packs may use decorative or character animation, but they must
still map recording lifecycle and microphone activity clearly, provide a
reduced-motion/static presentation, remain non-focusable, and fall back to the
classic overlay when invalid.

## Accessibility

Meet WCAG AA contrast for text and controls. Every interactive control needs a visible keyboard focus state. Provide non-color cues for all recording and error states. Keep hit targets at least 32px in dense settings and 40px for overlay cancellation. Use concise English copy and avoid unnecessary technical language in the primary path.

## Imagery

No decorative imagery in the default application chrome. Use a simple original
waveform mark for application and tray identity, plus Lucide line icons in
settings. Do not reuse Handy brand assets. Theme packs are a contained opt-in
surface and may include original raster art, sprites, particles, or sandboxed
code-driven visuals.
