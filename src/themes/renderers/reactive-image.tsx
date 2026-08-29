import { useCallback, useEffect, useState } from "react";

import { evaluateBinding } from "../bindings";
import type { ReactiveImageConfig, ThemeSignal } from "../schema";
import { loadThemeImage, ThemeCanvas, type CanvasFrame } from "./canvas";

interface ReactiveImageRendererProps {
  config: ReactiveImageConfig;
  width: number;
  height: number;
  signal: ThemeSignal;
  onError: (error: Error) => void;
}

function anchorOffset(
  anchor: "top-left" | "top-center" | "center" | "bottom-center",
  width: number,
  height: number,
): [number, number] {
  switch (anchor) {
    case "top-left":
      return [0, 0];
    case "top-center":
      return [-width / 2, 0];
    case "bottom-center":
      return [-width / 2, -height];
    default:
      return [-width / 2, -height / 2];
  }
}

function tintImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  opacity: number,
) {
  const surface = document.createElement("canvas");
  surface.width = Math.max(1, Math.ceil(width));
  surface.height = Math.max(1, Math.ceil(height));
  const tintContext = surface.getContext("2d");
  if (!tintContext) return;
  tintContext.drawImage(image, 0, 0, width, height);
  tintContext.globalCompositeOperation = "source-atop";
  tintContext.globalAlpha = Math.max(0, Math.min(1, opacity));
  tintContext.fillStyle = color;
  tintContext.fillRect(0, 0, width, height);
  context.drawImage(surface, x, y, width, height);
}

export function ReactiveImageRenderer({
  config,
  width,
  height,
  signal,
  onError,
}: ReactiveImageRendererProps) {
  const [images, setImages] = useState<readonly HTMLImageElement[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(config.layers.map((layer) => loadThemeImage(layer.asset)))
      .then((loaded) => {
        if (!cancelled) setImages(loaded);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          onError(
            error instanceof Error ? error : new Error("Theme image failed"),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [config, onError]);

  const draw = useCallback(
    ({ context, signal: frameSignal }: CanvasFrame) => {
      if (images.length !== config.layers.length) return;
      config.layers.forEach((layer, index) => {
        const image = images[index];
        const drawWidth = layer.width ?? image.naturalWidth;
        const drawHeight = layer.height ?? image.naturalHeight;
        const scale = evaluateBinding(layer.scale, frameSignal, 1);
        const x = evaluateBinding(layer.x, frameSignal, width / 2);
        const y = evaluateBinding(layer.y, frameSignal, height / 2);
        const opacity = Math.max(
          0,
          Math.min(1, evaluateBinding(layer.opacity, frameSignal, 1)),
        );
        const rotation =
          (evaluateBinding(layer.rotation, frameSignal, 0) * Math.PI) / 180;
        const blur = Math.max(0, evaluateBinding(layer.blur, frameSignal, 0));
        const [offsetX, offsetY] = anchorOffset(
          layer.anchor ?? "center",
          drawWidth,
          drawHeight,
        );

        context.save();
        context.translate(x, y);
        context.rotate(rotation);
        context.scale(scale, scale);
        context.globalAlpha = opacity;
        context.globalCompositeOperation = layer.blendMode ?? "source-over";
        context.filter = blur > 0 ? `blur(${blur}px)` : "none";

        if (layer.glow) {
          context.save();
          context.shadowColor = layer.glow.color;
          context.shadowBlur = Math.max(
            0,
            evaluateBinding(layer.glow.radius, frameSignal, 0),
          );
          context.globalAlpha =
            opacity *
            Math.max(
              0,
              Math.min(1, evaluateBinding(layer.glow.opacity, frameSignal, 1)),
            );
          context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
          context.restore();
        }

        context.globalAlpha = opacity;
        if (layer.tint) {
          tintImage(
            context,
            image,
            offsetX,
            offsetY,
            drawWidth,
            drawHeight,
            layer.tint.color,
            evaluateBinding(layer.tint.opacity, frameSignal, 0),
          );
        } else {
          context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
        }
        context.restore();
      });
    },
    [config.layers, height, images, width],
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
