import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AudioLines,
  Check,
  Download,
  ExternalLink,
  Globe,
  HardDrive,
  Languages,
  Loader2,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type { ModelInfo } from "@/bindings";
import { formatModelSize } from "../../lib/utils/format";
import {
  getTranslatedModelDescription,
  getTranslatedModelName,
} from "../../lib/utils/modelTranslation";
import {
  getLanguageLabel,
  getUniqueCapabilityLanguages,
} from "../../lib/constants/languages";
import Badge from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { useSettingsStore } from "@/stores/settingsStore";

// Get display text for model's language support
const getLanguageDisplayText = (
  supportedLanguages: string[],
  t: (key: string, options?: Record<string, unknown>) => string,
): string => {
  const capabilityLanguages = getUniqueCapabilityLanguages(supportedLanguages);
  if (capabilityLanguages.length === 1) {
    const langCode = capabilityLanguages[0];
    const langName = getLanguageLabel(langCode) || langCode;
    return t("modelSelector.capabilities.languageOnly", { language: langName });
  }
  return t("modelSelector.capabilities.languageCount", {
    total: capabilityLanguages.length,
  });
};

// Legacy = a blob (Url-sourced) .bin/ONNX model, kept runnable but no longer the
// advertised download (catalog GGUFs supersede it).
export const isLegacySource = (model: ModelInfo): boolean =>
  !model.is_custom && typeof model.source === "object" && "Url" in model.source;

const getModelSourceUrl = (model: ModelInfo): string | null => {
  if (typeof model.source !== "object") return null;
  if ("Url" in model.source) return model.source.Url.url;
  if ("HuggingFace" in model.source) {
    const { repo_id, revision } = model.source.HuggingFace;
    return `https://huggingface.co/${repo_id}/blob/${revision}/${encodeURIComponent(model.filename)}`;
  }
  return null;
};

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

// Extract a GGUF quantization label from a filename, if present (e.g. "Q8_0").
const getQuantLabel = (filename: string): string | null => {
  const match = filename.match(
    /[._-](IQ\d+_\w+|Q\d+(?:_\w+)?|F16|BF16|F32)\.gguf$/i,
  );
  return match ? match[1].toUpperCase() : null;
};

export type ModelCardStatus =
  | "downloadable"
  | "downloading"
  | "verifying"
  | "extracting"
  | "switching"
  | "active"
  | "available";

interface ModelCardProps {
  model: ModelInfo;
  variant?: "default" | "featured";
  status?: ModelCardStatus;
  disabled?: boolean;
  className?: string;
  onSelect: (modelId: string) => void;
  onDownload?: (modelId: string) => void;
  onDelete?: (modelId: string) => void;
  onCancel?: (modelId: string) => void;
  downloadProgress?: number;
  downloadSpeed?: number; // MB/s
  showRecommended?: boolean;
  sourceOverride?: string;
  onChangeSource?: (modelId: string, url: string) => Promise<void>;
  onResetSource?: (modelId: string) => Promise<void>;
}

