# Settings functional audit

Snapshot: 2026-08-29, post-integration review of the LocalDictate release candidate. The sound-removal, Appearance, and settings-repair workstreams are integrated in this snapshot.

## Scope and proof standard

This inventory covers every user-visible control reachable after onboarding from the sidebar pages, plus the persistent footer controls. It distinguishes persisted settings from actions, filters, status readouts, and debug diagnostics.

The common persisted-setting path is:

`component -> useSettings -> settingsStore.updateSetting -> generated command in src/bindings.ts -> Rust command -> settings::write_settings -> runtime consumer`

`AppSettings` is loaded with `commands.getAppSettings()` and normalized in `settingsStore.refreshSettings`. Shortcuts and model selection use dedicated stores and commands. "Static-wired" means every link and a runtime consumer were found in code; it does not mean the hardware, OS, network, or service behavior was manually exercised.

Status legend:

- **Fixed/tested**: a deterministic defect was repaired and has focused automated proof.
- **Static-wired**: a complete code path and runtime consumer were found.
- **Manual/hardware**: the static path exists, but meaningful proof requires a device, OS integration, network service, credentials, or an actual transcription.
- **Incomplete**: an implemented path still has a validation or UX gap.
- **Action/readout**: not a persisted setting.

## General page

| Control                          | Kind                        | End-to-end trace                                                                                                                                                             | Status / evidence                                                                                     |
| -------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Transcribe shortcut              | Setting                     | `ShortcutInput` -> shortcut input implementation -> `settingsStore.updateBinding` -> `commands.changeBinding` -> implementation registration -> shortcut handler/coordinator | **Manual/hardware.** Result handling and rollback exist; actual global-key capture was not exercised. |
| Push to talk                     | Setting                     | `PushToTalk` -> `push_to_talk` -> `changePttSetting` -> shortcut handler/coordinator                                                                                         | **Manual/hardware; static-wired.**                                                                    |
| Cancel shortcut                  | Setting, conditional        | Same binding path; hidden on Linux and while push-to-talk is enabled; dynamically registered/unregistered by shortcut/transcription actions                                  | **Manual/hardware; static-wired.** Conditional reachability is intentional.                           |
| Recognition language             | Setting, model-conditional  | `LanguageSelector` -> `selected_language` -> command -> effective language resolution and transcription manager                                                              | **Manual/model; static-wired.** Hidden for models without language selection.                         |
| Translate to English             | Setting, model-conditional  | `TranslateToEnglish` -> `translate_to_english` -> command -> transcription translate paths                                                                                   | **Manual/model; static-wired.**                                                                       |
| Microphone                       | Setting                     | `MicrophoneSelector` -> `selected_microphone` -> audio command -> audio manager current-device selection                                                                     | **Manual/hardware; static-wired.** Refresh and unavailable-device fallback exist.                     |
| Input channel                    | Setting, device-conditional | `ChannelSelector` -> channel query plus `selected_channel` -> audio command -> recorder/resampler                                                                            | **Manual/hardware; static-wired.** Hidden for mono devices.                                           |
| Mute other audio while recording | Setting                     | `MuteWhileRecording` -> `mute_while_recording` -> command -> audio manager mute side effect                                                                                  | **Manual/OS; static-wired.**                                                                          |

There are no sound settings or test-sound actions. The former feedback toggle, output-device selector, volume selector, sound picker, playback module, sound resources, and playback dependency were removed. `tests/no-feedback-sounds.test.ts` guards the production tree and dependencies.

## Appearance page

