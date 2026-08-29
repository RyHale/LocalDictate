# Authoring LocalDictate Theme Packs

Theme Pack v1 lets a mod change the recording overlay and optionally apply an
appearance and post-processing preset. A pack is a normal
directory. ZIP and other archive imports are not supported in v1.

The fastest starting point is to copy one of the four bundled examples:

- [Neon Codex](../../src-tauri/resources/themes/neon-codex/manifest.json) uses
  the `reactive-image` renderer.
- [Pirate Scribe](../../src-tauri/resources/themes/pirate-scribe/manifest.json)
  uses the `sprite` renderer and a post-processing profile.
- [Stellar Murmuration](../../src-tauri/resources/themes/stellar-murmuration/manifest.json)
  uses the declarative `particles` renderer.
- [Signal Garden](../../src-tauri/resources/themes/signal-garden/manifest.json)
  uses the sandboxed `web` renderer.

## Install, apply, and remove

Open the Themes setting and choose **Install theme**, then select the directory
that contains `manifest.json`. Installation validates and copies the pack into
LocalDictate's application-data theme directory. It does not apply the pack.
The backend install command also accepts a direct path to `manifest.json`, but
the current file picker selects directories.

Choose **Apply** after installation. Applying a pack:

1. activates its overlay;
2. changes only the appearance, accent, and post-processing fields that
   are present in `preset`; and
3. leaves those settings independently editable afterward.

A theme is a one-time preset, not a permanent lock. It does not silently
reapply itself after you change an individual setting. Installing the same ID
again updates that installed pack. IDs used by bundled packs cannot be
overridden.

Only installed packs can be removed. Classic and bundled packs cannot. If you
remove the active installed pack, the overlay falls back to Classic. Appearance
and post-processing changes already applied by the pack remain individual
settings.

Web themes contain executable JavaScript. LocalDictate shows a code warning and
requires explicit confirmation before copying one. Declarative themes do not
show that warning.

## Package layout

Only `manifest.json` and the files it references are structurally required.
Folders are conventions, so keep the layout simple:

```text
my-theme/
  manifest.json
  preview.png
  assets/
    artwork.png
  web/
    theme.js
```

Rules that apply to the entire directory:

- At most 512 regular files and 25 MiB total after copying.
- No symbolic links.
- Allowed extensions are `.png`, `.json`, `.js`, `.css`, `.glsl`,
  `.vert`, `.frag`, and `.txt`.
- Every PNG must have a valid PNG header and dimensions from 1x1 through
  4096x4096.
- Asset references use `/`, are relative to the pack root, and cannot contain
  `..`, `.`, backslashes, drive letters, absolute paths, colons, or NUL bytes.
- Asset references are 1-2048 characters in the renderer schema.
- Referenced assets must be regular files inside the pack.

The importer copies a validated directory. Do not make a theme depend on files
elsewhere on the machine.

## Manifest fields

The manifest is strict JSON. Unknown fields are rejected by the frontend schema;
unknown top-level, overlay, and preset fields are also rejected by the importer.

| Field           | Required | v1 value                                                                                                              |
| --------------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion` | yes      | Integer `1`.                                                                                                          |
| `id`            | yes      | 1-64 characters matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`. `classic` is reserved. Treat this as permanent.                |
| `name`          | yes      | Non-blank display name, at most 100 UTF-8 bytes at import. Plain ASCII stays within the limit one byte per character. |
| `description`   | yes      | 1-500 characters.                                                                                                     |
| `author`        | yes      | 1-128 characters.                                                                                                     |
| `preview`       | yes      | Relative path to a valid PNG. A 16:9 preview works best in the picker.                                                |
| `overlay`       | yes      | One renderer and its canvas/window settings.                                                                          |
| `preset`        | no       | Optional one-time settings changes.                                                                                   |

Every overlay has these fields:

