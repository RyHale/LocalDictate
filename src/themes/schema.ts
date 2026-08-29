import { z } from "zod";

import { isSafeResolvedThemeAssetUrl } from "./assetPolicy";

const finiteNumber = z.number().finite();
const unitNumber = finiteNumber.min(0).max(1);
const positiveNumber = finiteNumber.positive();
const assetReference = z
  .string()
  .min(1)
  .max(2048)
  .refine((reference) => {
    if (
      reference.startsWith("/") ||
      reference.includes("\\") ||
      reference.includes(":") ||
      reference.includes("\0") ||
      reference.includes("?") ||
      reference.includes("#")
    ) {
      return false;
    }
    return reference
      .split("/")
      .every(
        (segment) =>
          segment.length > 0 &&
          segment !== "." &&
          segment !== ".." &&
          !segment.endsWith(".") &&
          !segment.endsWith(" "),
      );
  }, "Asset references must be normalized relative paths inside the theme pack");
const pngReference = assetReference.refine(
  (reference) => reference.toLowerCase().endsWith(".png"),
  "Asset must be a PNG",
);
const javascriptReference = assetReference.refine(
  (reference) => reference.toLowerCase().endsWith(".js"),
  "Web entry must be a JavaScript file",
);
const resolvedAssetUrl = z
  .string()
  .min(1)
  .max(8192)
  .refine(
    isSafeResolvedThemeAssetUrl,
    "Resolved assets must use an app-owned local URL",
  );
const color = z.string().min(1).max(128);
const themeAccent = z.enum(["blue", "violet", "teal", "rose", "amber"]);

export const ThemeLifecycleSchema = z.enum([
  "idle",
  "arming",
  "listening",
  "transcribing",
  "processing",
]);

export const ThemeSignalSchema = z
  .object({
    lifecycle: ThemeLifecycleSchema,
    energy: unitNumber,
    cadence: unitNumber,
    voiceActivity: z.boolean(),
    spectrum: z.array(unitNumber).length(16),
    elapsedSeconds: finiteNumber.nonnegative(),
    committedText: z.string(),
    tentativeText: z.string(),
    reducedMotion: z.boolean(),
  })
  .strict();

export const NumericSignalSourceSchema = z.enum(["energy", "cadence"]);

export const NumericBindingSchema = z.union([
  finiteNumber,
  z
    .object({
      source: NumericSignalSourceSchema,
      input: z.tuple([finiteNumber, finiteNumber]).optional(),
      output: z.tuple([finiteNumber, finiteNumber]),
      easing: z
        .enum(["linear", "ease-in", "ease-out", "ease-in-out"])
        .optional(),
      clamp: z.boolean().optional(),
    })
    .strict(),
]);

const blendMode = z.enum([
  "source-over",
  "lighter",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
]);

const createImageLayerSchema = <TAsset extends z.ZodType<string>>(
  asset: TAsset,
) =>
  z
    .object({
      asset,
      x: NumericBindingSchema.optional(),
      y: NumericBindingSchema.optional(),
      width: positiveNumber.optional(),
      height: positiveNumber.optional(),
      scale: NumericBindingSchema.optional(),
      rotation: NumericBindingSchema.optional(),
      opacity: NumericBindingSchema.optional(),
      blur: NumericBindingSchema.optional(),
      glow: z
        .object({
          color,
          radius: NumericBindingSchema,
          opacity: NumericBindingSchema.optional(),
        })
        .strict()
        .optional(),
      tint: z
        .object({
          color,
          opacity: NumericBindingSchema,
        })
        .strict()
        .optional(),
      blendMode: blendMode.optional(),
      anchor: z
        .enum(["top-left", "top-center", "center", "bottom-center"])
        .optional(),
    })
    .strict();

const imageLayer = createImageLayerSchema(pngReference);
const resolvedImageLayer = createImageLayerSchema(resolvedAssetUrl);
const createReactiveImageConfigSchema = <TLayer extends z.ZodTypeAny>(
  layer: TLayer,
) =>
  z
    .object({
      layers: z.array(layer).min(1).max(32),
    })
    .strict();

export const ReactiveImageConfigSchema =
  createReactiveImageConfigSchema(imageLayer);
const ResolvedReactiveImageConfigSchema =
  createReactiveImageConfigSchema(resolvedImageLayer);

const spriteClip = z
  .object({
    from: z.number().int().nonnegative(),
    to: z.number().int().nonnegative(),
    fps: positiveNumber.max(120),
    loop: z.boolean().default(true),
  })
  .strict()
  .refine((clip) => clip.to >= clip.from, {
    message: "Sprite clip end frame must be at or after its start frame",
    path: ["to"],
  });