| Control                 | Kind                 | End-to-end trace                                                                                                                                         | Status / evidence                                                                                                                                                                        |
| ----------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Light/system/dark theme | Setting              | `ThemeSelector` -> `theme` updater -> persisted `Theme` -> `applyTheme`; boot sync and native window theme consume it                                    | **Fixed/tested.** Persistence precedes DOM/localStorage application. Boot storage reads `localdictate.theme`, migrates valid legacy `handy.theme`, and writes only the LocalDictate key. |
| Accent color            | Setting              | `ThemeSelector` -> `theme_accent` updater -> Rust setting -> `applyThemeAccent` -> CSS `data-accent`; boot sync restores it                              | **Fixed/tested.** Persistence precedes DOM application and generic rollback handles failure.                                                                                             |
| UI font size            | Setting              | `FontSizeSelector` -> `ui_font_size` updater -> Rust setting -> `applyUiFontSize` -> root font-size attribute; boot sync restores it                     | **Fixed/tested.** Small/default/large mapping is covered and failed persistence cannot leave stale DOM state.                                                                            |
| App language            | Setting              | `AppLanguageSelector` -> `app_language` updater -> Rust setting -> `i18n.changeLanguage`; startup i18n and tray strings consume it                       | **Fixed/static-wired.** The previously unreachable control is now rendered and changes i18n only after persistence. Manual locale review remains.                                        |
| Widget animations       | Setting              | `WidgetAnimationSelector` -> `widget_animation` updater -> Rust setting -> `applyWidgetAnimation`; root/overlay CSS consume it and boot sync restores it | **Fixed/tested.** Full/reduced/off mappings are covered; persistence precedes DOM application.                                                                                           |
| Theme/widget pack       | Setting plus actions | `ThemePackSelector` -> list/install/apply/remove commands -> theme-pack manager -> active pack/presets -> overlay renderer                               | **Static-wired/tested.** Manifest/runtime tests pass. Install/remove, filesystem permissions, and code-theme trust require manual testing.                                               |

## Advanced page