| Field         | Required | v1 value                                                                                                                                                                                                                |
| ------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `renderer`    | yes      | `reactive-image`, `sprite`, `particles`, or `web`.                                                                                                                                                                      |
| `width`       | yes      | Integer logical pixels from 32 through 2048.                                                                                                                                                                            |
| `height`      | yes      | Integer logical pixels from 32 through 2048.                                                                                                                                                                            |
| `anchor`      | yes      | `top-left`, `top-center`, `top-right`, `center-left`, `center`, `center-right`, `bottom-left`, `bottom-center`, or `bottom-right`. Custom themes use this instead of the Classic overlay's top/bottom position setting. |
| `pointerMode` | yes      | `passthrough` or `interactive`.                                                                                                                                                                                         |
| `config`      | yes      | Renderer-specific object described below.                                                                                                                                                                               |

Use `passthrough` for art. It keeps the full transparent native rectangle from
blocking clicks in the application underneath. `interactive` makes that native
rectangle receive pointer input, but v1 renderers expose no theme click API and
the web iframe is pointer-disabled. It is therefore useful only for host-owned
controls, not ordinary public mods.

All renderer canvases use logical pixels and are scaled for the display's pixel
density. Coordinates start at the canvas top-left: positive X goes right and
positive Y goes down.

`overlay.anchor` positions the native theme window on the current monitor.
Left/right and top/bottom anchors keep the window near that edge; `center`
values center it on that axis. This is separate from image-layer and sprite
registration inside the window.

On Windows, the host renders a separate compact drag grip for active themes. A
user drag overrides `overlay.anchor` for the current app session and survives
overlay lifecycle changes. Applying another pack or changing the Top/Bottom
widget setting resets the custom origin. The theme canvas itself continues to
follow `pointerMode`; passthrough art does not become interactive. macOS panels
and Linux layer-shell surfaces remain system/compositor-anchored in v1, so the
free-position grip is not shown there.

### General image rules

- Use PNG artwork with real alpha when the native window should look
  non-rectangular. Opaque pixels remain visible; transparent pixels do not make
  an `interactive` window click-through.
- Design at the manifest's logical canvas size. Exporting artwork at 2x and
  drawing it at logical size gives better high-DPI results.
- Leave transparent padding for glow, rotation, and motion so effects do not hit
  the canvas edge.
- Keep important art inside the canvas at every bound energy/cadence extreme.
- Make `preview.png` legible at a small 16:9 card size. The preview does not have
  to match the overlay canvas dimensions.

## Signals

All renderers receive the same signal:

```ts
interface ThemeSignal {
  lifecycle: "idle" | "arming" | "listening" | "transcribing" | "processing";
  energy: number; // 0..1; normalized loudness with fast attack and slower release
  cadence: number; // 0..1; recent speech-envelope onsets, not words per minute
  voiceActivity: boolean;
  spectrum: number[]; // exactly 16 normalized buckets
  elapsedSeconds: number; // seconds since the current overlay session began
  committedText: string;
  tentativeText: string;
  reducedMotion: boolean;
}
```

`arming` lasts until microphone samples arrive. `listening` covers active
capture. The two work states distinguish transcription from post-processing.
Audio levels normally arrive near 30 times per second; built-in canvases draw at
animation-frame speed with the latest signal. Themes never receive raw audio.

Declarative renderers can bind numbers to `energy` or `cadence`. Web themes can
read every signal field.

## Numeric bindings

Any field marked **binding** accepts either a finite number or this object:

```json
{
  "source": "energy",
  "input": [0.1, 0.8],
  "output": [4, 28],
  "easing": "ease-out",
  "clamp": true
}
```

| Field    | Required | Meaning                                                                   |
| -------- | -------- | ------------------------------------------------------------------------- |
| `source` | yes      | `energy` or `cadence`.                                                    |
| `input`  | no       | Two finite numbers; defaults to `[0, 1]`.                                 |
| `output` | yes      | Two finite output numbers. Reversed ranges are allowed.                   |
| `easing` | no       | `linear`, `ease-in`, `ease-out`, or `ease-in-out`; default is `linear`.   |
| `clamp`  | no       | Defaults to `true`. `false` allows extrapolation outside the input range. |

The runtime normalizes the source through `input`, applies easing, then maps it
to `output`. If both input endpoints are equal, progress is zero. Binding output
is not universally clamped: each consuming property decides whether negative or
out-of-range values make sense.

Fields named `color` accept CSS color strings. Blend modes are `source-over`,
`lighter`, `multiply`, `screen`, `overlay`, `darken`, or `lighten`.

## `reactive-image`

