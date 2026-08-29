import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";

import {
  ThemeManifestV1Schema,
  ThemeSignalSchema,
  type ThemeManifestV1,
  type ThemeSignal,
} from "./schema";
import { ParticleRenderer } from "./renderers/particles";
import { ReactiveImageRenderer } from "./renderers/reactive-image";
import { SpriteRenderer } from "./renderers/sprite";
import { WebRenderer } from "./renderers/web";

interface ThemeErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  resetKey: string;
  onError?: (error: Error) => void;
}

interface ThemeErrorBoundaryState {
  error?: Error;
}

class ThemeErrorBoundary extends Component<
  ThemeErrorBoundaryProps,
  ThemeErrorBoundaryState
> {
  state: ThemeErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): ThemeErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError?.(error);
  }

  componentDidUpdate(previousProps: ThemeErrorBoundaryProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: undefined });
    }
  }

  render() {
    return this.state.error ? this.props.fallback : this.props.children;
  }
}

export interface ThemeSceneProps {
  manifest: ThemeManifestV1 | unknown;
  signal: ThemeSignal | unknown;
  width?: number;
  height?: number;
  classicFallback: ReactNode;
  onThemeError?: (error: Error) => void;
  className?: string;
}

function validationError(messages: readonly string[]): Error {
  return new Error(messages.join("; "));
}

export function ThemeScene({
  manifest: manifestInput,
  signal: signalInput,
  width: widthOverride,
  height: heightOverride,
  classicFallback,
  onThemeError,
  className,
}: ThemeSceneProps) {
  const [runtimeError, setRuntimeError] = useState<Error>();
  const manifestResult = useMemo(
    () => ThemeManifestV1Schema.safeParse(manifestInput),
    [manifestInput],
  );
  const signalResult = useMemo(
    () => ThemeSignalSchema.safeParse(signalInput),
    [signalInput],
  );
  const themeId = manifestResult.success ? manifestResult.data.id : "invalid";
  const manifestRevisionRef = useRef({ input: manifestInput, revision: 0 });
  if (manifestRevisionRef.current.input !== manifestInput) {
    manifestRevisionRef.current = {
      input: manifestInput,
      revision: manifestRevisionRef.current.revision + 1,
    };
  }
  const resetKey = `${themeId}:${manifestRevisionRef.current.revision}`;

  useEffect(() => setRuntimeError(undefined), [resetKey]);

  const handleError = useCallback(
    (error: Error) => {
      setRuntimeError(error);
      onThemeError?.(error);
    },
    [onThemeError],
  );

  useEffect(() => {
    if (!manifestResult.success) {
      onThemeError?.(
        validationError(
          manifestResult.error.issues.map(
            (issue) => `${issue.path.join(".")}: ${issue.message}`,
          ),
        ),
      );
    } else if (!signalResult.success) {
      onThemeError?.(
        validationError(
          signalResult.error.issues.map(
            (issue) => `${issue.path.join(".")}: ${issue.message}`,
          ),
        ),
      );
    }
  }, [manifestResult, onThemeError, signalResult]);

  if (!manifestResult.success || !signalResult.success || runtimeError) {
    return <>{classicFallback}</>;
  }

  const manifest = manifestResult.data;
  const signal = signalResult.data;
  const width = widthOverride ?? manifest.overlay.width;
  const height = heightOverride ?? manifest.overlay.height;
  const renderer = (() => {
    switch (manifest.overlay.renderer) {
      case "reactive-image":
        return (
          <ReactiveImageRenderer
            config={manifest.overlay.config}
            height={height}
            onError={handleError}
            signal={signal}
            width={width}
          />
        );
      case "sprite":
        return (
          <SpriteRenderer
            config={manifest.overlay.config}
            height={height}
            onError={handleError}
            signal={signal}
            width={width}
          />
        );
      case "particles":
        return (
          <ParticleRenderer
            config={manifest.overlay.config}
            height={height}
            onError={handleError}
            signal={signal}
            width={width}
          />
        );
      case "web":
        return (
          <WebRenderer
            config={manifest.overlay.config}
            height={height}
            onError={handleError}
            signal={signal}
            width={width}
          />
        );
    }
  })();

  return (
    <ThemeErrorBoundary
      fallback={classicFallback}
      onError={onThemeError}
      resetKey={resetKey}
    >
      <div
        aria-hidden="true"
        className={className}
        data-theme-id={manifest.id}
        data-theme-renderer={manifest.overlay.renderer}
        style={{
          height,
          overflow: "hidden",
          pointerEvents:
            manifest.overlay.pointerMode === "passthrough" ? "none" : "auto",
          position: "relative",
          width,
        }}
      >
        {renderer}
      </div>
    </ThemeErrorBoundary>
  );
}