| Control                           | Kind                          | End-to-end trace                                                                                           | Status / evidence                                                                                                                                                                                                                                                  |
| --------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Start hidden                      | Setting                       | `StartHidden` -> `start_hidden` -> command -> startup/window-close logic                                   | **Static-wired; restart/manual proof required.** Correctly constrained by tray availability.                                                                                                                                                                       |
| Start at login                    | Setting plus OS side effect   | `AutostartToggle` -> `autostart_enabled` -> command -> `autostart::apply_autostart`; reapplied at startup  | **Fixed/static-wired; manual OS proof required.** Interactive changes apply to the OS first and return an error without persisting or emitting success when registration fails. Startup logs failure and continues. Debug executable registration remains blocked. |
| Show tray icon                    | Setting plus live side effect | `ShowTrayIcon` -> `show_tray_icon` -> command -> tray visibility; startup/window-close consumers           | **Manual/OS; static-wired.**                                                                                                                                                                                                                                       |
| Widget style (none/minimal/live)  | Setting                       | `ShowOverlay` -> `overlay_style` -> command -> cache/update -> transcription actions and overlay renderer  | **Static-wired; manual widget review required.**                                                                                                                                                                                                                   |
| Widget position (top/bottom)      | Setting                       | `ShowOverlay` -> `overlay_position` -> command -> overlay position update -> resolved theme/classic anchor | **Fixed/tested.** User top/bottom is the vertical override; a pack can still supply left/center/right alignment, dimensions, and pointer mode. All anchor combinations have Rust coverage.                                                                         |
| Model unload timeout              | Setting                       | `ModelUnloadTimeoutSetting` -> generic updater -> command -> persisted enum -> unload scheduling           | **Fixed/tested.** Every rendered option uses its canonical generated value, the duplicate direct write is gone, the control disables while updating, and Rust accepts legacy compact values. Frontend/Rust contracts cover every option.                           |
| Experimental features             | Setting/UI gate               | `ExperimentalToggle` -> `experimental_enabled` -> command -> experimental group visibility                 | **Static-wired.**                                                                                                                                                                                                                                                  |
| Paste method                      | Setting, OS-conditional       | `PasteMethodSetting` -> paste method plus Linux script path -> command -> clipboard paste dispatch         | **Manual/OS; static-wired.** Direct is disabled on macOS. The missing `default_paste_method()` now compiles and returns the enum default.                                                                                                                          |
| Linux typing tool                 | Setting, conditional          | `TypingToolSetting` -> `typing_tool` -> direct typing dispatch                                             | **Manual/Linux; static-wired.**                                                                                                                                                                                                                                    |
| Clipboard handling                | Setting                       | `ClipboardHandlingSetting` -> command -> clipboard transaction/restoration                                 | **Manual/OS; static-wired.**                                                                                                                                                                                                                                       |
| Auto-submit key/off               | Two settings                  | `AutoSubmit` -> submit key, then enabled flag -> commands -> submit decision/key dispatch                  | **Manual/OS; static-wired.**                                                                                                                                                                                                                                       |
| Voice activity detection          | Setting                       | `VoiceActivityDetection` -> `vad_enabled` -> command -> transcription VAD policy                           | **Manual/audio; static-wired.**                                                                                                                                                                                                                                    |
| Filler-word removal               | Setting                       | `FillerWordRemoval` -> command -> post-transcription filter                                                | **Manual/transcription; static-wired.**                                                                                                                                                                                                                            |
| Custom words                      | Setting/action list           | `CustomWords` add/remove -> updater -> Whisper prompt/correction consumers                                 | **Manual/model; static-wired.**                                                                                                                                                                                                                                    |
| Append trailing space             | Setting                       | `AppendTrailingSpace` -> command -> clipboard text construction                                            | **Manual/paste; static-wired.**                                                                                                                                                                                                                                    |
| History limit                     | Setting plus cleanup          | `HistoryLimit` -> `history_limit` -> history command -> persisted field plus cleanup                       | **Static-wired.** Zero is valid and remains zero in the retention label. UI constrains the value to 0-1000; the command accepts direct out-of-range callers.                                                                                                       |
| Recording retention               | Setting plus cleanup          | selector -> canonical generated enum -> history parser -> persisted enum plus cleanup                      | **Fixed/tested.** Canonical values round-trip, legacy compact values remain accepted, and `history_limit ?? 5` preserves zero.                                                                                                                                     |
| Post-processing enabled           | Setting/UI gate               | toggle -> command -> shortcut/sidebar/footer gates                                                         | **Static-wired.** Service controls are below.                                                                                                                                                                                                                      |
| Keyboard implementation           | Setting plus registration     | selector -> checked command -> validation/reset -> refreshed settings                                      | **Manual/global-key; static-wired.**                                                                                                                                                                                                                               |
| transcribe.cpp accelerator/device | Settings                      | selector -> GPU device then accelerator -> commands -> reload-on-next-use -> engine creation               | **Manual/GPU; static-wired.**                                                                                                                                                                                                                                      |
| ONNX Runtime accelerator          | Setting, conditional          | selector -> ORT accelerator -> reload-on-next-use -> provider selection                                    | **Manual/GPU; static-wired.**                                                                                                                                                                                                                                      |
| Lazy stream close                 | Setting, experimental         | selector -> command -> audio stream-close branches                                                         | **Manual/audio; static-wired.**                                                                                                                                                                                                                                    |
| VAD backend                       | Setting plus device work      | selector -> generic result-aware updater -> manager swap/reopen -> persist on success                      | **Manual/audio; static-wired.** Central Result handling provides rollback/report/rethrow guarantees.                                                                                                                                                               |

## Post-processing page

This page is reachable only when experimental mode and post-processing are enabled.

