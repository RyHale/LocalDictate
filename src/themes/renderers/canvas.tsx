import { useEffect, useRef, type CSSProperties } from "react";

import { assertSafeResolvedThemeAssetUrl } from "../assets";
import type { ThemeSignal } from "../schema";

const imagePromises = new Map<string, Promise<HTMLImageElement>>();

export function loadThemeImage(url: string): Promise<HTMLImageElement> {
  const safeUrl = assertSafeResolvedThemeAssetUrl(url);
  const existing = imagePromises.get(safeUrl);
  if (existing) return existing;

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Theme image could not be loaded"));
    image.src = safeUrl;
  });
  imagePromises.set(safeUrl, promise);
  promise.catch(() => imagePromises.delete(safeUrl));
  return promise;
}

export interface CanvasFrame {
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
  signal: ThemeSignal;
  timestampMs: number;
}

export function interpolateCanvasSignal(
  signal: ThemeSignal,
  receivedAtMs: number,
  timestampMs: number,
): ThemeSignal {
  if (signal.reducedMotion) return signal;
  return {
    ...signal,
    elapsedSeconds:
      signal.elapsedSeconds + Math.max(0, timestampMs - receivedAtMs) / 1000,
  };
}

interface ThemeCanvasProps {
  width: number;
  height: number;
  signal: ThemeSignal;
  draw: (frame: CanvasFrame) => void;
  onError: (error: Error) => void;
}

const canvasStyle: CSSProperties = {
  display: "block",
  pointerEvents: "none",
};

export function ThemeCanvas({
  width,
  height,
  signal,
  draw,
  onError,
}: ThemeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const signalRef = useRef(signal);
  const signalReceivedAtRef = useRef(performance.now());
  const drawRef = useRef(draw);
  const errorRef = useRef(onError);
  if (signalRef.current !== signal) {
    signalRef.current = signal;
    signalReceivedAtRef.current = performance.now();
  }
  drawRef.current = draw;
  errorRef.current = onError;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let animationFrame = 0;
    let stopped = false;
    const render = (timestampMs: number) => {
      if (stopped) return;
      try {
        const deviceScale = Math.max(1, window.devicePixelRatio || 1);
        const pixelWidth = Math.max(1, Math.round(width * deviceScale));
        const pixelHeight = Math.max(1, Math.round(height * deviceScale));
        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
          canvas.width = pixelWidth;
          canvas.height = pixelHeight;
        }
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas 2D is unavailable");
        context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
        context.clearRect(0, 0, width, height);
        drawRef.current({
          context,
          width,
          height,
          signal: interpolateCanvasSignal(
            signalRef.current,
            signalReceivedAtRef.current,
            timestampMs,
          ),
          timestampMs,
        });
      } catch (error) {
        stopped = true;
        errorRef.current(
          error instanceof Error ? error : new Error("Theme renderer failed"),
        );
        return;
      }
      animationFrame = requestAnimationFrame(render);
    };
    animationFrame = requestAnimationFrame(render);

    return () => {
      stopped = true;
      cancelAnimationFrame(animationFrame);
    };
  }, [height, width]);

  return (
    <canvas
      aria-hidden="true"
      ref={canvasRef}
      style={{ ...canvasStyle, width, height }}
    />
  );
}
