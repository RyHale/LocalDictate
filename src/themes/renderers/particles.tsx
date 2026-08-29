import { useCallback, useEffect, useState } from "react";

import { evaluateBinding } from "../bindings";
import type { ParticleConfig, ThemeSignal } from "../schema";
import { loadThemeImage, ThemeCanvas, type CanvasFrame } from "./canvas";

interface ParticleRendererProps {
  config: ParticleConfig;
  width: number;
  height: number;
  signal: ThemeSignal;
  onError: (error: Error) => void;
}

function random(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43_758.5453;
  return value - Math.floor(value);
}

export function ParticleRenderer({
  config,
  width,
  height,
  signal,
  onError,
}: ParticleRendererProps) {
  const [reducedMotionImage, setReducedMotionImage] =
    useState<HTMLImageElement>();

  useEffect(() => {
    let cancelled = false;
    loadThemeImage(config.reducedMotionAsset)
      .then((image) => {
        if (!cancelled) setReducedMotionImage(image);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          onError(
            error instanceof Error
              ? error
              : new Error("Reduced-motion image failed"),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [config.reducedMotionAsset, onError]);

  const draw = useCallback(
    ({ context, signal: frameSignal }: CanvasFrame) => {
      if (config.background) {
        context.fillStyle = config.background;
        context.fillRect(0, 0, width, height);
      }

      if (frameSignal.reducedMotion) {
        if (!reducedMotionImage) return;
        const scale = Math.min(
          width / reducedMotionImage.naturalWidth,
          height / reducedMotionImage.naturalHeight,
        );
        const drawWidth = reducedMotionImage.naturalWidth * scale;
        const drawHeight = reducedMotionImage.naturalHeight * scale;
        context.drawImage(
          reducedMotionImage,
          (width - drawWidth) / 2,
          (height - drawHeight) / 2,
          drawWidth,
          drawHeight,
        );
        return;
      }

      config.emitters.forEach((emitter, emitterIndex) => {
        const rate = Math.max(0, evaluateBinding(emitter.rate, frameSignal, 0));
        if (rate <= 0) return;
        const count = Math.min(
          emitter.maxParticles,
          Math.max(1, Math.ceil(rate * emitter.lifetimeSeconds)),
        );
        const originX = evaluateBinding(emitter.x, frameSignal, width / 2);
        const originY = evaluateBinding(emitter.y, frameSignal, height / 2);
        const baseSpeed = Math.max(
          0,
          evaluateBinding(emitter.speed, frameSignal, 0),
        );
        const direction = evaluateBinding(
          emitter.directionDegrees,
          frameSignal,
          -90,
        );
        const startSize = Math.max(
          0,
          evaluateBinding(emitter.size, frameSignal, 2),
        );
        const endSize = Math.max(
          0,
          evaluateBinding(emitter.endSize, frameSignal, 0),
        );
        const baseOpacity = Math.max(
          0,
          Math.min(1, evaluateBinding(emitter.opacity, frameSignal, 1)),
        );
        const seed = (emitter.seed ?? 1) + emitterIndex * 10_007;

        context.save();
        context.globalCompositeOperation = emitter.blendMode ?? "source-over";
        for (let index = 0; index < count; index += 1) {
          const phase = index / count;
          const age =
            (frameSignal.elapsedSeconds + phase * emitter.lifetimeSeconds) %
            emitter.lifetimeSeconds;
          const life = age / emitter.lifetimeSeconds;
          const angleVariation =
            (random(seed + index * 3) - 0.5) * emitter.spreadDegrees;
          const angle = ((direction + angleVariation) * Math.PI) / 180;
          const speed = baseSpeed * (0.75 + random(seed + index * 3 + 1) * 0.5);
          const x =
            originX +
            Math.cos(angle) * speed * age +
            0.5 * (emitter.gravityX ?? 0) * age * age;
          const y =
            originY +
            Math.sin(angle) * speed * age +
            0.5 * (emitter.gravityY ?? 0) * age * age;
          const size = startSize + (endSize - startSize) * life;
          const opacity = baseOpacity * (1 - life);
          context.globalAlpha = opacity;
          context.fillStyle =
            emitter.colors[
              Math.floor(random(seed + index * 3 + 2) * emitter.colors.length)
            ];

          if (emitter.shape === "square") {
            context.fillRect(x - size / 2, y - size / 2, size, size);
          } else if (emitter.shape === "line") {
            context.strokeStyle = context.fillStyle;
            context.lineWidth = Math.max(1, size / 3);
            context.beginPath();
            context.moveTo(x, y);
            context.lineTo(
              x - Math.cos(angle) * size * 2,
              y - Math.sin(angle) * size * 2,
            );
            context.stroke();
          } else {
            context.beginPath();
            context.arc(x, y, size / 2, 0, Math.PI * 2);
            context.fill();
          }
        }
        context.restore();
      });
    },
    [config, height, reducedMotionImage, width],
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