| Control                              | Kind                        | End-to-end trace                                                                                 | Status / evidence                                                                                                                     |
| ------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Post-process shortcut                | Setting                     | post-process shortcut input -> binding path -> conditional registration -> post-process action   | **Manual/global-key; static-wired.**                                                                                                  |
| Provider                             | Setting                     | `ProviderSelect` -> provider hook -> store helper -> command -> active provider lookup           | **Fixed/static-wired; service behavior manual.** Returned and thrown errors toast once and rethrow.                                   |
| Codex CLI readiness                  | Status/readout/action       | status command -> banner/instructions                                                            | **Action/readout; manual environment required.**                                                                                      |
| Apple Intelligence availability      | Status/readout              | availability command before provider selection                                                   | **Action/readout; manual macOS required.**                                                                                            |
| Custom provider base URL             | Setting                     | blur -> store helper -> URL command plus model reset -> HTTP client                              | **Fixed/static-wired; service behavior manual.** Result failures are surfaced and rethrown.                                           |
| API key                              | Secret setting              | blur -> store helper -> backend secret handling -> provider key map                              | **Fixed/static-wired; service behavior manual.** Errors are surfaced; this audit did not inspect or expose secrets.                   |
| Model and refresh models             | Setting plus network action | model update; refresh -> provider endpoint -> options; selection consumed by post-process action | **Fixed/static-wired; network manual.** Persistence errors surface and rethrow.                                                       |
| Selected cleanup profile             | Setting                     | prompt list/footer -> generic selected-profile updater -> selected prompt lookup                 | **Fixed/tested.** Rejected IDs rollback optimistic state, toast once, and rethrow.                                                    |
| Create/edit/duplicate/delete profile | Persisting actions          | checked prompt commands -> validation/persistence -> refresh/selection                           | **Static-wired.** Checked results and localized toasts exist; selection failures after create/duplicate do not add a duplicate toast. |

## Models page

| Control                                      | Kind               | End-to-end trace                                                              | Status / evidence                           |
| -------------------------------------------- | ------------------ | ----------------------------------------------------------------------------- | ------------------------------------------- |
| Catalog and mirror links                     | External actions   | OS URL opener                                                                 | **Action/readout; manual browser/network.** |
| Import local GGUF/BIN                        | Action             | file dialog -> import command -> model manager -> reload                      | **Manual/filesystem/model; static-wired.**  |
| Link model URL                               | Action             | URL input -> link command -> catalog/manager -> reload                        | **Manual/network; static-wired.**           |
| Search                                       | Local filter       | React state filters name/description                                          | **Action/readout; static-wired.**           |
| Rescan local models                          | Action             | model store -> rescan command -> reload available/current models              | **Manual/filesystem; static-wired.**        |
| Streaming, translation, and language filters | Local filters      | React state -> model capability predicates                                    | **Action/readout; static-wired.**           |
| Select active model                          | Setting/action     | model card -> model store -> set-active command -> load and persist selection | **Manual/model; static-wired.**             |
| Download/cancel model                        | Network actions    | model store commands/events -> manager download/cancel/progress               | **Manual/network/disk; static-wired.**      |
| Delete model                                 | Destructive action | confirmation -> delete command -> manager -> reload                           | **Manual/filesystem; static-wired.**        |
| Change/reset model source                    | Setting/action     | source controls -> override commands -> manager store                         | **Manual/network; static-wired.**           |
| Capability/status cards                      | Status/readout     | model store plus backend events                                               | **Action/readout.**                         |

## History page

| Control                           | Kind               | End-to-end trace                                                           | Status / evidence                                                                                                                  |
| --------------------------------- | ------------------ | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Paginated history/infinite scroll | Readout            | history query -> database pagination; events merge changes                 | **Static-wired; database/manual proof required.**                                                                                  |
| Open recordings folder            | Action             | command -> OS opener                                                       | **Manual/OS; static-wired.** Failure remains console-only.                                                                         |
| Play/pause and seek recording     | Actions            | audio-path command -> media player; range updates position                 | **Manual/audio/filesystem; static-wired.**                                                                                         |
| Copy transcript                   | Action             | clipboard write -> awaited completion -> copied indicator                  | **Fixed/static-wired; manual permission proof required.** Success appears only after resolve; rejection produces no false success. |
| Save/unsave entry                 | Record mutation    | optimistic UI -> database toggle -> rollback on failure                    | **Static-wired.**                                                                                                                  |
| Re-transcribe                     | Action             | retry command -> audio/transcription/post-process pipeline -> entry update | **Manual/model/audio; static-wired.**                                                                                              |
| Delete entry/audio                | Destructive action | optimistic remove -> delete command -> database/file -> reload on failure  | **Manual/filesystem; static-wired.**                                                                                               |
| Live updates                      | Status/readout     | typed history event -> add/update list                                     | **Static-wired.**                                                                                                                  |

