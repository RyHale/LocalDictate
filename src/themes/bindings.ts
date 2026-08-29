import type { NumericBinding, ThemeSignal } from "./schema";

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function ease(value: number, easing: string | undefined): number {
  switch (easing) {
    case "ease-in":
      return value * value;
    case "ease-out":
      return 1 - (1 - value) * (1 - value);
    case "ease-in-out":
      return value < 0.5
        ? 2 * value * value
        : 1 - Math.pow(-2 * value + 2, 2) / 2;
    default:
      return value;
  }
}

export function evaluateBinding(
  binding: NumericBinding | undefined,
  signal: ThemeSignal,
  fallback: number,
): number {
  if (binding === undefined) return fallback;
  if (typeof binding === "number") return binding;

  const sourceValue = signal[binding.source];
  const [inputStart, inputEnd] = binding.input ?? [0, 1];
  const denominator = inputEnd - inputStart;
  const normalized =
    denominator === 0 ? 0 : (sourceValue - inputStart) / denominator;
  const progress = ease(
    binding.clamp === false ? normalized : clamp01(normalized),
    binding.easing,
  );
  return binding.output[0] + (binding.output[1] - binding.output[0]) * progress;
}

export function normalizeSpectrum(input: readonly number[]): number[] {
  return Array.from({ length: 16 }, (_, index) =>
    clamp01(Number.isFinite(input[index]) ? input[index] : 0),
  );
}

export { clamp01 };
