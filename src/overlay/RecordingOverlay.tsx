import { convertFileSrc } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import "./RecordingOverlay.css";
import { commands, events } from "@/bindings";
import type {
  StreamPhase,
  StreamPhaseEvent,
  StreamTextEvent,
  StreamWorkKind,
  WidgetAnimation,
} from "@/bindings";
import i18n, { syncLanguageFromSettings } from "@/i18n";
import { getLanguageDirection } from "@/lib/utils/rtl";
import {
  getStoredWidgetAnimation,
  reducesWidgetMotion,
} from "@/lib/utils/theme";
import {
  createThemeSignalBuilder,
  resolveThemeAssets,
  ThemeScene,
  validateThemeManifest,
  type ThemeLifecycle,
  type ThemeManifestV1,
  type ThemeSignal,
  type ThemeSignalInput,
} from "@/themes";

type OverlayState =
  | "idle"
  | "recording"
  | "streaming"
  | "transcribing"
  | "processing";

// Number of reactive bars in the waveform (the simple, smoothed style shared by
// every overlay form). Mic levels arrive as 16 FFT buckets; we take the first N.
const WAVE_BARS = 9;

interface ActiveThemePack {
  manifest: unknown;
  root: string;
  source: "classic" | "bundled" | "installed";
}

const joinThemeAssetPath = (root: string, reference: string): string => {
  const separator = root.includes("\\") ? "\\" : "/";
  const cleanRoot = root.replace(/[\\/]+$/, "");
  const cleanReference = reference
    .replace(/^[\\/]+/, "")
    .replace(/[\\/]/g, separator);
  return `${cleanRoot}${separator}${cleanReference}`;
};

const applyClassicThemeFallback = async (): Promise<void> => {
  try {
    const result = await commands.applyThemePack("classic");
    if (result.status === "error") {
      console.warn(
        "Failed to persist the Classic overlay fallback:",
        result.error,
      );
    }
  } catch (error) {
    console.warn("Failed to persist the Classic overlay fallback:", error);
  }
};