## Debug page

Reachable with Ctrl+Shift+D on Windows/Linux or Cmd+Shift+D on macOS.

| Control                             | Kind                          | End-to-end trace                                                      | Status / evidence                                                         |
| ----------------------------------- | ----------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Log level                           | Setting plus live side effect | selector -> generic updater -> atomic log filter plus persisted field | **Fixed/static-wired.** Generic Result errors rollback/toast/rethrow.     |
| What's New preview                  | Action/readout                | latest release note -> modal                                          | **Action/readout; static-wired.** Does not mutate last-seen state.        |
| Update checks                       | Setting                       | toggle -> command -> update checker gate                              | **Manual/network; static-wired.**                                         |
| Show What's New on update           | Setting                       | reachable toggle -> command -> update/modal startup consumer          | **Fixed/static-wired.** Previously unreachable; now beside update checks. |
| Word correction threshold           | Setting                       | slider -> command -> edit-distance correction                         | **Manual/transcription; static-wired.**                                   |
| Paste-before and paste-after delays | Settings                      | sliders -> commands -> paste/restoration delays                       | **Manual/OS; static-wired.**                                              |
| Reliable paste                      | Setting, Windows/macOS        | toggle -> command -> reliable paste transaction                       | **Manual/OS; static-wired.**                                              |
| Extra recording buffer              | Setting                       | slider -> command -> audio buffer sizing                              | **Manual/audio; static-wired.**                                           |
| Always-on microphone                | Setting                       | toggle -> audio manager mode -> recording lifecycle                   | **Manual/audio; static-wired.**                                           |
| Clamshell microphone                | Setting, macOS laptop         | conditional selector -> audio command -> device selection             | **Manual/macOS hardware; static-wired.**                                  |
| Keyboard diagnostic                 | Diagnostic, macOS             | diagnostic command -> count report                                    | **Manual/macOS.**                                                         |
| Live log pause/resume/copy/clear    | Local actions/readout         | log listener -> bounded buffer -> local controls                      | **Action/readout; static-wired.** Copy failure remains console-only.      |

There is no sound-theme or test-sound control on Debug.

## About page

| Control            | Kind            | End-to-end trace                                   | Status / evidence                                                |
| ------------------ | --------------- | -------------------------------------------------- | ---------------------------------------------------------------- |
| Version            | Status/readout  | Tauri version -> text, fallback `0.1.0`            | **Fixed/static-wired.** Fallback matches package version.        |
| Source code        | External action | button -> `https://github.com/RyHale/LocalDictate` | **Fixed/static-wired.** Points at the planned public repository. |
| App data directory | Action/readout  | path command -> display -> open-data command       | **Manual/OS; static-wired.** Open failure remains console-only.  |
| Log directory      | Action/readout  | path command -> display -> open-log command        | **Manual/OS; static-wired.** Open failure remains console-only.  |
| Acknowledgments    | Readout         | translated static text                             | **Action/readout.**                                              |

## Persistent footer controls

| Control                  | Kind           | End-to-end trace                                               | Status / evidence                                                                                           |
| ------------------------ | -------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Active model selector    | Setting/action | footer selector -> model store -> set-active command           | **Manual/model; static-wired.** Recording/model state gates switching.                                      |
| Cleanup profile selector | Setting        | footer selector -> generic selected-profile updater -> runtime | **Fixed/tested.** Rejected Results rollback, toast, and rethrow. Hidden when disabled or no profiles exist. |

