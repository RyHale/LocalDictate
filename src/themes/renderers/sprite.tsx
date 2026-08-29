import { useCallback, useEffect, useState } from "react";

import { evaluateBinding } from "../bindings";
import type { SpriteConfig, ThemeSignal } from "../schema";
import { loadThemeImage, ThemeCanvas, type CanvasFrame } from "./canvas";

interface SpriteRendererProps {
  config: SpriteConfig;
  width: number;
  height: number;
  signal: ThemeSignal;
  onError: (error: Error) => void;
}

export function SpriteRenderer({
  config,
  width,
  height,
  signal,
  onError,
}: SpriteRendererProps) {
  const [atlases, setAtlases] = useState<readonly HTMLImageElement[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(config.layers.map((layer) => loadThemeImage(layer.atlas)))
      .then((loaded) => {
        if (!cancelled) setAtlases(loaded);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          onError(
            error instanceof Error ? error : new Error("Sprite atlas failed"),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [config, onError]);

  const draw = useCallback(
    ({ context, signal: frameSignal }: CanvasFrame) => {
      if (atlases.length !== config.layers.length) return;
      config.layers.forEach((layer, index) => {
        const atlas = atlases[index];
        const sourceWidth =
          layer.frameWidth ?? atlas.naturalWidth / layer.columns;
        const sourceHeight =
          layer.frameHeight ?? atlas.naturalHeight / layer.rows;
        const totalFrames = layer.columns * layer.rows;
        const clipName = layer.lifecycleClips[frameSignal.lifecycle];
        const clip = layer.clips[clipName];
        if (!clip) throw new Error("Sprite lifecycle clip is missing");
        if (clip.to >= totalFrames || layer.reducedMotionFrame >= totalFrames) {
          throw new Error("Sprite frame exceeds the declared atlas grid");
        }

        const frameCount = clip.to - clip.from + 1;
        const speed = Math.max(0, evaluateBinding(layer.speed, frameSignal, 1));
        const progressedFrames = Math.floor(
          frameSignal.elapsedSeconds * clip.fps * speed,
        );
        const animatedFrame = clip.loop
          ? clip.from + (progressedFrames % frameCount)
          : Math.min(clip.to, clip.from + progressedFrames);
        const frameIndex = frameSignal.reducedMotion
          ? layer.reducedMotionFrame
          : animatedFrame;
        const sourceX = (frameIndex % layer.columns) * sourceWidth;
        const sourceY = Math.floor(frameIndex / layer.columns) * sourceHeight;
        const scale = Math.max(0, evaluateBinding(layer.scale, frameSignal, 1));
        const opacity = Math.max(
          0,
          Math.min(1, evaluateBinding(layer.opacity, frameSignal, 1)),
        );
        const targetWidth = sourceWidth * scale;
        const targetHeight = sourceHeight * scale;
        const x = layer.x ?? width / 2;
        const y = layer.y ?? height;

        context.save();
        context.globalAlpha = opacity;
        context.globalCompositeOperation = layer.blendMode ?? "source-over";
        context.drawImage(
          atlas,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          x - targetWidth / 2,
          y - targetHeight,
          targetWidth,
          targetHeight,
        );
        context.restore();
      });
    },
    [atlases, config.layers, height, width],
  );

  return (
    <ThemeCanvas
      draw={draw}
      height={height}
      onError={onError}
      signal={signal}
      width={width}
    />
  );
}
