<p align="center">
  <img src="docs/assets/localdictate-icon.svg" width="112" alt="LocalDictate waveform icon" />
</p>

<h1 align="center">LocalDictate</h1>

<p align="center"><strong>Private, local-first voice dictation for Windows, with optional AI cleanup.</strong></p>

<p align="center">
  <a href="https://github.com/RyHale/LocalDictate/releases/latest"><img src="https://img.shields.io/github/v/release/RyHale/LocalDictate?display_name=tag&amp;sort=semver" alt="Latest release" /></a>
  <a href="https://github.com/RyHale/LocalDictate/releases/latest"><img src="https://img.shields.io/badge/Windows-x64-0078D4?logo=windows" alt="Windows x64" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2ea44f" alt="MIT license" /></a>
</p>

Press a shortcut, speak, and keep typing. LocalDictate transcribes your voice on your PC and pastes the result into the app you are already using.

After downloading a speech model, use it offline or optionally turn rough speech into polished text through your signed-in Codex CLI or another cleanup provider. Your microphone audio is never sent to a cleanup service.

**[Download LocalDictate for Windows](https://github.com/RyHale/LocalDictate/releases/latest)**

## Why LocalDictate?

- **Dictate anywhere.** Put your cursor in a text field, hold or toggle your shortcut, and speak.
- **Keep your voice private.** Speech recognition runs locally. Raw dictation needs no account or cloud service.
- **Polish only when you want to.** Use a second shortcut to clean up grammar, punctuation, tone, or formatting.
- **Never lose the thought.** If optional cleanup is unavailable or fails, LocalDictate pastes the raw transcript.
- **Stay in your flow.** A quiet on-screen overlay shows when the app is listening, transcribing, or cleaning up without notification sounds.
- **Make it yours.** Configure shortcuts, push-to-talk, models, microphones, colors, motion, overlay position, cleanup profiles, and widget themes.

## Install

Current public builds target **Windows x64**.

1. Open the [latest release](https://github.com/RyHale/LocalDictate/releases/latest).
2. Download the `LocalDictate_*_x64-setup.exe` installer.
3. Install and open LocalDictate.
4. Allow microphone access and choose a local speech model during setup.
5. Place your cursor in any text field and start dictating.

Codex is optional. You do not need it for private, local transcription.

## How it works

| Action             | Default shortcut   | Result                                                                    |
| ------------------ | ------------------ | ------------------------------------------------------------------------- |
| Local dictation    | `Ctrl+Space`       | Records, transcribes locally, and pastes the raw text                     |
| Polished dictation | `Ctrl+Shift+Space` | Transcribes locally, optionally cleans up the text, and pastes the result |

Both shortcuts are configurable. You can use push-to-talk or toggle recording, and the compact overlay follows the recording, transcription, and cleanup states.

```text
Your voice -> local speech model -> transcript -> optional text cleanup -> focused app
```

## Privacy by mode

| Mode                    | What leaves your PC?                          | If cleanup fails         |
| ----------------------- | --------------------------------------------- | ------------------------ |
| Local dictation         | Nothing                                       | Not applicable           |
| Codex cleanup           | Transcript text and your cleanup instructions | Raw transcript is pasted |
| Other cleanup providers | Transcript text and your cleanup instructions | Raw transcript is pasted |

Audio remains local in every mode. LocalDictate also stores raw and polished text separately in local history, with configurable history and recording retention.

## Local speech recognition

LocalDictate uses downloadable speech models rather than a hosted transcription API. The recommended default is **Parakeet Unified English 0.6B Q8**, with additional model choices for different speed, size, and language needs.

On Windows x64, transcription uses `transcribe-cpp` with Vulkan acceleration when available and CPU fallback when it is not. Models can stay loaded between dictations to reduce startup delay.

## Optional text cleanup

Cleanup profiles can turn conversational speech into an email, remove filler words, fix punctuation, preserve technical terms, or apply your own repeatable writing style.

The default cleanup connection uses the Codex CLI with your ChatGPT sign-in. Install Codex, then authenticate once:

```powershell
codex login
codex login status
```

LocalDictate creates a fresh, read-only Codex turn for each request. It disables tools and web access, ignores project configuration, and requires ChatGPT authentication so cleanup cannot silently switch to API billing.

You can also connect a local model, another hosted provider, or a command-line tool:

| Connection               | Available options                                                                         | Current maturity             |
| ------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------- |
| Signed-in CLI            | Codex CLI                                                                                 | Primary path; most exercised |
| Custom CLI               | Claude Code, OpenCode, or another non-interactive tool that reads stdin and writes stdout | Beta                         |
| Hosted API               | OpenAI, Z.AI, OpenRouter, Anthropic, Groq, Cerebras, or AWS Bedrock through Mantle        | Beta                         |
| Local or self-hosted API | Ollama, LM Studio, or another OpenAI-compatible `/v1` endpoint                            | Beta                         |
| Apple Intelligence       | Supported Apple Silicon Macs                                                              | Beta and platform-specific   |

> [!CAUTION]
> **Non-Codex cleanup connections are still rough and need broader real-world testing.** The shared OpenAI-compatible request contract and Custom CLI stdin/stdout bridge are covered by automated tests, but most individual providers have not been exercised here with live credentials, every model, or every server version. Expect occasional compatibility issues. If cleanup fails, LocalDictate falls back to the raw transcript instead of losing your dictation.

Post-processing is off by default and always remains optional. A Custom CLI receives the cleanup request on stdin and must print only the cleaned text—or `{"transcription":"..."}`—to stdout. Enter each non-interactive CLI argument on its own line in settings.

For example, Claude Code can start with `-p`, `--no-session-persistence`, and `--safe-mode` on separate lines. OpenCode can start with `run` and `--pure`. These are starting configurations, not guarantees for every CLI version or account setup.

## Made for everyday use

- Local transcript history with separate raw and polished versions
- Multiple microphones, input channels, and speech models
- Optional auto-submit after text is pasted
- Configurable clipboard restoration and paste behavior
- Light, dark, and system themes with accent and text-size controls
- Full, reduced, or disabled overlay animation
- Classic and Pirate Scribe recording displays, plus reusable cleanup profiles
- System tray controls and launch-at-login support

## Build from source

You will need the latest stable [Rust](https://rustup.rs/) toolchain and [Bun](https://bun.sh/). See [BUILD.md](BUILD.md) for full platform prerequisites.

On Windows, use the repository launcher so the native toolchain and the Vite/Tauri development lifecycle stay together:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows.ps1 doctor
powershell -ExecutionPolicy Bypass -File .\scripts\windows.ps1 dev
```

Build the installable Windows release:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows.ps1 build
```

The NSIS installer is written to `src-tauri\target\release\bundle\nsis`. Use the installed release for normal use, taskbar pins, launch at login, and restart testing.

Run focused checks:

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

Theme authors can start with the [Theme Pack authoring guide](docs/themes/AUTHORING.md).

## Under the hood

- **Tauri 2 and Rust** for audio capture, local inference, global shortcuts, overlay windows, history, and text insertion
- **React, TypeScript, Tailwind CSS, Zustand, and i18next** for the settings and overlay interfaces
- **`transcribe-cpp` and GGUF models** for accelerated local speech recognition
- **Codex CLI and configurable providers** for optional text-only cleanup
- **SQLite** for local transcription history

## Project lineage

LocalDictate is a Windows-first fork of [Handy](https://github.com/cjpais/Handy), created by CJ Pais and its contributors. It preserves Handy's Git history and MIT license so the upstream work and contributors remain credited.

This fork adds the LocalDictate identity, Windows-focused defaults, Codex CLI integration, explicit privacy controls, sound-free interaction, cleanup profiles, and expanded appearance and widget customization.

LocalDictate is free and open-source software released under the [MIT License](LICENSE).
