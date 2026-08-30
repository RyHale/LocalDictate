import React, { useCallback, useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  Check,
  ImageOff,
  LoaderCircle,
  Mic2,
  RefreshCw,
  Waves,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { commands } from "@/bindings";
import type { ThemePackInfo } from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import { applyTheme, applyThemeAccent } from "@/lib/utils/theme";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { SettingContainer } from "@/components/ui/SettingContainer";

interface ThemePackSelectorProps {
  grouped?: boolean;
}

type BusyAction = { kind: "apply"; id: string } | null;

const AVAILABLE_THEME_IDS = new Set(["classic", "pirate-scribe"]);

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const joinThemeAssetPath = (root: string, asset: string): string => {
  const separator = root.includes("\\") ? "\\" : "/";
  const normalizedRoot = root.replace(/[\\/]+$/, "");
  const normalizedAsset = asset
    .replace(/^[\\/]+/, "")
    .replace(/[\\/]+/g, separator);

  return `${normalizedRoot}${separator}${normalizedAsset}`;
};

const previewUrlFor = (pack: ThemePackInfo): string | null => {
  if (!pack.root || !pack.manifest.preview) return null;
  return convertFileSrc(
    joinThemeAssetPath(pack.root, pack.manifest.preview),
    "asset",
  );
};

export const ThemePackSelector: React.FC<ThemePackSelectorProps> = ({
  grouped = false,
}) => {
  const { t } = useTranslation();
  const { refreshSettings } = useSettings();
  const [packs, setPacks] = useState<ThemePackInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [failedPreviews, setFailedPreviews] = useState<Set<string>>(
    () => new Set(),
  );

  const activePackId = useMemo(
    () => packs.find((pack) => pack.active)?.manifest.id ?? null,
    [packs],
  );

  const loadThemePacks = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const [packsResult, activeResult] = await Promise.all([
        commands.listThemePacks(),
        commands.getActiveThemePack(),
      ]);
      if (packsResult.status === "error") throw new Error(packsResult.error);
      if (activeResult.status === "error") throw new Error(activeResult.error);

      const activeId = activeResult.data.manifest.id;
      setPacks(
        packsResult.data
          .filter((pack) => AVAILABLE_THEME_IDS.has(pack.manifest.id))
          .map((pack) => ({
            ...pack,
            active: pack.manifest.id === activeId,
          })),
      );
    } catch (error) {
      const message = errorMessage(error);
      setLoadError(message);
      toast.error(t("themePacks.errors.load"), { description: message });
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadThemePacks();
  }, [loadThemePacks]);

  const handleApply = async (id: string) => {
    setBusyAction({ kind: "apply", id });
    try {
      const result = await commands.applyThemePack(id);
      if (result.status === "error") throw new Error(result.error);

      const preset = result.data.manifest.preset;
      const appearance = preset?.appearance;
      const accent = preset?.accent;
      if (appearance) applyTheme(appearance);
      if (accent) applyThemeAccent(accent);

      setPacks((current) =>
        current.map((pack) => ({
          ...pack,
          active: pack.manifest.id === id,
        })),
      );
      await refreshSettings();
      toast.success(t("themePacks.success.applied"), {
        description: result.data.manifest.name,
      });
    } catch (error) {
      const message = errorMessage(error);
      toast.error(t("themePacks.errors.apply"), { description: message });
    } finally {
      setBusyAction(null);
    }
  };

  const isBusy = busyAction !== null;

  return (
    <SettingContainer
      title={t("themePacks.title")}
      description={t("themePacks.description")}
      descriptionMode="inline"
      layout="stacked"
      grouped={grouped}
    >
      <div className="space-y-4" aria-busy={isLoading || isBusy}>
        <Alert variant="info">
          <span>
            <span className="block font-medium text-text">
              {t("themePacks.preset.title")}
            </span>
            <span className="mt-1 block">
              {t("themePacks.preset.description")}
            </span>
          </span>
        </Alert>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-mid-gray">
            {t("themePacks.count", { count: packs.length })}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void loadThemePacks()}
            disabled={isLoading || isBusy}
          >
            <RefreshCw
              className={`mr-1.5 inline h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            {t("themePacks.actions.refresh")}
          </Button>
        </div>

        {loadError ? (
          <div
            role="alert"
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400"
          >
            <span className="font-medium">{t("themePacks.errors.load")}</span>
            <span className="mt-1 block break-words text-xs">{loadError}</span>
          </div>
        ) : null}

        {isLoading && packs.length === 0 ? (
          <div
            role="status"
            className="flex min-h-40 items-center justify-center gap-2 rounded-xl border border-mid-gray/15 text-sm text-mid-gray"
          >
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t("themePacks.loading")}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {packs.map((pack) => {
              const id = pack.manifest.id;
              const previewUrl = previewUrlFor(pack);
              const previewFailed = failedPreviews.has(id);
              const applying =
                busyAction?.kind === "apply" && busyAction.id === id;
              const preset = pack.manifest.preset;
              const presetFeatures = [t("themePacks.features.overlay")];
              if (preset?.appearance || preset?.accent) {
                presetFeatures.push(t("themePacks.features.appearance"));
              }
              if (preset?.postProcessing) {
                presetFeatures.push(t("themePacks.features.cleanup"));
              }

              return (
                <article
                  key={id}
                  className={`overflow-hidden rounded-xl border bg-background transition-colors ${
                    pack.active
                      ? "border-logo-primary ring-1 ring-logo-primary/30"
                      : "border-mid-gray/15"
                  }`}
                >
                  <div className="relative flex aspect-[16/9] items-center justify-center overflow-hidden bg-gradient-to-br from-logo-primary/10 via-background-raised to-logo-primary/5">
                    {previewUrl && !previewFailed ? (
                      <img
                        src={previewUrl}
                        alt={t("themePacks.previewAlt", {
                          name: pack.manifest.name,
                        })}
                        className="h-full w-full object-contain"
                        onError={() =>
                          setFailedPreviews((current) => {
                            const next = new Set(current);
                            next.add(id);
                            return next;
                          })
                        }
                      />
                    ) : pack.source === "classic" ? (
                      <div
                        role="img"
                        aria-label={t("themePacks.classicPreview")}
                        className="flex items-center gap-3 rounded-full border border-logo-primary/20 bg-background/80 px-5 py-3 shadow-lg"
                      >
                        <Mic2
                          className="h-8 w-8 text-logo-primary"
                          aria-hidden="true"
                        />
                        <Waves
                          className="h-8 w-16 text-logo-primary/60"
                          aria-hidden="true"
                        />
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-mid-gray">
                        <ImageOff className="h-8 w-8" aria-hidden="true" />
                        <span className="text-xs">
                          {t("themePacks.previewUnavailable")}
                        </span>
                      </div>
                    )}
                    {pack.active ? (
                      <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-logo-primary px-2 py-1 text-xs font-semibold text-on-accent shadow-sm">
                        <Check className="h-3 w-3" aria-hidden="true" />
                        {t("themePacks.applied")}
                      </span>
                    ) : null}
                  </div>

                  <div className="space-y-3 p-3">
                    <div>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h4 className="font-semibold text-text">
                          {pack.manifest.name}
                        </h4>
                        <div className="flex flex-wrap gap-1">
                          <span className="rounded-full bg-mid-gray/15 px-2 py-0.5 text-[11px] font-medium text-text/65">
                            {t(`themePacks.sources.${pack.source}`)}
                          </span>
                        </div>
                      </div>
                      <p className="mt-0.5 text-xs text-mid-gray">
                        {t("themePacks.byAuthor", {
                          author: pack.manifest.author,
                        })}
                      </p>
                    </div>

                    <p className="text-sm leading-relaxed text-text/75">
                      {pack.manifest.description}
                    </p>

                    <dl className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <dt className="text-mid-gray">
                          {t("themePacks.metadata.renderer")}
                        </dt>
                        <dd className="font-medium text-text/80">
                          {t(
                            `themePacks.renderers.${pack.manifest.overlay.renderer}`,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-mid-gray">
                          {t("themePacks.metadata.canvas")}
                        </dt>
                        <dd className="font-medium text-text/80">
                          {t("themePacks.dimensions", {
                            width: pack.manifest.overlay.width,
                            height: pack.manifest.overlay.height,
                          })}
                        </dd>
                      </div>
                    </dl>

                    <div>
                      <p className="text-xs text-mid-gray">
                        {t("themePacks.features.title")}
                      </p>
                      <ul className="mt-1.5 flex flex-wrap gap-1.5">
                        {presetFeatures.map((feature) => (
                          <li
                            key={feature}
                            className="rounded-full bg-logo-primary/10 px-2 py-0.5 text-[11px] font-medium text-text/70"
                          >
                            {feature}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="flex flex-wrap justify-end gap-2 border-t border-mid-gray/10 pt-3">
                      <Button
                        type="button"
                        variant={pack.active ? "secondary" : "primary"}
                        size="sm"
                        disabled={isBusy}
                        onClick={() => void handleApply(id)}
                      >
                        {applying ? (
                          <LoaderCircle
                            className="mr-1.5 inline h-3.5 w-3.5 animate-spin"
                            aria-hidden="true"
                          />
                        ) : pack.active ? (
                          <Check
                            className="mr-1.5 inline h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                        ) : null}
                        {applying
                          ? t("themePacks.actions.applying")
                          : t("themePacks.actions.apply")}
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {!isLoading && packs.length === 0 && !loadError ? (
          <p className="rounded-lg border border-mid-gray/15 px-3 py-6 text-center text-sm text-mid-gray">
            {t("themePacks.empty")}
          </p>
        ) : null}

        <span className="sr-only" aria-live="polite">
          {busyAction?.kind === "apply"
            ? t("themePacks.status.applying")
            : activePackId
              ? t("themePacks.status.active", { id: activePackId })
              : ""}
        </span>
      </div>
    </SettingContainer>
  );
};