const lifecycleClipMap = z
  .object({
    idle: z.string().min(1),
    arming: z.string().min(1),
    listening: z.string().min(1),
    transcribing: z.string().min(1),
    processing: z.string().min(1),
  })
  .strict();

const createSpriteLayerSchema = <TAsset extends z.ZodType<string>>(
  atlas: TAsset,
) =>
  z
    .object({
      atlas,
      columns: z.number().int().positive().max(4096),
      rows: z.number().int().positive().max(4096),
      frameWidth: positiveNumber.max(4096).optional(),
      frameHeight: positiveNumber.max(4096).optional(),
      clips: z
        .record(z.string().min(1), spriteClip)
        .refine(
          (clips) => Object.keys(clips).length > 0,
          "At least one sprite clip is required",
        ),
      lifecycleClips: lifecycleClipMap,
      reducedMotionFrame: z.number().int().nonnegative(),
      x: finiteNumber.optional(),
      y: finiteNumber.optional(),
      scale: NumericBindingSchema.optional(),
      opacity: NumericBindingSchema.optional(),
      speed: NumericBindingSchema.optional(),
      blendMode: blendMode.optional(),
    })
    .strict()
    .superRefine((layer, context) => {
      for (const [lifecycle, clipName] of Object.entries(
        layer.lifecycleClips,
      )) {
        if (!layer.clips[clipName]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Lifecycle ${lifecycle} references missing clip ${clipName}`,
            path: ["lifecycleClips", lifecycle],
          });
        }
      }
    });

const spriteLayer = createSpriteLayerSchema(pngReference);
const resolvedSpriteLayer = createSpriteLayerSchema(resolvedAssetUrl);
const createSpriteConfigSchema = <TLayer extends z.ZodTypeAny>(layer: TLayer) =>
  z
    .object({
      layers: z.array(layer).min(1).max(16),
    })
    .strict();

export const SpriteConfigSchema = createSpriteConfigSchema(spriteLayer);
const ResolvedSpriteConfigSchema =
  createSpriteConfigSchema(resolvedSpriteLayer);

const particleEmitter = z
  .object({
    x: NumericBindingSchema,
    y: NumericBindingSchema,
    rate: NumericBindingSchema,
    maxParticles: z.number().int().positive().max(5000),
    lifetimeSeconds: positiveNumber.max(60),
    speed: NumericBindingSchema,
    directionDegrees: NumericBindingSchema,
    spreadDegrees: finiteNumber.min(0).max(360),
    gravityX: finiteNumber.optional(),
    gravityY: finiteNumber.optional(),
    size: NumericBindingSchema,
    endSize: NumericBindingSchema.optional(),
    opacity: NumericBindingSchema.optional(),
    colors: z.array(color).min(1).max(32),
    shape: z.enum(["circle", "square", "line"]).optional(),
    blendMode: blendMode.optional(),
    seed: z.number().int().optional(),
  })
  .strict();

const createParticleConfigSchema = <TAsset extends z.ZodType<string>>(
  reducedMotionAsset: TAsset,
) =>
  z
    .object({
      background: color.optional(),
      emitters: z.array(particleEmitter).min(1).max(32),
      reducedMotionAsset,
    })
    .strict();

export const ParticleConfigSchema = createParticleConfigSchema(pngReference);
const ResolvedParticleConfigSchema =
  createParticleConfigSchema(resolvedAssetUrl);

const createWebConfigSchema = <
  TEntry extends z.ZodType<string>,
  TAsset extends z.ZodType<string>,
  TReducedMotionAsset extends z.ZodType<string>,
>(
  entry: TEntry,
  asset: TAsset,
  reducedMotionAsset: TReducedMotionAsset,
) =>
  z
    .object({
      entry,
      assets: z.record(z.string().min(1).max(128), asset).optional(),
      reducedMotionAsset,
    })
    .strict();

export const WebConfigSchema = createWebConfigSchema(
  javascriptReference,
  assetReference,
  pngReference,
);
const ResolvedWebConfigSchema = createWebConfigSchema(
  resolvedAssetUrl,
  resolvedAssetUrl,
  resolvedAssetUrl,
);

const overlayBase = {
  width: z.number().int().min(32).max(2048),
  height: z.number().int().min(32).max(2048),
  anchor: z.enum([
    "bottom-left",
    "bottom-center",
    "bottom-right",
    "top-left",
    "top-center",
    "top-right",
    "center-left",
    "center",
    "center-right",
  ]),
  pointerMode: z.enum(["passthrough", "interactive"]),
};

const createThemeOverlaySchema = <
  TReactive extends z.ZodTypeAny,
  TSprite extends z.ZodTypeAny,
  TParticles extends z.ZodTypeAny,
  TWeb extends z.ZodTypeAny,
>(
  reactiveImage: TReactive,
  sprite: TSprite,
  particles: TParticles,
  web: TWeb,
) =>
  z.discriminatedUnion("renderer", [
    z
      .object({
        ...overlayBase,
        renderer: z.literal("reactive-image"),
        config: reactiveImage,
      })
      .strict(),
    z
      .object({
        ...overlayBase,
        renderer: z.literal("sprite"),
        config: sprite,
      })
      .strict(),
    z
      .object({
        ...overlayBase,
        renderer: z.literal("particles"),
        config: particles,
      })
      .strict(),
    z
      .object({
        ...overlayBase,
        renderer: z.literal("web"),
        config: web,
      })
      .strict(),
  ]);

export const ThemeOverlaySchema = createThemeOverlaySchema(
  ReactiveImageConfigSchema,
  SpriteConfigSchema,
  ParticleConfigSchema,
  WebConfigSchema,
);
export const ResolvedThemeOverlaySchema = createThemeOverlaySchema(
  ResolvedReactiveImageConfigSchema,
  ResolvedSpriteConfigSchema,
  ResolvedParticleConfigSchema,
  ResolvedWebConfigSchema,
);

const bundledProfile = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().min(1).max(128),
    prompt: z.string().min(1).max(50_000),
  })
  .strict();

const themePreset = z
  .object({
    appearance: z.enum(["light", "dark", "system"]).optional(),
    accent: themeAccent.optional(),
    postProcessing: z
      .object({
        enabled: z.boolean(),
        profile: bundledProfile.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const createThemeManifestV1Schema = <
  TPreview extends z.ZodType<string>,
  TOverlay extends z.ZodTypeAny,
>(
  preview: TPreview,
  overlay: TOverlay,
) =>
  z
    .object({
      schemaVersion: z.literal(1),
      id: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      name: z.string().min(1).max(128),
      description: z.string().min(1).max(500),
      author: z.string().min(1).max(128),
      preview,
      overlay,
      preset: themePreset.optional(),
    })
    .strict();

export const ThemeManifestV1Schema = createThemeManifestV1Schema(
  pngReference,
  ThemeOverlaySchema,
);
export const ResolvedThemeManifestV1Schema = createThemeManifestV1Schema(
  resolvedAssetUrl,
  ResolvedThemeOverlaySchema,
);

export type ThemeLifecycle = z.infer<typeof ThemeLifecycleSchema>;
export type ThemeSignal = z.infer<typeof ThemeSignalSchema>;
export type NumericBinding = z.infer<typeof NumericBindingSchema>;
export type ReactiveImageConfig = z.infer<typeof ReactiveImageConfigSchema>;
export type SpriteConfig = z.infer<typeof SpriteConfigSchema>;
export type ParticleConfig = z.infer<typeof ParticleConfigSchema>;
export type WebConfig = z.infer<typeof WebConfigSchema>;
export type ThemeOverlay = z.infer<typeof ThemeOverlaySchema>;
export type ThemeManifestV1 = z.infer<typeof ThemeManifestV1Schema>;

export type ThemeManifestValidationResult =
  | { success: true; manifest: ThemeManifestV1 }
  | { success: false; errors: string[] };

export function validateResolvedThemeManifest(
  input: unknown,
): ThemeManifestValidationResult {
  const result = ResolvedThemeManifestV1Schema.safeParse(input);
  if (result.success) {
    return { success: true, manifest: result.data as ThemeManifestV1 };
  }

  return {
    success: false,
    errors: result.error.issues.map((issue) => {
      const location =
        issue.path.length > 0 ? issue.path.join(".") : "manifest";
      return `${location}: ${issue.message}`;
    }),
  };
}

export function validateThemeManifest(
  input: unknown,
): ThemeManifestValidationResult {
  const result = ThemeManifestV1Schema.safeParse(input);
  if (result.success) {
    return { success: true, manifest: result.data };
  }

  return {
    success: false,
    errors: result.error.issues.map((issue) => {
      const location =
        issue.path.length > 0 ? issue.path.join(".") : "manifest";
      return `${location}: ${issue.message}`;
    }),
  };
}
