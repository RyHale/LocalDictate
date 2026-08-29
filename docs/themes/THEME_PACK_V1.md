# LocalDictate Theme Pack v1

Status: implementation contract

## Purpose

A LocalDictate theme is an opt-in preset bundle. It can change the recording
overlay, application appearance, and the selected post-processing profile in
one action. Those underlying settings remain
independent: after a theme is applied, changing one setting does not silently
reapply the theme.

Theme packs are also the public mod boundary. Built-in and user-installed
themes use the same manifest and renderer APIs.

## Package layout

```text
my-theme/
  manifest.json
  preview.png
  assets/
  web/
    theme.js
```

The settings UI installs a pack by selecting its directory. The backend command
also accepts the directory's `manifest.json`. The app copies validated files
into its application-data theme directory; archive/ZIP import is not part of
v1. Pack IDs are lowercase ASCII slugs and are the stable setting value.

## Manifest shape

```json
{
  "schemaVersion": 1,
  "id": "pirate-scribe",
  "name": "Pirate Scribe",
  "description": "A salty quartermaster records every word.",
  "author": "LocalDictate",
  "preview": "preview.png",
  "overlay": {
    "renderer": "sprite",
    "width": 384,
    "height": 256,
    "anchor": "bottom-center",
    "pointerMode": "passthrough",
    "config": {
      "layers": [
        {
          "atlas": "assets/pirate-atlas.png",
          "columns": 1,
          "rows": 1,
          "clips": {
            "still": { "from": 0, "to": 0, "fps": 1, "loop": true }
          },
          "lifecycleClips": {
            "idle": "still",
            "arming": "still",
            "listening": "still",
            "transcribing": "still",
            "processing": "still"
          },
          "reducedMotionFrame": 0
        }
      ]
    }
  },
  "preset": {
    "appearance": "dark",
    "accent": "amber",
    "postProcessing": {
      "enabled": true,
      "profile": {
        "id": "theme:pirate-scribe",
        "name": "Pirate polish",
        "prompt": "..."
      }
    }
  }
}
```

`preset` fields are optional. Applying a pack changes only fields present in
the preset. Selecting a theme must never delete a user's existing profiles or
provider credentials. A bundled profile is inserted or updated by its stable
theme-owned ID and then selected.

## Overlay signals

Every renderer uses the same normalized signal. Built-in canvases draw at
animation-frame speed using the latest signal:

```ts
interface ThemeSignal {
  lifecycle: "idle" | "arming" | "listening" | "transcribing" | "processing";
  energy: number; // 0..1, fast attack and gentle release
  cadence: number; // 0..1, rolling speech-envelope activity
  voiceActivity: boolean;
  spectrum: number[]; // 16 normalized buckets
  elapsedSeconds: number;
  committedText: string;
  tentativeText: string;
  reducedMotion: boolean;
}
```

The native backend remains capped near 30 audio updates per second. Renderers
interpolate locally and must not request raw microphone samples.

## Renderer types

### `reactive-image`

Draws one or more transparent images. Declarative bindings may map signal
values to opacity, scale, rotation, translation, tint, blur, or glow. This is
the simple authoring path for a glowing microphone or layered character.

### `sprite`

Draws fixed-size frames from one or more PNG atlases. Named clips map semantic
lifecycle states to frame ranges. Playback speed and layer intensity may be
bound to energy or cadence. Animated GIF/APNG/WebP are not animation sources
because they cannot be reliably sought or retimed.

### `particles`

Runs the built-in Canvas 2D particle engine from declarative emitter, force,
color, lifetime, blend, and signal-binding settings. No theme code is needed.

### `web`

Advanced mods may provide a JavaScript entry point for arbitrary DOM, Canvas,
or WebGL rendering. It runs inside a sandboxed iframe with a narrow
`postMessage` bridge. It receives `ThemeSignal` and resolved asset URLs only.
It does not receive Tauri APIs, filesystem access, credentials, clipboard
access, or parent DOM access. Network access is disabled by the iframe content
security policy. The settings UI labels these packs as code themes and requires
an explicit trust confirmation before installation.

The entry is a self-contained ES module exporting `mount` or a default
function. Relative, static, and remote module imports are not supported; authors
must bundle dependencies into the entry. In reduced-motion mode the iframe is
not mounted and the declared static PNG is shown instead.

## Art contract

- PNG with real alpha is the baseline image format.
- Logical canvas dimensions are declared in the manifest; 2x assets are
  recommended for high-DPI displays.
- All cells in a sprite atlas share dimensions and use a bottom-center
  registration point.
- Atlases are limited to 4096x4096 pixels in v1.
- All PNG files are limited to 4096x4096 pixels. Packs are limited to 512
  regular files and 25 MiB after import in v1; symlinks are rejected.
- A preview PNG is required. Sprite packs declare one reduced-motion frame;
  particle and web packs declare a reduced-motion PNG. Reactive-image packs do
  not have a separate reduced-motion asset in v1.
- Built-in renderers must remain useful without animation or color.

## Window and input behavior

Theme dimensions drive the native transparent overlay window. Theme packs choose
one of nine screen anchors (`top`, `center`, or `bottom` crossed with `left`,
`center`, or `right`); this overrides the Classic overlay's user-controlled
top/bottom position. Art-only themes should use pointer passthrough so
transparent bounds do not block desktop interaction. The classic compact
controls remain the accessible fallback. Themes cannot request keyboard focus.

On Windows, LocalDictate adds a compact host-owned drag grip to an active
theme. Dragging the grip temporarily overrides the manifest anchor for the rest
of the app session, including recording and processing state changes. Changing
the active pack or explicitly choosing the Top/Bottom widget position returns
the theme to its configured anchor. The full theme canvas keeps its manifest
pointer behavior; the grip is a separate native surface so a passthrough canvas
does not become a transparent desktop dead zone. macOS panels and Linux
layer-shell overlays remain system/compositor-anchored in v1 and do not expose
the free-position grip.

## Compatibility and failure behavior

- Unknown schema versions or renderer names are rejected with a readable error.
- The importer rejects unsafe or missing referenced assets. The overlay runtime
  performs the stricter renderer-specific validation and uses Classic if a
  malformed renderer config or asset fails at runtime.
- If the selected pack is removed or fails to load, the overlay uses the
  built-in classic theme and leaves other settings unchanged.
- Theme errors are isolated from transcription; speech capture and paste must
  continue even if rendering fails.

The complete public field reference, minimal manifests, web mount API, and local
test workflow are in [AUTHORING.md](AUTHORING.md).