This renderer draws 1-32 PNG layers in manifest order. It is the easiest way to
make a microphone glow, a logo breathe, or a character assemble from layers.

Minimal valid manifest:

```json
{
  "schemaVersion": 1,
  "id": "glow-mic",
  "name": "Glow Mic",
  "description": "A microphone that brightens with speech.",
  "author": "Example Author",
  "preview": "preview.png",
  "overlay": {
    "renderer": "reactive-image",
    "width": 320,
    "height": 220,
    "anchor": "bottom-center",
    "pointerMode": "passthrough",
    "config": {
      "layers": [
        {
          "asset": "assets/microphone.png",
          "glow": {
            "color": "#55e8ff",
            "radius": { "source": "energy", "output": [4, 28] }
          }
        }
      ]
    }
  }
}
```

Each layer supports:

| Field             | Type/default                                                     | Meaning                                                                           |
| ----------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `asset`           | relative asset, required                                         | PNG to draw.                                                                      |
| `x`, `y`          | binding; canvas center                                           | Layer anchor position.                                                            |
| `width`, `height` | positive number; image size                                      | Draw size before scale. These are not bindings.                                   |
| `scale`           | binding; `1`                                                     | Uniform scale.                                                                    |
| `rotation`        | binding; `0`                                                     | Degrees clockwise.                                                                |
| `opacity`         | binding; `1`                                                     | Clamped to 0..1 while drawing.                                                    |
| `blur`            | binding; `0`                                                     | Blur radius in logical pixels; negative results become zero.                      |
| `glow`            | object; none                                                     | `color`, required `radius` binding, and optional `opacity` binding (default `1`). |
| `tint`            | object; none                                                     | `color` and required `opacity` binding.                                           |
| `blendMode`       | blend mode; `source-over`                                        | Canvas compositing mode.                                                          |
| `anchor`          | `top-left`, `top-center`, `center`, or `bottom-center`; `center` | Registration point inside this layer. This is separate from `overlay.anchor`.     |

The renderer does not change its behavior for the `reducedMotion` signal and it
does not substitute a separate static image. Keep scale, rotation, and
translation ranges restrained, or use an effectively static configuration if
reduced-motion behavior is important.

## `sprite`

This renderer draws 1-16 grid atlases. Every layer chooses a named clip from the
current lifecycle and draws frames left-to-right, then top-to-bottom.

Minimal valid manifest:

```json
{
  "schemaVersion": 1,
  "id": "tiny-scribe",
  "name": "Tiny Scribe",
  "description": "A two-frame note-taking character.",
  "author": "Example Author",
  "preview": "preview.png",
  "overlay": {
    "renderer": "sprite",
    "width": 256,
    "height": 192,
    "anchor": "bottom-center",
    "pointerMode": "passthrough",
    "config": {
      "layers": [
        {
          "atlas": "assets/scribe.png",
          "columns": 2,
          "rows": 1,
          "clips": {
            "still": { "from": 0, "to": 0, "fps": 1, "loop": true },
            "write": { "from": 0, "to": 1, "fps": 6, "loop": true }
          },
          "lifecycleClips": {
            "idle": "still",
            "arming": "still",
            "listening": "write",
            "transcribing": "still",
            "processing": "still"
          },
          "reducedMotionFrame": 0
        }
      ]
    }
  }
}
```

Each layer supports:

| Field                       | Type/default                                   | Meaning                                                                    |
| --------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------- |
| `atlas`                     | relative asset, required                       | PNG grid.                                                                  |
| `columns`, `rows`           | positive integers, required, each at most 4096 | Declared grid.                                                             |
| `frameWidth`, `frameHeight` | positive number; atlas/grid size               | Optional explicit source-frame size, each at most 4096.                    |
| `clips`                     | non-empty object, required                     | Map from a clip name to its frame range.                                   |
| `lifecycleClips`            | object, required                               | Exactly one valid clip name for each of the five lifecycle values.         |
| `reducedMotionFrame`        | non-negative integer, required                 | One atlas frame used for every lifecycle when reduced motion is requested. |
| `x`, `y`                    | finite number; bottom-center                   | Static destination anchor. These are not bindings.                         |
| `scale`                     | binding; `1`                                   | Uniform draw scale; negative results become zero.                          |
| `opacity`                   | binding; `1`                                   | Clamped to 0..1.                                                           |
| `speed`                     | binding; `1`                                   | Multiplier applied to clip FPS; negative results become zero.              |
| `blendMode`                 | blend mode; `source-over`                      | Canvas compositing mode.                                                   |