const RecordingOverlay: React.FC = () => {
  const { t } = useTranslation();
  // Enabled overlays boot into the ready indicator. The native window remains
  // hidden when the user's overlay style is None.
  const [isVisible, setIsVisible] = useState(true);
  const [state, setState] = useState<OverlayState>("idle");
  // `Stream::play()` returning does not mean hardware callbacks are flowing.
  // Stay visually in an arming state until the backend processes the first
  // actual microphone sample chunk.
  const [captureReady, setCaptureReady] = useState(false);
  const [levels, setLevels] = useState<number[]>(Array(16).fill(0));
  const [streamText, setStreamText] = useState<StreamTextEvent>({
    committed: "",
    tentative: "",
  });
  const [phase, setPhase] = useState<StreamPhase>("listening");
  const [workKind, setWorkKind] = useState<StreamWorkKind>("transcribing");
  const [widgetAnimation, setWidgetAnimation] = useState<WidgetAnimation>(
    getStoredWidgetAnimation,
  );
  const [elapsed, setElapsed] = useState(0);
  // Bumped on each new streaming session so the Live card remounts fresh (replays
  // the pop-in, and never animates in from the previous panel's open size).
  const [session, setSession] = useState(0);
  // Overlay placement (top vs bottom of the screen). The Live panel grows downward
  // from a top overlay (oldest line under the pill) and upward from a bottom one.
  const [position, setPosition] = useState<"top" | "bottom">("bottom");
  // True once live text overflows the cap. A top overlay fades its top edge only
  // while overflowing, so the resting first line stays crisp flush under the pill.
  const [overflowing, setOverflowing] = useState(false);
  const [themeManifest, setThemeManifest] = useState<ThemeManifestV1>();
  const [themeRevision, setThemeRevision] = useState(0);
  const themeSignalBuilderRef = useRef(createThemeSignalBuilder());
  const themeStartedAtRef = useRef(performance.now());
  const latestThemeInputRef = useRef<ThemeSignalInput>({ lifecycle: "idle" });
  const [themeSignal, setThemeSignal] = useState<ThemeSignal>(() =>
    themeSignalBuilderRef.current.current(),
  );

  const smoothedLevelsRef = useRef<number[]>(Array(16).fill(0));
  // Live-text scroll-back: the text region "sticks" to the newest line while the
  // user is at the bottom; if they scroll up to read history, auto-follow pauses
  // until they scroll back down.
  const capRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const direction = getLanguageDirection(i18n.language);

  const loadActiveTheme = useCallback(async () => {
    try {
      const result = await commands.getActiveThemePack();
      if (result.status === "error") {
        throw new Error(result.error);
      }
      const pack = result.data as ActiveThemePack;
      if (pack.source === "classic") {
        setThemeManifest(undefined);
        setThemeRevision((revision) => revision + 1);
        return;
      }
      const validation = validateThemeManifest(pack.manifest);
      if (!validation.success) {
        console.warn(
          "Active overlay theme is invalid; returning to Classic:",
          validation.errors.join("; "),
        );
        setThemeManifest(undefined);
        setThemeRevision((revision) => revision + 1);
        void applyClassicThemeFallback();
        return;
      }
      const resolved = resolveThemeAssets(validation.manifest, (reference) =>
        convertFileSrc(joinThemeAssetPath(pack.root, reference)),
      );
      setThemeManifest(resolved);
      setThemeRevision((revision) => revision + 1);
    } catch (error) {
      console.warn("Failed to load the active overlay theme:", error);
      setThemeManifest(undefined);
    }
  }, []);

  const handleThemeError = useCallback((error: Error) => {
    console.warn("Overlay theme renderer failed; returning to Classic:", error);
    void applyClassicThemeFallback();
  }, []);

  useEffect(() => {
    void loadActiveTheme();
    const unlisten = listen("theme-pack-changed", () => {
      void loadActiveTheme();
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, [loadActiveTheme]);

  useEffect(() => {
    let disposed = false;
    let disposeListeners: (() => void) | undefined;

    const setupEventListeners = async () => {
      const unlistenShow = await listen("show-overlay", async (event) => {
        const overlayState = event.payload as OverlayState;
        // Reset synchronously before settings I/O. A fast microphone can emit
        // recording-ready while the awaits below are in flight; resetting after
        // them would overwrite that event and leave the overlay stuck arming.
        if (
          overlayState === "idle" ||
          overlayState === "recording" ||
          overlayState === "streaming"
        ) {
          setCaptureReady(false);
          smoothedLevelsRef.current = Array(16).fill(0);
          setLevels(Array(16).fill(0));
          setStreamText({ committed: "", tentative: "" });
          themeStartedAtRef.current = performance.now();
          setThemeSignal(themeSignalBuilderRef.current.reset());
        }

        await syncLanguageFromSettings();
        // The Live panel flows downward from a top overlay and upward from a
        // bottom one; read the placement so the layout can flip to match.
        try {
          const settings = await commands.getAppSettings();
          if (settings.status === "ok") {
            setPosition(
              settings.data.overlay_position === "top" ? "top" : "bottom",
            );
            setWidgetAnimation(settings.data.widget_animation ?? "full");
          }
        } catch {
          // Keep the previous/default placement if settings can't be read.
        }
        setState(overlayState);
        if (overlayState === "streaming") {
          setPhase("listening");
          setWorkKind("transcribing");
          setElapsed(0);
          setSession((s) => s + 1); // remount the card fresh for this session
        }
        setIsVisible(true);
      });

      const unlistenHide = await listen("hide-overlay", () => {
        setIsVisible(false);
        setCaptureReady(false);
      });

      const unlistenReady = await listen("recording-ready", () => {
        setElapsed(0);
        setCaptureReady(true);
      });

      const unlistenLevel = await listen<number[]>("mic-level", (event) => {
        const newLevels = event.payload as number[];
        // Exponential smoothing across the 16 buckets, then take the first N
        // bars for the shared waveform.
        const smoothed = smoothedLevelsRef.current.map((prev, i) => {
          const target = newLevels[i] || 0;
          return prev * 0.7 + target * 0.3;
        });
        smoothedLevelsRef.current = smoothed;
        setLevels(smoothed);
      });

      const unlistenWidgetAnimation = await listen<WidgetAnimation>(
        "widget-animation-changed",
        (event) => setWidgetAnimation(event.payload),
      );

      const unlistenStream = await events.streamTextEvent.listen((event) => {
        setStreamText(event.payload);
      });

      const unlistenPhase = await events.streamPhaseEvent.listen((event) => {
        const payload: StreamPhaseEvent = event.payload;
        setPhase(payload.phase);
        if (payload.kind) setWorkKind(payload.kind);
      });

      const dispose = () => {
        unlistenShow();
        unlistenHide();
        unlistenReady();
        unlistenLevel();
        unlistenWidgetAnimation();
        unlistenStream();
        unlistenPhase();
      };

      if (disposed) {
        dispose();
        return;
      }

      disposeListeners = dispose;
      await emit("overlay-ready");
    };

    void setupEventListeners();

    return () => {
      disposed = true;
      disposeListeners?.();
    };
  }, []);

  // Elapsed capture timer starts only once microphone samples are flowing.
  useEffect(() => {
    if (state !== "streaming" || !isVisible || !captureReady) return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [state, isVisible, captureReady]);

  // Stick to the bottom as text streams in — but only while pinned, so a user who
  // has scrolled up to read history isn't yanked back down by the next chunk.
  useLayoutEffect(() => {
    const el = capRef.current;
    if (!el) return;
    // Fade the top edge only once text actually overflows the cap.
    setOverflowing(el.scrollHeight > el.clientHeight + 1);
    if (pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [streamText]);

  // Each fresh streaming session starts pinned to the bottom, fade cleared.
  useEffect(() => {
    pinnedRef.current = true;
    setOverflowing(false);
  }, [session]);

  const themeLifecycle: ThemeLifecycle = (() => {
    if (state === "idle") return "idle";
    if (state === "processing") return "processing";
    if (state === "transcribing") return "transcribing";
    if (state === "streaming" && phase === "working") {
      return workKind === "polishing" ? "processing" : "transcribing";
    }
    return captureReady ? "listening" : "arming";
  })();

  latestThemeInputRef.current = {
    lifecycle: themeLifecycle,
    spectrum: levels,
    committedText: streamText.committed,
    tentativeText: streamText.tentative,
    reducedMotion: reducesWidgetMotion(widgetAnimation) ? true : undefined,
  };

  const updateThemeSignal = useCallback(() => {
    setThemeSignal(
      themeSignalBuilderRef.current.update({
        ...latestThemeInputRef.current,
        elapsedSeconds: (performance.now() - themeStartedAtRef.current) / 1000,
      }),
    );
  }, []);

  useEffect(() => {
    updateThemeSignal();
  }, [levels, streamText, themeLifecycle, updateThemeSignal, widgetAnimation]);

  // Audio events drive reactive themes near 30 FPS while listening. A light
  // heartbeat keeps idle and working sprite clips moving after audio stops.
  useEffect(() => {
    if (!isVisible || !themeManifest || widgetAnimation !== "full") return;
    const id = window.setInterval(updateThemeSignal, 100);
    return () => window.clearInterval(id);
  }, [isVisible, themeManifest, updateThemeSignal, widgetAnimation]);

  if (!isVisible) return null;

  // Re-pin when the user is within ~a line of the bottom; unpin otherwise.
  const handleStreamScroll = () => {
    const el = capRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 16;
  };

  const fmtTime = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  // ---- Shared building blocks (one visual language for every overlay form) ----
  const waveform = (
    <div className={`swave ${captureReady ? "ready" : "arming"}`}>
      {levels.slice(0, WAVE_BARS).map((v, i) => (
        <i
          key={i}
          style={{
            height: `${Math.max(3, Math.min(18, 3 + Math.pow(v, 0.7) * 15))}px`,
          }}
        />
      ))}
    </div>
  );

  const cancelBtn = (
    <button
      className="sx"
      aria-label="cancel"
      onClick={() => commands.cancelOperation()}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M4 4 L12 12 M12 4 L4 12"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );

  // dot (left) | waveform (center) | timer + cancel (right) — same structure for
  // pill & panel, so the Live morph is a pure width change.
  const listeningRow = (showTimer: boolean, showCancel: boolean) => (
    <div className="sbase">
      <div className="sbase-l">
        <span className={`sdot ${captureReady ? "ready" : "arming"}`} />
      </div>
      {waveform}
      <div className="sbase-r">
        {showTimer && <span className="stimer">{fmtTime(elapsed)}</span>}
        {showCancel && cancelBtn}
      </div>
    </div>
  );

  // spinner (left) | label (center) | cancel (right) — same 3-zone grid as the
  // listening row, so the label is centered.
  const workingRow = (label: string, showCancel: boolean) => (
    <div className="sbase">
      <div className="sbase-l">
        <span className="sspinner" />
      </div>
      <span className="swork-label">{label}</span>
      <div className="sbase-r">{showCancel && cancelBtn}</div>
    </div>
  );

  const renderWithTheme = (classicOverlay: React.ReactNode) => {
    if (!themeManifest) return classicOverlay;
    return (
      <div className="ov-theme-stage">
        <ThemeScene
          key={themeRevision}
          classicFallback={classicOverlay}
          manifest={themeManifest}
          onThemeError={handleThemeError}
          signal={themeSignal}
        />
      </div>
    );
  };

  // Always-on ready state: deliberately tiny, but visible enough to confirm
  // LocalDictate is running. It expands into the listening pill on key-down.
  if (state === "idle") {
    return renderWithTheme(
      <div dir={direction} className={`ov-stage ${position}`}>
        <div className="scard idle" aria-hidden="true">
          <svg className="sidle-mic" viewBox="0 0 20 20">
            <rect x="7" y="3" width="6" height="9" rx="3" />
            <path d="M5 9.5a5 5 0 0 0 10 0M10 14.5V17M7.5 17h5" />
          </svg>
          <span className="sidle-ready" />
        </div>
      </div>,
    );
  }

  // ---- Live overlay: a pill that sculpts open into a panel ----
  if (state === "streaming") {
    const hasText =
      streamText.committed.length > 0 || streamText.tentative.length > 0;
    const working = phase === "working";
    // Keep the panel open whenever there's text — even while finalizing — so the
    // transcript stays put under a working spinner instead of collapsing and
    // squishing the text mid-stream. Only fall back to the small working pill
    // when there was no text to preserve.
    const open = hasText;
    const collapsed = working && !hasText;

    return renderWithTheme(
      <div dir={direction} className={`ov-stage ${position}`}>
        <div
          key={session}
          className={`scard ${open ? "open" : ""} ${collapsed ? "working" : ""} ${
            isVisible ? "" : "leaving"
          }`}
        >
          <div className="stext">
            <div className="stext-clip">
              <div
                className={`stext-cap ${overflowing ? "overflowing" : ""}`}
                ref={capRef}
                onScroll={handleStreamScroll}
              >
                <p>
                  <span className="committed">
                    {streamText.committed ? streamText.committed + " " : ""}
                  </span>
                  <span className="tentative">{streamText.tentative}</span>
                  {/* Drop the blinking caret once finalizing — it's no longer
                      capturing, and a static spinner conveys the work. */}
                  {!working && <span className="scaret" />}
                </p>
              </div>
            </div>
          </div>
          {working
            ? workingRow(
                workKind === "polishing"
                  ? t("overlay.processing")
                  : t("overlay.transcribing"),
                true,
              )
            : listeningRow(open, true)}
        </div>
      </div>,
    );
  }

  // ---- Minimal overlay: exactly one row at a time — waveform (recording), or a
  // spinner + label (transcribing / processing). Never both. The pill animates its
  // width between them; the cancel button is in both rows so it stays put.
  const working = state === "transcribing" || state === "processing";
  const workLabel =
    state === "processing"
      ? t("overlay.processing")
      : t("overlay.transcribing");

  return renderWithTheme(
    <div
      dir={direction}
      className={`ov-stage ${position} ov-fade ${isVisible ? "show" : ""}`}
    >
      <div
        className={`scard compact ${working && isVisible ? "cworking" : ""}`}
      >
        {working ? workingRow(workLabel, true) : listeningRow(false, true)}
      </div>
    </div>,
  );
};

export default RecordingOverlay;
