import { z } from "zod";

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

const imageLayer = z
  .object({
    asset: pngReference,
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

export const ReactiveImageConfigSchema = z
  .object({
    layers: z.array(imageLayer).min(1).max(32),
  })
  .strict();

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

const spriteLayer = z
  .object({
    atlas: pngReference,
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
    for (const [lifecycle, clipName] of Object.entries(layer.lifecycleClips)) {
      if (!layer.clips[clipName]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Lifecycle ${lifecycle} references missing clip ${clipName}`,
          path: ["lifecycleClips", lifecycle],
        });
      }
    }
  });

export const SpriteConfigSchema = z
  .object({
    layers: z.array(spriteLayer).min(1).max(16),
  })
  .strict();

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

export const ParticleConfigSchema = z
  .object({
    background: color.optional(),
    emitters: z.array(particleEmitter).min(1).max(32),
    reducedMotionAsset: pngReference,
  })
  .strict();

export const WebConfigSchema = z
  .object({
    entry: javascriptReference,
    assets: z.record(z.string().min(1).max(128), assetReference).optional(),
    reducedMotionAsset: pngReference,
  })
  .strict();

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

export const ThemeOverlaySchema = z.discriminatedUnion("renderer", [
  z
    .object({
      ...overlayBase,
      renderer: z.literal("reactive-image"),
      config: ReactiveImageConfigSchema,
    })
    .strict(),
  z
    .object({
      ...overlayBase,
      renderer: z.literal("sprite"),
      config: SpriteConfigSchema,
    })
    .strict(),
  z
    .object({
      ...overlayBase,
      renderer: z.literal("particles"),
      config: ParticleConfigSchema,
    })
    .strict(),
  z
    .object({
      ...overlayBase,
      renderer: z.literal("web"),
      config: WebConfigSchema,
    })
    .strict(),
]);

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

export const ThemeManifestV1Schema = z
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
    preview: pngReference,
    overlay: ThemeOverlaySchema,
    preset: themePreset.optional(),
  })
  .strict();

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