A clip has `from` and `to` inclusive, non-negative integers; `to` must be at
least `from`. `fps` must be greater than zero and no more than 120. `loop`
defaults to `true` when omitted. Every referenced frame and
`reducedMotionFrame` must be less than `columns * rows`.

Animation uses session-wide `elapsedSeconds`; a newly entered lifecycle does
not restart its clip clock at frame zero. Loop late-stage clips such as
`transcribing`, or use a one-frame clip, if their starting frame matters.

### Sprite art rules

- Use a transparent PNG grid with no gaps between cells.
- Keep every cell the same pixel size and make atlas dimensions divide cleanly
  by `columns` and `rows` unless you set `frameWidth` and `frameHeight`.
- Keep the subject on the same baseline in every frame. The renderer registers
  every frame at bottom-center.
- Put transparent padding inside each cell for glows, hair, tools, and motion.
  Do not crop each frame to different content bounds.
- Keep the full PNG at or below 4096x4096. Split large work into multiple layers
  if needed.
- Export at 2x the logical display size for crisp high-DPI art, then set `scale`
  or the overlay dimensions accordingly.
- Reserve one calm frame for `reducedMotionFrame`.
- PNG atlases are the v1 animation source. Animated GIF, APNG, WebP, and video
  are not supported pack files.

## `particles`

This renderer creates a procedural Canvas 2D field from 1-32 declarative
emitters. It needs no JavaScript and therefore does not trigger the code-theme
warning.

Minimal valid manifest:

```json
{
  "schemaVersion": 1,
  "id": "blue-sparks",
  "name": "Blue Sparks",
  "description": "Small sparks rise with speech energy.",
  "author": "Example Author",
  "preview": "preview.png",
  "overlay": {
    "renderer": "particles",
    "width": 360,
    "height": 180,
    "anchor": "bottom-center",
    "pointerMode": "passthrough",
    "config": {
      "emitters": [
        {
          "x": 180,
          "y": 150,
          "rate": { "source": "energy", "output": [2, 80] },
          "maxParticles": 300,
          "lifetimeSeconds": 1.5,
          "speed": 40,
          "directionDegrees": 270,
          "spreadDegrees": 70,
          "size": 4,
          "colors": ["#55e8ff", "#ffffff"]
        }
      ],
      "reducedMotionAsset": "assets/static-sparks.png"
    }
  }
}
```

Configuration fields:

| Field                | Type/default             | Meaning                                                    |
| -------------------- | ------------------------ | ---------------------------------------------------------- |
| `background`         | CSS color; transparent   | Optional full-canvas fill.                                 |
| `emitters`           | array, required          | 1-32 emitters.                                             |
| `reducedMotionAsset` | relative asset, required | Static PNG drawn with contain sizing instead of particles. |

Each emitter has:

| Field                  | Type/default                                   | Meaning                                                                  |
| ---------------------- | ---------------------------------------------- | ------------------------------------------------------------------------ |
| `x`, `y`               | binding, required                              | Emission origin in logical pixels.                                       |
| `rate`                 | binding, required                              | Particles per second used to size the procedural field. Zero draws none. |
| `maxParticles`         | integer 1..5000, required                      | Per-emitter cap.                                                         |
| `lifetimeSeconds`      | number greater than 0 and at most 60, required | Particle lifetime.                                                       |
| `speed`                | binding, required                              | Initial logical pixels per second; negative results become zero.         |
| `directionDegrees`     | binding, required                              | `0` is right, `90` is down, `270` is up.                                 |
| `spreadDegrees`        | number 0..360, required                        | Random angular spread around the direction.                              |
| `gravityX`, `gravityY` | finite number; `0`                             | Constant acceleration in logical pixels per second squared.              |
| `size`                 | binding, required                              | Starting size. Negative results become zero.                             |
| `endSize`              | binding; `0`                                   | Size at the end of life.                                                 |
| `opacity`              | binding; `1`                                   | Starting opacity, clamped to 0..1, then faded with age.                  |
| `colors`               | array of 1-32 CSS colors, required             | Deterministically distributed across particles.                          |
| `shape`                | `circle`, `square`, or `line`; `circle`        | Draw shape.                                                              |
| `blendMode`            | blend mode; `source-over`                      | Canvas compositing mode. `lighter` is useful for glow.                   |
| `seed`                 | integer; `1`                                   | Stable variation seed.                                                   |

