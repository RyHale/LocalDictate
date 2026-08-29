import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import {
  AudioLines,
  ChevronDown,
  Globe,
  Languages,
  Link2,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { commands } from "@/bindings";
import type { ModelCardStatus } from "@/components/onboarding";
import { ModelCard } from "@/components/onboarding";
import { Button, Input } from "@/components/ui";
import { useModelStore } from "@/stores/modelStore";
import {
  getLanguageLabel,
  MODEL_CAPABILITY_LANGUAGES,
  supportsLanguageCode,
} from "@/lib/constants/languages.ts";
import type { ModelInfo } from "@/bindings";

// check if model supports a language based on its supported_languages list
const modelSupportsLanguage = (model: ModelInfo, langCode: string): boolean => {
  return supportsLanguageCode(model.supported_languages, langCode);
};

// Legacy models are the blob (Url-sourced) .bin/ONNX downloads, superseded by
// the catalog GGUFs. They stay runnable when already on disk, but we no longer
// advertise the download.
const isLegacyModel = (model: ModelInfo): boolean =>
  !model.is_custom && typeof model.source === "object" && "Url" in model.source;

export const ModelsSettings: React.FC = () => {
  const { t } = useTranslation();
  const [switchingModelId, setSwitchingModelId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStreaming, setFilterStreaming] = useState(false);
  const [filterTranslation, setFilterTranslation] = useState(false);
  const [languageFilter, setLanguageFilter] = useState("all");
  const [languageDropdownOpen, setLanguageDropdownOpen] = useState(false);
  const [languageSearch, setLanguageSearch] = useState("");
  const [showLinkField, setShowLinkField] = useState(false);
  const [modelUrl, setModelUrl] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [sourceOverrides, setSourceOverrides] = useState<
    Partial<Record<string, string>>
  >({});
  const languageDropdownRef = useRef<HTMLDivElement>(null);
  const languageSearchInputRef = useRef<HTMLInputElement>(null);
  const {
    models,
    currentModel,
    downloadingModels,
    downloadProgress,
    downloadStats,
    verifyingModels,
    extractingModels,
    loading,
    isRescanning,
    downloadModel,
    cancelDownload,
    selectModel,
    deleteModel,
    rescanLocalModels,
    loadModels,
  } = useModelStore();

  const loadSourceOverrides = useCallback(async () => {
    const result = await commands.getModelSourceOverrides();
    if (result.status === "error") throw new Error(result.error);
    setSourceOverrides(result.data);
  }, []);

  useEffect(() => {
    void loadSourceOverrides().catch((error) => {
      console.error("Failed to load model source overrides:", error);
    });
  }, [loadSourceOverrides]);

  // click outside handler for language dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        languageDropdownRef.current &&
        !languageDropdownRef.current.contains(event.target as Node)
      ) {
        setLanguageDropdownOpen(false);
        setLanguageSearch("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // focus search input when dropdown opens
  useEffect(() => {
    if (languageDropdownOpen && languageSearchInputRef.current) {
      languageSearchInputRef.current.focus();
    }
  }, [languageDropdownOpen]);

  // filtered languages for dropdown (exclude "auto")
  const filteredLanguages = useMemo(() => {
    return MODEL_CAPABILITY_LANGUAGES.filter((lang) =>
      lang.label.toLowerCase().includes(languageSearch.toLowerCase()),
    );
  }, [languageSearch]);

  // Get selected language label
  const selectedLanguageLabel = useMemo(() => {
    if (languageFilter === "all") {
      return t("settings.models.filters.allLanguages");
    }
    return getLanguageLabel(languageFilter) || "";
  }, [languageFilter, t]);

  const getModelStatus = (modelId: string): ModelCardStatus => {
    if (modelId in extractingModels) {
      return "extracting";
    }
    if (modelId in verifyingModels) {
      return "verifying";
    }
    if (modelId in downloadingModels) {
      return "downloading";
    }
    if (switchingModelId === modelId) {
      return "switching";
    }
    if (modelId === currentModel) {
      return "active";
    }
    const model = models.find((m: ModelInfo) => m.id === modelId);
    if (model?.is_downloaded) {
      return "available";
    }
    return "downloadable";
  };

  const getDownloadProgress = (modelId: string): number | undefined => {
    const progress = downloadProgress[modelId];
    return progress?.percentage;
  };

  const getDownloadSpeed = (modelId: string): number | undefined => {
    const stats = downloadStats[modelId];
    return stats?.speed;
  };

  const handleModelSelect = async (modelId: string) => {
    setSwitchingModelId(modelId);
    try {
      await selectModel(modelId);
    } finally {
      setSwitchingModelId(null);
    }
  };

  const handleModelDownload = async (modelId: string) => {
    await downloadModel(modelId);
  };

  const handleModelDelete = async (modelId: string) => {
    const model = models.find((m: ModelInfo) => m.id === modelId);
    const modelName = model?.name || modelId;
    const isActive = modelId === currentModel;

    const confirmed = await ask(
      isActive
        ? t("settings.models.deleteActiveConfirm", { modelName })
        : t("settings.models.deleteConfirm", { modelName }),
      {
        title: t("settings.models.deleteTitle"),
        kind: "warning",
      },
    );

    if (confirmed) {
      try {
        await deleteModel(modelId);
      } catch (err) {
        console.error(`Failed to delete model ${modelId}:`, err);
      }
    }
  };

  const handleModelCancel = async (modelId: string) => {
    try {
      await cancelDownload(modelId);
    } catch (err) {
      console.error(`Failed to cancel download for ${modelId}:`, err);
    }
  };

  const handleImportModel = async () => {
    const selected = await open({
      multiple: false,
      directory: false,
      title: t("settings.models.custom.importDialogTitle"),
      filters: [
        {
          name: t("settings.models.custom.supportedFiles"),
          extensions: ["gguf", "bin"],
        },
      ],
    });
    if (typeof selected !== "string") return;

    setIsImporting(true);
    try {
      const result = await commands.importTranscriptionModel(selected);
      if (result.status === "error") throw new Error(result.error);
      await loadModels();
      toast.success(t("settings.models.custom.importSuccess"), {
        description: result.data.name,
      });
    } catch (error) {
      toast.error(t("settings.models.custom.importError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleLinkModel = async () => {
    const url = modelUrl.trim();
    if (!url) return;

    setIsLinking(true);
    try {
      const result = await commands.linkTranscriptionModel(url);
      if (result.status === "error") throw new Error(result.error);
      await loadModels();
      setModelUrl("");
      setShowLinkField(false);
      toast.success(t("settings.models.custom.linkSuccess"), {
        description: result.data.name,
      });
    } catch (error) {
      toast.error(t("settings.models.custom.linkError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsLinking(false);
    }
  };

  const handleChangeModelSource = async (modelId: string, url: string) => {
    try {
      const result = await commands.setModelSourceOverride(modelId, url);
      if (result.status === "error") throw new Error(result.error);
      await loadSourceOverrides();
      toast.success(t("settings.models.sources.changeSuccess"));
    } catch (error) {
      toast.error(t("settings.models.sources.changeError"), {
        description: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  const handleResetModelSource = async (modelId: string) => {
    try {
      const result = await commands.clearModelSourceOverride(modelId);
      if (result.status === "error") throw new Error(result.error);
      await loadSourceOverrides();
      toast.success(t("settings.models.sources.restoreSuccess"));
    } catch (error) {
      toast.error(t("settings.models.sources.restoreError"), {
        description: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  // Filter models by search query (name + description), language filter, and toggles
  const filteredModels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return models.filter((model: ModelInfo) => {
      // Hide deprecated legacy (.bin/ONNX) downloads unless already on disk.
      if (isLegacyModel(model) && !model.is_downloaded) return false;
      if (languageFilter !== "all") {
        if (!modelSupportsLanguage(model, languageFilter)) return false;
      }
      if (filterStreaming && !model.supports_streaming) return false;
      if (filterTranslation && !model.supports_translation) return false;

      if (q) {
        const haystack = `${model.name} ${model.description}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [models, languageFilter, filterStreaming, filterTranslation, searchQuery]);

  // Split filtered models into downloaded (including custom) and available sections
  const { downloadedModels, availableModels } = useMemo(() => {
    const downloaded: ModelInfo[] = [];
    const available: ModelInfo[] = [];

    for (const model of filteredModels) {
      if (
        model.is_custom ||
        model.is_downloaded ||
        model.id in downloadingModels ||
        model.id in extractingModels
      ) {
        downloaded.push(model);
      } else {
        available.push(model);
      }
    }

    // Sort: active model first, then non-custom, then custom at the bottom
    downloaded.sort((a, b) => {
      if (a.id === currentModel) return -1;
      if (b.id === currentModel) return 1;
      if (a.is_custom !== b.is_custom) return a.is_custom ? 1 : -1;
      return 0;
    });

    return {
      downloadedModels: downloaded,
      availableModels: available,
    };
  }, [filteredModels, downloadingModels, extractingModels, currentModel]);

  if (loading) {
    return (
      <div className="max-w-3xl w-full mx-auto">
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-logo-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl w-full mx-auto space-y-4">
      <div className="mb-4">
        <h1 className="text-xl font-semibold mb-2">
          {t("settings.models.title")}
        </h1>
        <p className="text-sm text-text/60">
          {t("settings.models.description")}
        </p>
      </div>

      <section className="rounded-xl bg-background-raised px-4 py-3.5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-logo-primary" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">
              {t("settings.models.sources.title")}
            </h2>
            <p className="mt-1 max-w-[65ch] text-xs leading-5 text-text/60">
              {t("settings.models.sources.description")}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <button
                type="button"
                onClick={() =>
                  void openUrl("https://huggingface.co/handy-computer")
                }
                className="text-text/70 underline decoration-text/25 underline-offset-2 hover:text-logo-primary"
              >
                {t("settings.models.sources.catalog")}
              </button>
              <button
                type="button"
                onClick={() => void openUrl("https://blob.handy.computer")}
                className="text-text/70 underline decoration-text/25 underline-offset-2 hover:text-logo-primary"
              >
                {t("settings.models.sources.mirror")}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Search bar — filter the catalog by name or description */}
      <section className="rounded-xl bg-background-raised p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">
              {t("settings.models.custom.title")}
            </h2>
            <p className="mt-1 max-w-[62ch] text-xs leading-5 text-text/55">
              {t("settings.models.custom.description")}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="secondary"
              size="md"
              disabled={isImporting || isLinking}
              onClick={() => void handleImportModel()}
              className="flex items-center gap-2"
            >
              <Upload className="h-4 w-4" />
              {isImporting
                ? t("settings.models.custom.importing")
                : t("settings.models.custom.import")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="md"
              disabled={isImporting || isLinking}
              onClick={() => setShowLinkField((visible) => !visible)}
              className="flex items-center gap-2"
            >
              <Link2 className="h-4 w-4" />
              {t("settings.models.custom.link")}
            </Button>
          </div>
        </div>

        {showLinkField && (
          <div className="mt-4 flex gap-2">
            <Input
              type="url"
              value={modelUrl}
              onChange={(event) => setModelUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleLinkModel();
                if (event.key === "Escape") setShowLinkField(false);
              }}
              placeholder={t("settings.models.custom.urlPlaceholder")}
              aria-label={t("settings.models.custom.urlLabel")}
              disabled={isLinking}
              className="min-w-0 flex-1 font-normal"
            />
            <Button
              type="button"
              disabled={!modelUrl.trim() || isLinking}
              onClick={() => void handleLinkModel()}
            >
              {isLinking
                ? t("settings.models.custom.linking")
                : t("settings.models.custom.add")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={isLinking}
              onClick={() => {
                setShowLinkField(false);
                setModelUrl("");
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        )}
      </section>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text/40 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("settings.models.searchPlaceholder")}
          className="w-full pl-9 pr-3 py-2 text-sm bg-mid-gray/10 border border-mid-gray/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-logo-primary placeholder:text-text/40"
        />
      </div>

      <div className="space-y-6">
        {/* Downloaded Models Section — header always visible so filter stays accessible */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-text/60">
              {t("settings.models.yourModels")}
            </h2>
            <div className="flex items-center gap-2">
              {/* Rescan local sources for models added outside Handy */}
              <button
                type="button"
                onClick={() => rescanLocalModels()}
                disabled={isRescanning}
                title={t("settings.models.rescan.tooltip")}
                aria-label={t("settings.models.rescan.tooltip")}
                className="flex items-center justify-center w-8 h-8 text-sm font-medium rounded-lg bg-mid-gray/10 text-text/60 hover:bg-mid-gray/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isRescanning ? "animate-spin" : ""}`}
                />
              </button>

              {/* Vertical divider separating action from filters */}
              <div className="h-4 w-px bg-mid-gray/30 mx-0.5" />
              <button
                type="button"
                onClick={() => setFilterStreaming((enabled) => !enabled)}
                title={t("settings.models.filters.streaming")}
                aria-label={t("settings.models.filters.streaming")}
                aria-pressed={filterStreaming}
                className={`flex items-center justify-center w-8 h-8 text-sm font-medium rounded-lg transition-colors ${
                  filterStreaming
                    ? "bg-logo-primary/20 text-logo-primary hover:bg-logo-primary/30"
                    : "bg-mid-gray/10 text-text/60 hover:bg-mid-gray/20"
                }`}
              >
                <AudioLines className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setFilterTranslation((enabled) => !enabled)}
                title={t("settings.models.filters.translation")}
                aria-label={t("settings.models.filters.translation")}
                aria-pressed={filterTranslation}
                className={`flex items-center justify-center w-8 h-8 text-sm font-medium rounded-lg transition-colors ${
                  filterTranslation
                    ? "bg-logo-primary/20 text-logo-primary hover:bg-logo-primary/30"
                    : "bg-mid-gray/10 text-text/60 hover:bg-mid-gray/20"
                }`}
              >
                <Languages className="w-3.5 h-3.5" />
              </button>
              {/* Language filter dropdown */}
              <div className="relative" ref={languageDropdownRef}>
                <button
                  type="button"
                  onClick={() => setLanguageDropdownOpen(!languageDropdownOpen)}
                  className={`flex items-center gap-1.5 h-8 px-3 text-sm font-medium rounded-lg transition-colors ${
                    languageFilter !== "all"
                      ? "bg-logo-primary/20 text-logo-primary"
                      : "bg-mid-gray/10 text-text/60 hover:bg-mid-gray/20"
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span className="max-w-[120px] truncate">
                    {selectedLanguageLabel}
                  </span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform ${
                      languageDropdownOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {languageDropdownOpen && (
                  <div className="absolute top-full right-0 mt-1 w-56 bg-background border border-mid-gray/80 rounded-lg shadow-lg z-50 overflow-hidden">
                    <div className="p-2 border-b border-mid-gray/40">
                      <input
                        ref={languageSearchInputRef}
                        type="text"
                        value={languageSearch}
                        onChange={(e) => setLanguageSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            filteredLanguages.length > 0
                          ) {
                            setLanguageFilter(filteredLanguages[0].value);
                            setLanguageDropdownOpen(false);
                            setLanguageSearch("");
                          } else if (e.key === "Escape") {
                            setLanguageDropdownOpen(false);
                            setLanguageSearch("");
                          }
                        }}
                        placeholder={t(
                          "settings.general.language.searchPlaceholder",
                        )}
                        className="w-full px-2 py-1 text-sm bg-mid-gray/10 border border-mid-gray/40 rounded-md focus:outline-none focus:ring-1 focus:ring-logo-primary"
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      <button
                        type="button"
                        onClick={() => {
                          setLanguageFilter("all");
                          setLanguageDropdownOpen(false);
                          setLanguageSearch("");
                        }}
                        className={`w-full px-3 py-1.5 text-sm text-left transition-colors ${
                          languageFilter === "all"
                            ? "bg-logo-primary/20 text-logo-primary font-semibold"
                            : "hover:bg-mid-gray/10"
                        }`}
                      >
                        {t("settings.models.filters.allLanguages")}
                      </button>
                      {filteredLanguages.map((lang) => (
                        <button
                          key={lang.value}
                          type="button"
                          onClick={() => {
                            setLanguageFilter(lang.value);
                            setLanguageDropdownOpen(false);
                            setLanguageSearch("");
                          }}
                          className={`w-full px-3 py-1.5 text-sm text-left transition-colors ${
                            languageFilter === lang.value
                              ? "bg-logo-primary/20 text-logo-primary font-semibold"
                              : "hover:bg-mid-gray/10"
                          }`}
                        >
                          {lang.label}
                        </button>
                      ))}
                      {filteredLanguages.length === 0 && (
                        <div className="px-3 py-2 text-sm text-text/50 text-center">
                          {t("settings.general.language.noResults")}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          {downloadedModels.map((model: ModelInfo) => (
            <ModelCard
              key={model.id}
              model={model}
              status={getModelStatus(model.id)}
              onSelect={handleModelSelect}
              onDownload={handleModelDownload}
              onDelete={handleModelDelete}
              onCancel={handleModelCancel}
              downloadProgress={getDownloadProgress(model.id)}
              downloadSpeed={getDownloadSpeed(model.id)}
              showRecommended={false}
              sourceOverride={sourceOverrides[model.id]}
              onChangeSource={handleChangeModelSource}
              onResetSource={handleResetModelSource}
            />
          ))}
        </div>

        {/* Available Models Section */}
        {availableModels.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-text/60">
              {t("settings.models.availableModels")}
            </h2>
            {availableModels.map((model: ModelInfo) => (
              <ModelCard
                key={model.id}
                model={model}
                status={getModelStatus(model.id)}
                onSelect={handleModelSelect}
                onDownload={handleModelDownload}
                onDelete={handleModelDelete}
                onCancel={handleModelCancel}
                downloadProgress={getDownloadProgress(model.id)}
                downloadSpeed={getDownloadSpeed(model.id)}
                showRecommended={true}
                sourceOverride={sourceOverrides[model.id]}
                onChangeSource={handleChangeModelSource}
                onResetSource={handleResetModelSource}
              />
            ))}
          </div>
        )}
        {filteredModels.length === 0 && (
          <div className="text-center py-8 text-text/50">
            {t("settings.models.noModelsMatch")}
          </div>
        )}
      </div>
    </div>
  );
};