## Closed deterministic findings

1. **Model unload timeout contract:** fixed with canonical generated values, one result-aware write path, legacy Rust aliases, and frontend/Rust coverage for every option.
2. **Generated Result handling:** `executeSettingCommand` unwraps returned errors. `settingsStore.updateSetting` restores only the failed key, shows one error, and rethrows. Dedicated post-process writes match this behavior. Tests cover success, returned error, thrown invoke error, and void command.
3. **Appearance rollback:** theme, accent, font, language, and motion apply local runtime state only after persistence. The legacy theme key is migrated into `localdictate.theme`.
4. **Recording retention:** canonical values round-trip, legacy compact values remain compatible, and zero history limit is preserved.
5. **Rust default compile failure:** `default_paste_method()` exists and returns `PasteMethod::default()`.
6. **Reachability:** App language is on Appearance; Show What's New on update is on Debug.
7. **OS/user-visible correctness:** autostart propagates registration failures, user widget position controls the vertical anchor, and history copy reports only real success.
8. **Metadata:** About fallback is `0.1.0` and source URL is the planned LocalDictate repository.
9. **Sound removal:** sound settings, playback code/resources, and test actions are absent and guarded by tests.

## Unreachable, orphaned, or internal fields

| Field/component                                      | Current state                                                                                                | Recommendation                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `custom_filler_words`                                | Persisted field and transcription consumer exist; no UI/updater. It differs from user-facing `custom_words`. | Keep internal/legacy unless an editor is product-approved. |
| `DebugPaths`                                         | Exportable component with legacy Handy paths; not rendered.                                                  | Delete or update before making reachable.                  |
| `active_theme_pack`                                  | Intentionally managed by the theme-pack workflow, not a generic updater.                                     | Keep internal.                                             |
| Onboarding/model/provider/API-key/prompt list fields | Intentionally managed by dedicated workflows.                                                                | Not stale; do not add generic setters.                     |
| `ShowOverlay` component name                         | Reachable Advanced control for widget style and position.                                                    | Naming cleanup is optional; functionality is complete.     |

No user-visible setting was found with a handler-less generic write or without a runtime consumer after the post-integration re-scan.

## Automated evidence

- Explicit Bun unit suite: 27 passed, 0 failed, 91 expectations.
- `scripts/windows.ps1 test`: 273 passed, 0 failed, 0 ignored.
- `scripts/windows.ps1 check`: ESLint passed, all 23 translation catalogs passed, Rust formatting passed, and Cargo check passed.
- `bun run lint`: passed.
- `bun run check:translations`: all 23 translation catalogs passed.
- `bun run build`: passed with the existing non-blocking Vite large-chunk warning.
- Raw `bun test` is not a valid all-suite command here because Bun loads the Playwright-only `tests/app.spec.ts`; Playwright rejects the Bun runner. The explicit unit files passed; browser tests are not claimed.

## Remaining manual-only verification

- Exercise real microphone/channel/mute/VAD/always-on behavior and transcribe, push-to-talk, cancel, and post-process global shortcuts.
- Install the NSIS release and exercise Windows autostart. Development registration was intentionally not attempted because unsafe debug executable registration is blocked.
- Exercise tray/start-hidden across restart, paste/restoration/auto-submit in target applications, and clipboard permission rejection.
- Exercise classic and theme-pack widgets, including style, position, pack install/remove, and animation choices.
- Download/import/select representative models and exercise GPU/ORT accelerators on compatible hardware.
- Exercise post-process providers with real credentials/endpoints, Codex CLI availability, and profile CRUD in the running app.
- Exercise macOS-only clamshell, Apple Intelligence, diagnostic, direct-paste restrictions, and `SMAppService` errors on macOS.
- Verify installed-release restart persistence for theme/accent/font/language/motion, retention, unload timeout, tray, and start-hidden.

No manual or hardware verification is claimed by this document.