Declarative emitters cannot branch directly on lifecycle, voice activity, or a
spectrum band. Use energy/cadence bindings, multiple emitters, or the web
renderer when you need that control.

## `web`

The web renderer is the open-ended option for DOM, Canvas 2D, and WebGL themes.
Its entry is a self-contained ES module that exports `mount` or a default
function. The module source must be at most 5 MiB at runtime.

Minimal valid manifest:

```json
{
  "schemaVersion": 1,
  "id": "signal-orb",
  "name": "Signal Orb",
  "description": "A code-driven canvas orb.",
  "author": "Example Author",
  "preview": "preview.png",
  "overlay": {
    "renderer": "web",
    "width": 360,
    "height": 220,
    "anchor": "bottom-center",
    "pointerMode": "passthrough",
    "config": {
      "entry": "web/theme.js",
      "assets": {
        "texture": "assets/texture.png"
      },
      "reducedMotionAsset": "assets/static-orb.png"
    }
  }
}
```

`entry` and `reducedMotionAsset` are required relative paths. `assets` is an
optional map whose keys are 1-128 characters and whose values are relative
asset paths. The host resolves these to app-owned local URLs before mounting.
Images are the guaranteed usable web asset type in v1. Put shader source and
other text directly into the bundled entry because network/fetch access is
blocked inside the iframe.

Minimal `web/theme.js`:

```js
export function mount({ root, assets, onSignal, getSignal }) {
  const canvas = document.createElement("canvas");
  canvas.width = root.clientWidth;
  canvas.height = root.clientHeight;
  canvas.style.cssText = "width:100%;height:100%;display:block";
  root.append(canvas);

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is required");

  const draw = (signal) => {
    if (!signal) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = `rgba(85, 232, 255, ${0.2 + signal.energy * 0.8})`;
    context.beginPath();
    context.arc(
      canvas.width / 2,
      canvas.height / 2,
      20 + signal.energy * 60,
      0,
      Math.PI * 2,
    );
    context.fill();
  };

  draw(getSignal());
  onSignal(draw);

  // For an image asset: const image = new Image(); image.src = assets.texture;
  void assets;
}
```

The mount API is:

```ts
interface WebThemeApi {
  root: HTMLElement;
  assets: Readonly<Record<string, string>>;
  onSignal(callback: (signal: Readonly<ThemeSignal>) => void): () => void;
  getSignal(): Readonly<ThemeSignal> | null;
}
```

`mount` may be async. `onSignal` immediately calls a new subscriber when a
signal is already available and returns an unsubscribe function. Signals,
their 16-element spectrum arrays, and the asset map are frozen. If the system
requests reduced motion, LocalDictate displays `reducedMotionAsset` and does
not mount the code iframe.

The entry must be one bundled module. Relative/static imports and remote imports
do not work from its Blob URL, so bundle dependencies into `theme.js`. A return
value from `mount` is ignored in v1; removing the iframe tears down its browsing
context.

### Web sandbox and trust limits

The iframe uses `sandbox="allow-scripts"` without same-origin access. It does
not receive Tauri APIs, filesystem paths, credentials, clipboard access, the
parent DOM, keyboard focus, or microphone samples. Camera, microphone,
geolocation, clipboard, fullscreen, payment, USB, serial, Bluetooth, MIDI, and
display capture are denied. The iframe is pointer-disabled.

Its content security policy disables network connections, fonts, media,
objects, child frames, workers, manifests, forms, base URLs, and navigation.
Images may come only from Blob/data or app-owned local asset URLs. Scripts may
come only from the bootstrap or Blob module.

This isolation narrows what a mod can reach, but JavaScript can still consume
CPU or memory and browser-engine defects are possible. That is why every web
pack requires explicit trust. Inspect third-party `theme.js` before installing
it.

## Appearance and post-processing presets