const ModelCard: React.FC<ModelCardProps> = ({
  model,
  variant = "default",
  status = "downloadable",
  disabled = false,
  className = "",
  onSelect,
  onDownload,
  onDelete,
  onCancel,
  downloadProgress,
  downloadSpeed,
  showRecommended = true,
  sourceOverride,
  onChangeSource,
  onResetSource,
}) => {
  const { t } = useTranslation();
  const defaultSourceUrl = getModelSourceUrl(model);
  const effectiveSourceUrl = sourceOverride || defaultSourceUrl;
  const [isEditingSource, setIsEditingSource] = useState(false);
  const [sourceDraft, setSourceDraft] = useState(effectiveSourceUrl ?? "");
  const [isSavingSource, setIsSavingSource] = useState(false);
  const debugMode = useSettingsStore(
    (state) => state.settings?.debug_mode ?? false,
  );
  const isFeatured = variant === "featured";
  // The active model is already loaded — re-selecting it just reloads it for no
  // gain, so it is deliberately not clickable.
  const isClickable = status === "available" || status === "downloadable";

  // Get translated model name and description
  const displayName = getTranslatedModelName(model, t);
  const displayDescription = getTranslatedModelDescription(model, t);
  const showModelSize =
    status === "downloadable" || status === "available" || status === "active";
  const formattedModelSize = formatModelSize(Number(model.size_mb));
  const quantLabel = getQuantLabel(model.filename);
  const capabilityLanguages = getUniqueCapabilityLanguages(
    model.supported_languages,
  );
  useEffect(() => {
    if (!isEditingSource) {
      setSourceDraft(effectiveSourceUrl ?? "");
    }
  }, [effectiveSourceUrl, isEditingSource]);

  const sourceLabel = (() => {
    if (sourceOverride) {
      return t("modelSelector.sourceDetails.customUrl", {
        url: sourceOverride,
      });
    }
    if (typeof model.source === "object" && "HuggingFace" in model.source) {
      return t("modelSelector.sourceDetails.huggingFace", {
        repository: model.source.HuggingFace.repo_id,
        revision: model.source.HuggingFace.revision,
      });
    }
    if (typeof model.source === "object" && "Url" in model.source) {
      return t("modelSelector.sourceDetails.directUrl", {
        url: model.source.Url.url,
      });
    }
    return t("modelSelector.sourceDetails.localFile", {
      filename: model.filename,
    });
  })();

  const canChangeSource =
    Boolean(onChangeSource) &&
    model.source !== "Local" &&
    !["downloading", "verifying", "extracting"].includes(status);

  const baseClasses =
    "flex flex-col rounded-xl bg-background-raised px-4 py-3.5 gap-2.5 text-left transition-colors duration-150";

  const getVariantClasses = () => {
    if (status === "active") {
      return "border border-logo-primary/40 bg-logo-primary/8 ring-1 ring-logo-primary/10";
    }
    if (isFeatured) {
      return "border border-logo-primary/20 bg-logo-primary/5";
    }
    return "border border-transparent";
  };

  const getInteractiveClasses = () => {
    if (!isClickable) return "";
    if (disabled) return "opacity-50 cursor-not-allowed";
    return "cursor-pointer hover:border-logo-primary/25 hover:bg-logo-primary/5 active:bg-logo-primary/8 group";
  };

  const handleClick = () => {
    if (!isClickable || disabled) return;
    if (status === "downloadable" && onDownload) {
      onDownload(model.id);
    } else {
      onSelect(model.id);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.(model.id);
  };

  const handleOpenSource = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (effectiveSourceUrl) void openUrl(effectiveSourceUrl);
  };

  const handleSaveSource = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onChangeSource || !isHttpUrl(sourceDraft.trim())) return;
    setIsSavingSource(true);
    try {
      await onChangeSource(model.id, sourceDraft.trim());
      setIsEditingSource(false);
    } catch {
      // The settings page reports the actionable error and keeps this editor open.
    } finally {
      setIsSavingSource(false);
    }
  };

  const handleResetSource = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onResetSource) return;
    setIsSavingSource(true);
    try {
      await onResetSource(model.id);
      setIsEditingSource(false);
    } catch {
      // The settings page reports the actionable error and keeps this editor open.
    } finally {
      setIsSavingSource(false);
    }
  };

  return (
    <div
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" && isClickable) handleClick();
      }}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      className={[
        baseClasses,
        getVariantClasses(),
        getInteractiveClasses(),
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Top section: name/description + score bars */}
      <div className="flex justify-between items-center w-full">
        <div className="flex flex-col items-start flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h3
              className={`text-base font-semibold text-text ${isClickable ? "group-hover:text-logo-primary" : ""} transition-colors`}
            >
              {displayName}
            </h3>
            {showRecommended && model.is_recommended && (
              <Badge variant="primary">{t("onboarding.recommended")}</Badge>
            )}
            {status === "active" && (
              <Badge variant="primary">
                <Check className="w-3 h-3 mr-1" />
                {t("modelSelector.active")}
              </Badge>
            )}
            {model.is_custom && (
              <Badge variant="secondary">{t("modelSelector.custom")}</Badge>
            )}
            {isLegacySource(model) && (
              <Badge variant="secondary">{t("modelSelector.legacy")}</Badge>
            )}
            {status === "switching" && (
              <Badge variant="secondary">
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                {t("modelSelector.switching")}
              </Badge>
            )}
          </div>
          <p className="text-text/60 text-sm leading-relaxed">
            {displayDescription}
          </p>
        </div>
        {(model.accuracy_score > 0 || model.speed_score > 0) && (
          <div className="hidden sm:flex items-center ms-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <p className="text-xs text-text/60 w-24 text-end">
                  {t("onboarding.modelCard.accuracy")}
                </p>
                <div className="w-16 h-1.5 bg-mid-gray/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-logo-primary rounded-full"
                    style={{ width: `${model.accuracy_score * 100}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <p className="text-xs text-text/60 w-24 text-end">
                  {t("onboarding.modelCard.speed")}
                </p>
                <div className="w-16 h-1.5 bg-mid-gray/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-logo-primary rounded-full"
                    style={{ width: `${model.speed_score * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-mid-gray/20 pt-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="shrink-0 font-medium text-text/45">
            {t("modelSelector.sourceDetails.label")}
          </span>
          {effectiveSourceUrl ? (
            <button
              type="button"
              onClick={handleOpenSource}
              title={effectiveSourceUrl}
              className="flex min-w-0 items-center gap-1 text-left text-text/70 underline decoration-text/25 underline-offset-2 hover:text-logo-primary"
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              <span className="break-all">{sourceLabel}</span>
            </button>
          ) : (
            <span className="break-all text-text/60">{sourceLabel}</span>
          )}
          {sourceOverride && (
            <Badge variant="secondary">
              {t("modelSelector.sourceDetails.overridden")}
            </Badge>
          )}
          {canChangeSource && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setIsEditingSource((editing) => !editing);
              }}
              className="ml-auto flex shrink-0 items-center gap-1 text-text/60"
            >
              <Pencil className="h-3.5 w-3.5" />
              {t("modelSelector.sourceDetails.change")}
            </Button>
          )}
        </div>

        {isEditingSource && (
          <div
            className="mt-2 space-y-2"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <label
              htmlFor={`source-${model.id}`}
              className="block text-xs font-medium text-text/70"
            >
              {t("modelSelector.sourceDetails.urlLabel")}
            </label>
            <Input
              id={`source-${model.id}`}
              type="url"
              value={sourceDraft}
              onChange={(event) => setSourceDraft(event.target.value)}
              placeholder={t("modelSelector.sourceDetails.urlPlaceholder")}
              disabled={isSavingSource}
              className="w-full font-normal"
            />
            <p className="text-xs leading-5 text-text/50">
              {t("modelSelector.sourceDetails.help")}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={(event) => void handleSaveSource(event)}
                disabled={
                  isSavingSource ||
                  !isHttpUrl(sourceDraft.trim()) ||
                  sourceDraft.trim() === effectiveSourceUrl
                }
              >
                {isSavingSource
                  ? t("modelSelector.sourceDetails.saving")
                  : t("modelSelector.sourceDetails.save")}
              </Button>
              {sourceOverride && onResetSource && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={(event) => void handleResetSource(event)}
                  disabled={isSavingSource}
                  className="flex items-center gap-1"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t("modelSelector.sourceDetails.restore")}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setSourceDraft(effectiveSourceUrl ?? "");
                  setIsEditingSource(false);
                }}
                disabled={isSavingSource}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom row: tags + action buttons (full width) */}
      <div className="mt-1 flex min-h-6 w-full flex-wrap items-center gap-x-3 gap-y-1">
        {capabilityLanguages.length > 0 && (
          <div
            className="flex items-center gap-1 text-xs text-text/50"
            title={
              capabilityLanguages.length === 1
                ? t("modelSelector.capabilities.singleLanguage")
                : t("modelSelector.capabilities.languageSelection")
            }
          >
            <Globe className="w-3.5 h-3.5" />
            <span>{getLanguageDisplayText(model.supported_languages, t)}</span>
          </div>
        )}
        {model.supports_translation && (
          <div
            className="flex items-center gap-1 text-xs text-text/50"
            title={t("modelSelector.capabilities.translation")}
          >
            <Languages className="w-3.5 h-3.5" />
            <span>{t("modelSelector.capabilities.translate")}</span>
          </div>
        )}
        {model.supports_streaming && (
          <div
            className="flex items-center gap-1 text-xs text-text/50"
            title={t("modelSelector.capabilities.streaming")}
          >
            <AudioLines className="w-3.5 h-3.5" />
            <span>{t("modelSelector.streaming")}</span>
          </div>
        )}
        {showModelSize && (
          <span className="flex items-center gap-1.5 ms-auto text-xs text-text/50">
            {status === "downloadable" ? (
              <Download className="w-3.5 h-3.5" />
            ) : (
              <HardDrive className="w-3.5 h-3.5" />
            )}
            <span>{formattedModelSize}</span>
            {debugMode && quantLabel && (
              <span className="text-text/40">{quantLabel}</span>
            )}
          </span>
        )}
        {onDelete &&
          (status === "available" ||
            status === "active" ||
            (model.is_custom && status === "downloadable")) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              title={t("modelSelector.deleteModel", { modelName: displayName })}
              className="flex items-center gap-1.5 text-logo-primary/85 hover:text-logo-primary hover:bg-logo-primary/10"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{t("common.delete")}</span>
            </Button>
          )}
      </div>

      {/* Download/extract progress */}
      {status === "downloading" && downloadProgress !== undefined && (
        <div className="w-full mt-3">
          <div className="w-full h-1.5 bg-mid-gray/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-logo-primary rounded-full transition-all duration-300"
              style={{ width: `${downloadProgress}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs mt-1">
            <span className="text-text/50">
              {t("modelSelector.downloading", {
                percentage: Math.round(downloadProgress),
              })}
            </span>
            <div className="flex items-center gap-2">
              {downloadSpeed !== undefined && downloadSpeed > 0 && (
                <span className="tabular-nums text-text/50">
                  {t("modelSelector.downloadSpeed", {
                    speed: downloadSpeed.toFixed(1),
                  })}
                </span>
              )}
              {onCancel && (
                <Button
                  variant="danger-ghost"
                  size="sm"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onCancel(model.id);
                  }}
                  aria-label={t("modelSelector.cancelDownload")}
                >
                  {t("modelSelector.cancel")}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
      {status === "verifying" && (
        <div className="w-full mt-3">
          <div className="w-full h-1.5 bg-mid-gray/20 rounded-full overflow-hidden">
            <div className="h-full bg-logo-primary rounded-full animate-pulse w-full" />
          </div>
          <p className="text-xs text-text/50 mt-1">
            {t("modelSelector.verifyingGeneric")}
          </p>
        </div>
      )}
      {status === "extracting" && (
        <div className="w-full mt-3">
          <div className="w-full h-1.5 bg-mid-gray/20 rounded-full overflow-hidden">
            <div className="h-full bg-logo-primary rounded-full animate-pulse w-full" />
          </div>
          <p className="text-xs text-text/50 mt-1">
            {t("modelSelector.extractingGeneric")}
          </p>
        </div>
      )}
    </div>
  );
};

export default ModelCard;
