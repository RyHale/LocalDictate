export { ThemeScene, type ThemeSceneProps } from "./ThemeScene";

export {
  ThemeLifecycleSchema,
  ThemeManifestV1Schema,
  ResolvedThemeManifestV1Schema,
  ResolvedThemeOverlaySchema,
  ThemeOverlaySchema,
  ThemeSignalSchema,
  NumericBindingSchema,
  ParticleConfigSchema,
  ReactiveImageConfigSchema,
  SpriteConfigSchema,
  WebConfigSchema,
  validateResolvedThemeManifest,
  validateThemeManifest,
  type NumericBinding,
  type ParticleConfig,
  type ReactiveImageConfig,
  type SpriteConfig,
  type ThemeLifecycle,
  type ThemeManifestV1,
  type ThemeManifestValidationResult,
  type ThemeOverlay,
  type ThemeSignal,
  type WebConfig,
} from "./schema";

export {
  assertSafeResolvedThemeAssetUrl,
  isSafeResolvedThemeAssetUrl,
  resolveThemeAssets,
  type ThemeAssetContext,
  type ThemeAssetResolver,
  type ThemeAssetRole,
} from "./assets";

export {
  createDemoThemeSignal,
  createThemeSignalBuilder,
  type DemoThemeSignalOptions,
  type ThemeSignalBuilder,
  type ThemeSignalBuilderOptions,
  type ThemeSignalInput,
} from "./signal";

export { evaluateBinding, normalizeSpectrum } from "./bindings";
export { WEB_THEME_CSP } from "./renderers/web";