All preset fields are optional. Applying a pack changes only the fields it
contains:

```json
{
  "preset": {
    "appearance": "dark",
    "accent": "amber",
    "postProcessing": {
      "enabled": true,
      "profile": {
        "id": "theme:my-theme",
        "name": "My theme voice",
        "prompt": "Polish the raw dictation without changing its facts. Return only the result."
      }
    }
  }
}
```

- `appearance` is `light`, `dark`, or `system`.
- `accent` is `blue`, `violet`, `teal`, `rose`, or `amber`.
- `postProcessing.enabled` is required when `postProcessing` exists.
- `profile` is optional. If present, its `id` must be exactly
  `theme:<manifest-id>`. Its ID and name are 1-128 characters, its name and
  prompt must be non-blank, and its prompt is at most 50,000 characters.
- Applying inserts or updates the theme-owned profile by stable ID and selects
  it. Other profiles and all provider credentials remain untouched.
- Packs do not contain a provider, API key, model, or credentials. Enabling
  post-processing relies on the user's existing provider setup.

If you omit `postProcessing`, applying the pack leaves the user's current
post-processing state alone. If you include it without `profile`, only the
enabled switch changes.

## Validation and failure behavior

Validation has two gates:

1. The importer validates the package tree, safe paths, main manifest shape,
   schema version, ID, canvas size, preview, referenced files, PNG headers, and
   theme-owned profile ID before copying.
2. The overlay runtime applies the stricter renderer-specific schema above. A
   malformed renderer config falls back to Classic instead of breaking capture.

The frontend schema is strict, so spelling and case matter. Errors are reported
as a dotted path plus a message, for example:

```text
overlay.config.layers.0.opacity: Expected number, received string
```

Common failures:

- selecting a ZIP or a file other than `manifest.json`;
- using `Classic`, spaces, underscores, uppercase letters, or repeated hyphens
  in `id`;
- using an absolute path, `..`, or Windows `\` separators in an asset path;
- forgetting one of the five `lifecycleClips` entries;
- referring to a missing clip or a frame outside the declared atlas grid;
- including an unsupported file anywhere in the pack;
- omitting the particle/web reduced-motion PNG;
- using a bundled pack's ID; or
- declining the executable-code confirmation for a web pack.

If the selected pack is missing or invalid at startup, LocalDictate uses Classic.
Renderer and asset-load errors deactivate the broken visual pack and restore
Classic native bounds and controls. Transcription and paste continue
independently of theme rendering.

## Local test workflow

1. Start from the renderer example closest to your idea and give the copy a new
   stable ID.
2. Keep `preview.png` and every referenced file inside the pack directory.
3. From a LocalDictate source checkout, validate the frontend schema:

   ```powershell
   bun -e "import { readFileSync } from 'node:fs'; import { ThemeManifestV1Schema } from './src/themes/schema.ts'; const path = process.argv[1]; ThemeManifestV1Schema.parse(JSON.parse(readFileSync(path, 'utf8'))); console.log('valid: ' + path);" ./path/to/my-theme/manifest.json
   ```

4. Open LocalDictate's Themes setting, install the pack directory, and apply it.
   The app installer is the authoritative check for file limits, headers, safe
   paths, and profile rules that the Zod command does not cover.
5. Exercise `idle`, start a recording to see `arming` and `listening`, then stop
   to see `transcribing`. Enable a working post-processing setup to exercise
   `processing`.
6. Test silence, ordinary speech, loud speech, and quick phrases. Cadence is a
   rolling onset estimate, so do not assume it equals transcript speed.
7. Turn on the operating system's reduced-motion preference, restart
   LocalDictate so the overlay rereads it, and verify the sprite frame or static
   particle/web image.
8. Confirm the transparent canvas does not block clicks. Prefer
   `pointerMode: "passthrough"`.
9. Reinstall the same ID after edits. An active pack reloads its visual files and
   window geometry immediately, without reapplying its preset. Choose **Apply
   preset** again when you also want to restore its one-time settings.

For repository changes, also run the focused runtime tests:

```bash
bun test tests/theme-runtime.test.ts
```

Before sharing a pack, test it on every operating system you claim to support.
Transparent-window placement and GPU/WebGL behavior can vary by platform.
