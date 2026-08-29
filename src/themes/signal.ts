import {
  ThemeSignalSchema,
  type ThemeLifecycle,
  type ThemeSignal,
} from "./schema";
import { clamp01, normalizeSpectrum } from "./bindings";

export interface ThemeSignalInput {
  lifecycle: ThemeLifecycle;
  spectrum?: readonly number[];
  elapsedSeconds?: number;
  committedText?: string;
  tentativeText?: string;
  reducedMotion?: boolean;
  nowMs?: number;
}

export interface ThemeSignalBuilderOptions {
  noiseFloor?: number;
  energyCeiling?: number;
  attackSeconds?: number;
  releaseSeconds?: number;
  voiceOnThreshold?: number;
  voiceOffThreshold?: number;
  cadenceWindowSeconds?: number;
  cadenceOnsetsForMaximum?: number;
  minimumOnsetGapSeconds?: number;
  reducedMotion?: boolean;
  now?: () => number;
}

export interface ThemeSignalBuilder {
  update(input: ThemeSignalInput): ThemeSignal;
  current(): ThemeSignal;
  reset(): ThemeSignal;
}

const INITIAL_SIGNAL: ThemeSignal = {
  lifecycle: "idle",
  energy: 0,
  cadence: 0,
  voiceActivity: false,
  spectrum: Array<number>(16).fill(0),
  elapsedSeconds: 0,
  committedText: "",
  tentativeText: "",
  reducedMotion: false,
};

function smooth(
  current: number,
  target: number,
  deltaSeconds: number,
  timeConstant: number,
): number {
  if (timeConstant <= 0) return target;
  const alpha = 1 - Math.exp(-deltaSeconds / timeConstant);
  return current + (target - current) * alpha;
}

function rawSpectrumEnergy(spectrum: readonly number[]): number {
  return Math.sqrt(
    spectrum.reduce((sum, value) => sum + value * value, 0) /
      Math.max(1, spectrum.length),
  );
}

function defaultReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function createThemeSignalBuilder(
  options: ThemeSignalBuilderOptions = {},
): ThemeSignalBuilder {
  const now = options.now ?? (() => performance.now());
  const noiseFloor = options.noiseFloor ?? 0.025;
  const energyCeiling = Math.max(
    noiseFloor + 0.001,
    options.energyCeiling ?? 0.6,
  );
  const attackSeconds = options.attackSeconds ?? 0.045;
  const releaseSeconds = options.releaseSeconds ?? 0.24;
  const voiceOnThreshold = options.voiceOnThreshold ?? 0.09;
  const voiceOffThreshold = Math.min(
    voiceOnThreshold,
    options.voiceOffThreshold ?? 0.045,
  );
  const cadenceWindowSeconds = options.cadenceWindowSeconds ?? 1.5;
  const cadenceOnsetsForMaximum = options.cadenceOnsetsForMaximum ?? 6;
  const minimumOnsetGapSeconds = options.minimumOnsetGapSeconds ?? 0.09;
  const configuredReducedMotion =
    options.reducedMotion ?? defaultReducedMotion();

  let signal: ThemeSignal = {
    ...INITIAL_SIGNAL,
    spectrum: [...INITIAL_SIGNAL.spectrum],
    reducedMotion: configuredReducedMotion,
  };
  let previousNowMs: number | undefined;
  let sessionStartedMs: number | undefined;
  let previousRawEnergy = 0;
  let voiceActivity = false;
  let lastOnsetSeconds = Number.NEGATIVE_INFINITY;
  let onsetTimes: number[] = [];

  const reset = (): ThemeSignal => {
    signal = {
      ...INITIAL_SIGNAL,
      spectrum: [...INITIAL_SIGNAL.spectrum],
      reducedMotion: configuredReducedMotion,
    };
    previousNowMs = undefined;
    sessionStartedMs = undefined;
    previousRawEnergy = 0;
    voiceActivity = false;
    lastOnsetSeconds = Number.NEGATIVE_INFINITY;
    onsetTimes = [];
    return signal;
  };

  const update = (input: ThemeSignalInput): ThemeSignal => {
    const nowMs = input.nowMs ?? now();
    const deltaSeconds =
      previousNowMs === undefined
        ? 1 / 30
        : Math.max(1 / 240, Math.min(0.25, (nowMs - previousNowMs) / 1000));
    previousNowMs = nowMs;

    if (sessionStartedMs === undefined || input.lifecycle === "idle") {
      sessionStartedMs = nowMs;
    }
    const elapsedSeconds = Math.max(
      0,
      input.elapsedSeconds ?? (nowMs - sessionStartedMs) / 1000,
    );
    const spectrum = normalizeSpectrum(input.spectrum ?? signal.spectrum);
    const measuredEnergy = rawSpectrumEnergy(spectrum);
    const normalizedEnergy = clamp01(
      (measuredEnergy - noiseFloor) / (energyCeiling - noiseFloor),
    );
    const energy = smooth(
      signal.energy,
      normalizedEnergy,
      deltaSeconds,
      normalizedEnergy > signal.energy ? attackSeconds : releaseSeconds,
    );

    if (input.lifecycle !== "listening") {
      voiceActivity = false;
    } else if (voiceActivity) {
      voiceActivity = normalizedEnergy >= voiceOffThreshold;
    } else {
      voiceActivity = normalizedEnergy >= voiceOnThreshold;
    }

    const isOnset =
      voiceActivity &&
      normalizedEnergy >= voiceOnThreshold &&
      previousRawEnergy < voiceOnThreshold &&
      elapsedSeconds - lastOnsetSeconds >= minimumOnsetGapSeconds;
    if (isOnset) {
      lastOnsetSeconds = elapsedSeconds;
      onsetTimes.push(elapsedSeconds);
    }
    previousRawEnergy = normalizedEnergy;

    onsetTimes = onsetTimes.filter(
      (onset) => elapsedSeconds - onset <= cadenceWindowSeconds,
    );
    const cadenceTarget = voiceActivity
      ? clamp01(onsetTimes.length / cadenceOnsetsForMaximum)
      : 0;
    const cadence = smooth(
      signal.cadence,
      cadenceTarget,
      deltaSeconds,
      cadenceTarget > signal.cadence ? 0.1 : 0.5,
    );

    signal = ThemeSignalSchema.parse({
      lifecycle: input.lifecycle,
      energy: clamp01(energy),
      cadence: clamp01(cadence),
      voiceActivity,
      spectrum,
      elapsedSeconds,
      committedText: input.committedText ?? signal.committedText,
      tentativeText: input.tentativeText ?? signal.tentativeText,
      reducedMotion: input.reducedMotion ?? configuredReducedMotion,
    });
    return signal;
  };

  return {
    update,
    current: () => signal,
    reset,
  };
}

export interface DemoThemeSignalOptions {
  lifecycle?: ThemeLifecycle;
  reducedMotion?: boolean;
  committedText?: string;
  tentativeText?: string;
  intensity?: number;
}

/** A deterministic signal for previews, screenshots, and renderer tests. */
export function createDemoThemeSignal(
  elapsedSeconds: number,
  options: DemoThemeSignalOptions = {},
): ThemeSignal {
  const time = Math.max(0, elapsedSeconds);
  const intensity = clamp01(options.intensity ?? 0.75);
  const speechEnvelope =
    (0.28 + 0.72 * Math.pow(Math.max(0, Math.sin(time * 5.4)), 1.7)) *
    intensity;
  const lifecycle = options.lifecycle ?? "listening";
  const active = lifecycle === "listening";
  const energy = active ? clamp01(speechEnvelope) : 0;
  const spectrum = Array.from({ length: 16 }, (_, index) => {
    const spectralShape = Math.exp(-index / 10);
    const wobble = 0.72 + 0.28 * Math.sin(time * 3.1 + index * 1.37);
    return clamp01(energy * spectralShape * wobble);
  });

  return ThemeSignalSchema.parse({
    lifecycle,
    energy,
    cadence: active ? clamp01(0.35 + 0.3 * Math.sin(time * 1.7)) : 0,
    voiceActivity: active && energy > 0.12,
    spectrum,
    elapsedSeconds: time,
    committedText: options.committedText ?? "",
    tentativeText: options.tentativeText ?? "",
    reducedMotion: options.reducedMotion ?? false,
  });
}
