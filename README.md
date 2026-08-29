# LocalDictate

LocalDictate is a personal, Windows-first dictation utility. Hold or toggle a global shortcut, speak, and the app transcribes locally before pasting into the focused application. A compact bottom-of-screen overlay shows listening, transcription, and cleanup state.

LocalDictate does not play start, stop, success, or error sounds. Visual state remains available through the overlay, which can use Full, Reduced, or Off animation. The Appearance page also provides light/system/dark themes, accent colors, interface text sizing, and optional widget theme packs.

## Default workflow

- `Ctrl+Space`: local raw dictation. Audio and transcript stay on this PC.
- `Ctrl+Shift+Space`: local transcription followed by text cleanup through the signed-in Codex CLI. Only the transcript and cleanup instructions are sent to OpenAI.
- If Codex is missing, signed out, slow, or returns an invalid result, LocalDictate pastes the raw transcript.
- Raw and polished text are retained separately in local history.

Both shortcuts and the recording mode are configurable in Settings.

## Local speech models

The app defaults to Parakeet Unified English 0.6B Q8. Three verified models are pre-downloaded in the LocalDictate application-data model directory for comparison:

| Model                         |    Size | Intended use                      |
| ----------------------------- | ------: | --------------------------------- |
| Parakeet Unified EN 0.6B Q8   | 698 MiB | Default accuracy and punctuation  |
| Moonshine Streaming Medium Q8 | 282 MiB | Lower-latency streaming test      |
| Canary 180M Flash Q8          | 208 MiB | Lightweight final-transcript test |

Windows x64 uses `transcribe-cpp` with Vulkan acceleration and CPU fallback. The current personal default keeps the active model resident to avoid repeated cold starts.

## Codex setup

Install the Codex CLI and sign in with the ChatGPT subscription:

```powershell
codex login
codex login status
```

LocalDictate runs an ephemeral, read-only `codex exec` turn for each polished dictation. It ignores project configuration, disables tools and web search, removes `OPENAI_API_KEY` from the child environment, and enforces ChatGPT authentication so cleanup cannot silently switch to API billing.

## Run on this machine

The repository includes a Windows launcher wired to the locally installed Rust, CMake, MSVC, and Vulkan SDK toolchain:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows.ps1 dev
```

Create the production Windows installer with the frontend embedded:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows.ps1 build
```

The NSIS installer is written under
`src-tauri\target\release\bundle\nsis`. Install that build for normal use,
taskbar pins, and launch at login. `src-tauri\target\debug\localdictate.exe`
belongs exclusively to the live development session and cannot run without its
Vite server.

Audit Windows shortcuts and launch-at-login entries before handing the app back:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows.ps1 doctor
```

Focused checks:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows.ps1 check
powershell -ExecutionPolicy Bypass -File .\scripts\windows.ps1 test
```

Frontend-only commands remain available through Bun:

```powershell
bun install
bun run lint
bun run build
bun run check:translations
```

## Stack

- Tauri 2 and Rust for audio capture, global shortcuts, overlay windows, local inference, history, and text insertion.
- React 18, TypeScript, Tailwind CSS, Zustand, and i18next for settings and overlay UI.
- `transcribe-cpp`/GGUF with Vulkan for local English ASR.
- Codex CLI using ChatGPT sign-in for optional formatting and cleanup.
- SQLite for local transcription history.

## Upstream

LocalDictate is an open-source fork of [Handy](https://github.com/cjpais/Handy), retaining its MIT license and open-source acknowledgments. The LocalDictate name, waveform mark, personal defaults, Codex adapter, privacy UX, and sound-free interaction model are fork-specific.
