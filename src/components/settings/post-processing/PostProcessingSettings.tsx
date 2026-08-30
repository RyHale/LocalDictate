import React, { useCallback, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { ask } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Check,
  Copy,
  ExternalLink,
  Plus,
  RefreshCcw,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  commands,
  type CodexCliStatus,
  type CustomCliStatus,
} from "@/bindings";

import { Alert } from "../../ui/Alert";
import { SettingContainer, SettingsGroup, Textarea } from "@/components/ui";
import { Button } from "../../ui/Button";
import { ResetButton } from "../../ui/ResetButton";
import { Input } from "../../ui/Input";

import { ProviderSelect } from "../PostProcessingSettingsApi/ProviderSelect";
import { BaseUrlField } from "../PostProcessingSettingsApi/BaseUrlField";
import { ApiKeyField } from "../PostProcessingSettingsApi/ApiKeyField";
import { ModelSelect } from "../PostProcessingSettingsApi/ModelSelect";
import { usePostProcessProviderState } from "../PostProcessingSettingsApi/usePostProcessProviderState";
import { ShortcutInput } from "../ShortcutInput";
import { PostProcessingToggle } from "../PostProcessingToggle";
import { useSettings } from "../../../hooks/useSettings";

const CodexCliStatusPanel: React.FC = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<CodexCliStatus | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const refreshStatus = useCallback(async () => {
    setIsChecking(true);
    try {
      const nextStatus = await commands.getCodexCliStatus();
      setStatus(nextStatus);
    } catch {
      setStatus({ state: "error", version: null });
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const message = (() => {
    if (!status || isChecking) {
      return t("settings.postProcessing.api.codex.checking");
    }

    switch (status.state) {
      case "ready":
        return t("settings.postProcessing.api.codex.ready");
      case "not_installed":
        return t("settings.postProcessing.api.codex.notInstalled");
      case "not_authenticated":
        return t("settings.postProcessing.api.codex.notAuthenticated");
      case "non_chatgpt_authentication":
        return t("settings.postProcessing.api.codex.nonChatgptAuthentication");
      default:
        return t("settings.postProcessing.api.codex.error");
    }
  })();

  const variant =
    status?.state === "ready"
      ? "success"
      : status?.state === "error"
        ? "error"
        : "warning";

  return (
    <div className="space-y-3 px-4 py-3">
      <Alert variant={variant}>
        <span>
          {message}
          {status?.version ? (
            <span className="mt-1 block opacity-80">{status.version}</span>
          ) : null}
        </span>
      </Alert>
      <Alert variant="info">
        {t("settings.postProcessing.api.codex.privacy")}
      </Alert>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={isChecking}
          onClick={() => void refreshStatus()}
        >
          {t("settings.postProcessing.api.codex.refresh")}
        </Button>
      </div>
    </div>
  );
};

const CustomCliStatusPanel: React.FC<{ executable: string }> = ({
  executable,
}) => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<CustomCliStatus | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const refreshStatus = useCallback(async () => {
    setIsChecking(true);
    try {
      const nextStatus = await commands.getCustomCliStatus();
      setStatus(nextStatus);
    } catch {
      setStatus({ state: "error", version: null });
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [executable, refreshStatus]);

  const message = (() => {
    if (!status || isChecking) {
      return t("settings.postProcessing.api.customCli.checking");
    }
    switch (status.state) {
      case "ready":
        return t("settings.postProcessing.api.customCli.ready");
      case "not_configured":
        return t("settings.postProcessing.api.customCli.notConfigured");
      case "not_installed":
        return t("settings.postProcessing.api.customCli.notInstalled");
      default:
        return t("settings.postProcessing.api.customCli.error");
    }
  })();

  const variant = status?.state === "ready" ? "success" : "warning";

  return (
    <div className="space-y-3 px-4 py-3">
      <Alert variant={variant}>
        <span>
          {message}
          {status?.version ? (
            <span className="mt-1 block opacity-80">{status.version}</span>
          ) : null}
        </span>
      </Alert>
      <Alert variant="info">
        {t("settings.postProcessing.api.customCli.contract")}
      </Alert>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={isChecking}
          onClick={() => void refreshStatus()}
        >
          {t("settings.postProcessing.api.customCli.refresh")}
        </Button>
      </div>
    </div>
  );
};

type CustomCliConfigurationProps = {
  executable: string;
  argumentsValue: string;
  onExecutableBlur: (value: string) => void;
  onArgumentsBlur: (value: string) => void;
  executableUpdating: boolean;
  argumentsUpdating: boolean;
};

const CustomCliConfiguration: React.FC<CustomCliConfigurationProps> = ({
  executable,
  argumentsValue,
  onExecutableBlur,
  onArgumentsBlur,
  executableUpdating,
  argumentsUpdating,
}) => {
  const { t } = useTranslation();
  const [localExecutable, setLocalExecutable] = useState(executable);
  const [localArguments, setLocalArguments] = useState(argumentsValue);

  useEffect(() => setLocalExecutable(executable), [executable]);
  useEffect(() => setLocalArguments(argumentsValue), [argumentsValue]);

  return (
    <>
      <SettingContainer
        title={t("settings.postProcessing.api.customCli.executable.title")}
        description={t(
          "settings.postProcessing.api.customCli.executable.description",
        )}
        descriptionMode="tooltip"
        layout="horizontal"
        grouped={true}
      >
        <Input
          type="text"
          value={localExecutable}
          onChange={(event) => setLocalExecutable(event.target.value)}
          onBlur={() => onExecutableBlur(localExecutable)}
          placeholder={t(
            "settings.postProcessing.api.customCli.executable.placeholder",
          )}
          variant="compact"
          disabled={executableUpdating}
          className="min-w-[380px]"
        />
      </SettingContainer>
      <SettingContainer
        title={t("settings.postProcessing.api.customCli.arguments.title")}
        description={t(
          "settings.postProcessing.api.customCli.arguments.description",
        )}
        descriptionMode="inline"
        layout="stacked"
        grouped={true}
      >
        <Textarea
          value={localArguments}
          onChange={(event) => setLocalArguments(event.target.value)}
          onBlur={() => onArgumentsBlur(localArguments)}
          placeholder={t(
            "settings.postProcessing.api.customCli.arguments.placeholder",
          )}
          disabled={argumentsUpdating}
          className="min-h-28 font-mono font-normal"
        />
      </SettingContainer>
    </>
  );
};

const PostProcessingSettingsApiComponent: React.FC = () => {
  const { t } = useTranslation();
  const state = usePostProcessProviderState();
  const providerSourceUrl = (() => {
    if (!state.selectedProvider) return null;
    if (state.isCodexProvider) return "https://developers.openai.com/codex/cli";
    if (state.isCliProvider) return null;
    if (state.isAppleProvider)
      return "https://developer.apple.com/apple-intelligence/";
    return state.selectedProvider.base_url.startsWith("http")
      ? state.selectedProvider.base_url
      : null;
  })();
  const providerSourceLabel = state.isCodexProvider
    ? t("settings.postProcessing.api.provider.codexConnection")
    : state.isCliProvider
      ? t("settings.postProcessing.api.provider.customCliConnection")
      : state.isAppleProvider
        ? t("settings.postProcessing.api.provider.appleConnection")
        : state.selectedProvider?.base_url;

  return (
    <>
      <SettingContainer
        title={t("settings.postProcessing.api.provider.title")}
        description={t("settings.postProcessing.api.provider.description")}
        descriptionMode="inline"
        layout="stacked"
        grouped={true}
      >
        <div className="space-y-2">
          <ProviderSelect
            options={state.providerOptions}
            value={state.selectedProviderId}
            onChange={state.handleProviderSelect}
          />
          {providerSourceLabel && (
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
              <span className="font-medium text-text/45">
                {t("settings.postProcessing.api.provider.source")}
              </span>
              {providerSourceUrl ? (
                <button
                  type="button"
                  onClick={() => void openUrl(providerSourceUrl)}
                  title={providerSourceUrl}
                  className="flex min-w-0 items-center gap-1 break-all text-left text-text/70 underline decoration-text/25 underline-offset-2 hover:text-logo-primary"
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  {providerSourceLabel}
                </button>
              ) : (
                <span className="break-all text-text/70">
                  {providerSourceLabel}
                </span>
              )}
            </div>
          )}
        </div>
      </SettingContainer>

      {state.isAppleProvider ? (
        state.appleIntelligenceUnavailable ? (
          <Alert variant="error" contained>
            {t("settings.postProcessing.api.appleIntelligence.unavailable")}
          </Alert>
        ) : null
      ) : state.isCodexProvider ? (
        <CodexCliStatusPanel />
      ) : state.isCliProvider ? (
        <>
          <CustomCliStatusPanel executable={state.cliExecutable} />
          <CustomCliConfiguration
            executable={state.cliExecutable}
            argumentsValue={state.cliArguments}
            onExecutableBlur={state.handleCliExecutableChange}
            onArgumentsBlur={state.handleCliArgumentsChange}
            executableUpdating={state.isCliExecutableUpdating}
            argumentsUpdating={state.isCliArgumentsUpdating}
          />
        </>
      ) : (
        <>
          {state.selectedProvider?.id === "custom" && (
            <SettingContainer
              title={t("settings.postProcessing.api.baseUrl.title")}
              description={t("settings.postProcessing.api.baseUrl.description")}
              descriptionMode="tooltip"
              layout="horizontal"
              grouped={true}
            >
              <div className="flex items-center gap-2">
                <BaseUrlField
                  value={state.baseUrl}
                  onBlur={state.handleBaseUrlChange}
                  placeholder={t(
                    "settings.postProcessing.api.baseUrl.placeholder",
                  )}
                  disabled={state.isBaseUrlUpdating}
                  className="min-w-[380px]"
                />
              </div>
            </SettingContainer>
          )}

          <SettingContainer
            title={t("settings.postProcessing.api.apiKey.title")}
            description={t("settings.postProcessing.api.apiKey.description")}
            descriptionMode="tooltip"
            layout="horizontal"
            grouped={true}
          >
            <div className="flex items-center gap-2">
              <ApiKeyField
                value={state.apiKey}
                onBlur={state.handleApiKeyChange}
                placeholder={t(
                  "settings.postProcessing.api.apiKey.placeholder",
                )}
                disabled={state.isApiKeyUpdating}
                className="min-w-[320px]"
              />
            </div>
          </SettingContainer>
        </>
      )}

      {!state.isAppleProvider && !state.isCliProvider && (
        <SettingContainer
          title={t("settings.postProcessing.api.model.title")}
          description={
            state.isCodexProvider
              ? t("settings.postProcessing.api.model.descriptionCodex")
              : state.isCustomProvider
                ? t("settings.postProcessing.api.model.descriptionCustom")
                : t("settings.postProcessing.api.model.descriptionDefault")
          }
          descriptionMode="tooltip"
          layout="stacked"
          grouped={true}
        >
          <div className="flex items-center gap-2">
            <ModelSelect
              value={state.model}
              options={state.modelOptions}
              disabled={state.isModelUpdating}
              isLoading={state.isFetchingModels}
              placeholder={
                state.isCodexProvider
                  ? t("settings.postProcessing.api.model.placeholderCodex")
                  : state.modelOptions.length > 0
                    ? t(
                        "settings.postProcessing.api.model.placeholderWithOptions",
                      )
                    : t(
                        "settings.postProcessing.api.model.placeholderNoOptions",
                      )
              }
              onSelect={state.handleModelSelect}
              onCreate={state.handleModelCreate}
              onBlur={() => {}}
              className="flex-1 min-w-[380px]"
            />
            <ResetButton
              onClick={state.handleRefreshModels}
              disabled={state.isFetchingModels}
              ariaLabel={t("settings.postProcessing.api.model.refreshModels")}
              className="flex h-10 w-10 items-center justify-center"
            >
              <RefreshCcw
                className={`h-4 w-4 ${state.isFetchingModels ? "animate-spin" : ""}`}
              />
            </ResetButton>
          </div>
        </SettingContainer>
      )}
    </>
  );
};

const PostProcessingSettingsPromptsComponent: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating, refreshSettings } =
    useSettings();
  const [isCreating, setIsCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftText, setDraftText] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const prompts = getSetting("post_process_prompts") || [];
  const selectedPromptId = getSetting("post_process_selected_prompt_id") || "";
  const selectedPrompt =
    prompts.find((prompt) => prompt.id === selectedPromptId) || null;

  useEffect(() => {
    if (isCreating) return;

    if (selectedPrompt) {
      setDraftName(selectedPrompt.name);
      setDraftText(selectedPrompt.prompt);
    } else {
      setDraftName("");
      setDraftText("");
    }
  }, [
    isCreating,
    selectedPromptId,
    selectedPrompt?.name,
    selectedPrompt?.prompt,
  ]);

  const handlePromptSelect = (promptId: string) => {
    void updateSetting("post_process_selected_prompt_id", promptId);
    setIsCreating(false);
  };

  const handleCreatePrompt = async () => {
    if (!draftName.trim() || !draftText.trim()) return;

    setIsSaving(true);
    try {
      const result = await commands.addPostProcessPrompt(
        draftName.trim(),
        draftText.trim(),
      );
      if (result.status === "error") throw new Error(result.error);
      await refreshSettings();
      try {
        await updateSetting("post_process_selected_prompt_id", result.data.id);
      } catch {
        // The settings store already reports persistence failures.
        return;
      }
      setIsCreating(false);
      toast.success(t("settings.postProcessing.prompts.created"));
    } catch (error) {
      console.error("Failed to create prompt:", error);
      toast.error(t("settings.postProcessing.prompts.createError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdatePrompt = async () => {
    if (!selectedPromptId || !draftName.trim() || !draftText.trim()) return;

    setIsSaving(true);
    try {
      const result = await commands.updatePostProcessPrompt(
        selectedPromptId,
        draftName.trim(),
        draftText.trim(),
      );
      if (result.status === "error") throw new Error(result.error);
      await refreshSettings();
      toast.success(t("settings.postProcessing.prompts.updated"));
    } catch (error) {
      console.error("Failed to update prompt:", error);
      toast.error(t("settings.postProcessing.prompts.updateError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeletePrompt = async (promptId: string) => {
    if (!promptId) return;

    const confirmed = await ask(
      t("settings.postProcessing.prompts.deleteConfirm", {
        name: selectedPrompt?.name ?? "",
      }),
      {
        title: t("settings.postProcessing.prompts.deleteTitle"),
        kind: "warning",
      },
    );
    if (!confirmed) return;

    setIsSaving(true);
    try {
      const result = await commands.deletePostProcessPrompt(promptId);
      if (result.status === "error") throw new Error(result.error);
      await refreshSettings();
      setIsCreating(false);
      toast.success(t("settings.postProcessing.prompts.deleted"));
    } catch (error) {
      console.error("Failed to delete prompt:", error);
      toast.error(t("settings.postProcessing.prompts.deleteError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDuplicatePrompt = async () => {
    if (!selectedPrompt) return;

    setIsSaving(true);
    try {
      const result = await commands.addPostProcessPrompt(
        t("settings.postProcessing.prompts.copyName", {
          name: selectedPrompt.name,
        }),
        selectedPrompt.prompt,
      );
      if (result.status === "error") throw new Error(result.error);
      await refreshSettings();
      try {
        await updateSetting("post_process_selected_prompt_id", result.data.id);
      } catch {
        // The settings store already reports persistence failures.
        return;
      }
      toast.success(t("settings.postProcessing.prompts.duplicated"));
    } catch (error) {
      console.error("Failed to duplicate prompt:", error);
      toast.error(t("settings.postProcessing.prompts.duplicateError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelCreate = () => {
    setIsCreating(false);
    if (selectedPrompt) {
      setDraftName(selectedPrompt.name);
      setDraftText(selectedPrompt.prompt);
    } else {
      setDraftName("");
      setDraftText("");
    }
  };

  const handleStartCreate = () => {
    setIsCreating(true);
    setDraftName("");
    setDraftText("");
  };

  const hasPrompts = prompts.length > 0;
  const isDirty =
    !!selectedPrompt &&
    (draftName.trim() !== selectedPrompt.name ||
      draftText.trim() !== selectedPrompt.prompt.trim());

  return (
    <SettingContainer
      title={t("settings.postProcessing.prompts.selectedPrompt.title")}
      description={t(
        "settings.postProcessing.prompts.selectedPrompt.description",
      )}
      descriptionMode="tooltip"
      layout="stacked"
      grouped={true}
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold">
              {t("settings.postProcessing.prompts.libraryTitle")}
            </h4>
            <p className="mt-0.5 text-xs leading-5 text-text/55">
              {t("settings.postProcessing.prompts.libraryDescription", {
                count: prompts.length,
              })}
            </p>
          </div>
          <Button
            type="button"
            onClick={handleStartCreate}
            variant="primary"
            size="md"
            disabled={isCreating || isSaving}
            className="flex shrink-0 items-center gap-1.5"
          >
            <Plus className="h-4 w-4" />
            {t("settings.postProcessing.prompts.createNew")}
          </Button>
        </div>

        {hasPrompts ? (
          <div className="grid gap-2 sm:grid-cols-2" role="list">
            {prompts.map((prompt) => {
              const isSelected = prompt.id === selectedPromptId && !isCreating;
              return (
                <button
                  key={prompt.id}
                  type="button"
                  role="listitem"
                  onClick={() => handlePromptSelect(prompt.id)}
                  disabled={
                    isCreating ||
                    isSaving ||
                    isUpdating("post_process_selected_prompt_id")
                  }
                  aria-current={isSelected ? "true" : undefined}
                  className={`flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus:outline-none focus:ring-1 focus:ring-logo-primary disabled:cursor-not-allowed disabled:opacity-50 ${
                    isSelected
                      ? "border-logo-primary/40 bg-logo-primary/10 text-text"
                      : "border-mid-gray/25 bg-control/50 text-text/70 hover:border-logo-primary/25 hover:bg-logo-primary/5"
                  }`}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    {isSelected && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 truncate font-medium">
                    {prompt.name}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="rounded-lg border border-mid-gray/25 px-3 py-3 text-sm text-text/55">
            {t("settings.postProcessing.prompts.createFirst")}
          </p>
        )}

        {!isCreating && hasPrompts && selectedPrompt && (
          <div className="space-y-3 border-t border-mid-gray/20 pt-4">
            <div>
              <h4 className="text-sm font-semibold">
                {t("settings.postProcessing.prompts.editTitle")}
              </h4>
              <p className="mt-0.5 text-xs text-text/50">
                {t("settings.postProcessing.prompts.editDescription")}
              </p>
            </div>
            <div className="space-y-2 flex flex-col">
              <label htmlFor="profile-name" className="text-sm font-semibold">
                {t("settings.postProcessing.prompts.promptLabel")}
              </label>
              <Input
                id="profile-name"
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder={t(
                  "settings.postProcessing.prompts.promptLabelPlaceholder",
                )}
                variant="compact"
                disabled={isSaving}
              />
            </div>

            <div className="space-y-2 flex flex-col">
              <label
                htmlFor="profile-instructions"
                className="text-sm font-semibold"
              >
                {t("settings.postProcessing.prompts.promptInstructions")}
              </label>
              <Textarea
                id="profile-instructions"
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                placeholder={t(
                  "settings.postProcessing.prompts.promptInstructionsPlaceholder",
                )}
                disabled={isSaving}
                className="min-h-40 font-normal"
              />
              <p className="text-xs text-mid-gray/70">
                <Trans
                  i18nKey="settings.postProcessing.prompts.promptTip"
                  components={{ code: <code /> }}
                />
              </p>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                type="button"
                onClick={() => void handleUpdatePrompt()}
                variant="primary"
                size="md"
                disabled={
                  isSaving || !draftName.trim() || !draftText.trim() || !isDirty
                }
                className="flex items-center gap-1.5"
              >
                <Save className="h-4 w-4" />
                {t("settings.postProcessing.prompts.updatePrompt")}
              </Button>
              <Button
                type="button"
                onClick={() => void handleDuplicatePrompt()}
                variant="secondary"
                size="md"
                disabled={isSaving || !selectedPrompt}
                className="flex items-center gap-1.5"
              >
                <Copy className="h-4 w-4" />
                {t("settings.postProcessing.prompts.duplicatePrompt")}
              </Button>
              <Button
                type="button"
                onClick={() => void handleDeletePrompt(selectedPromptId)}
                variant="danger-ghost"
                size="md"
                disabled={isSaving || !selectedPromptId || prompts.length <= 1}
                title={
                  prompts.length <= 1
                    ? t("settings.postProcessing.prompts.keepOne")
                    : undefined
                }
                className="ml-auto flex items-center gap-1.5"
              >
                <Trash2 className="h-4 w-4" />
                {t("settings.postProcessing.prompts.deletePrompt")}
              </Button>
            </div>
          </div>
        )}

        {!isCreating && !selectedPrompt && (
          <div className="p-3 bg-mid-gray/5 rounded-md border border-mid-gray/20">
            <p className="text-sm text-mid-gray">
              {hasPrompts
                ? t("settings.postProcessing.prompts.selectToEdit")
                : t("settings.postProcessing.prompts.createFirst")}
            </p>
          </div>
        )}

        {isCreating && (
          <div className="space-y-3 border-t border-mid-gray/20 pt-4">
            <div>
              <h4 className="text-sm font-semibold">
                {t("settings.postProcessing.prompts.newTitle")}
              </h4>
              <p className="mt-0.5 text-xs text-text/50">
                {t("settings.postProcessing.prompts.newDescription")}
              </p>
            </div>
            <div className="space-y-2 block flex flex-col">
              <label
                htmlFor="new-profile-name"
                className="text-sm font-semibold text-text"
              >
                {t("settings.postProcessing.prompts.promptLabel")}
              </label>
              <Input
                id="new-profile-name"
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder={t(
                  "settings.postProcessing.prompts.promptLabelPlaceholder",
                )}
                variant="compact"
                disabled={isSaving}
                autoFocus
              />
            </div>

            <div className="space-y-2 flex flex-col">
              <label
                htmlFor="new-profile-instructions"
                className="text-sm font-semibold"
              >
                {t("settings.postProcessing.prompts.promptInstructions")}
              </label>
              <Textarea
                id="new-profile-instructions"
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                placeholder={t(
                  "settings.postProcessing.prompts.promptInstructionsPlaceholder",
                )}
                disabled={isSaving}
                className="min-h-40 font-normal"
              />
              <p className="text-xs text-mid-gray/70">
                <Trans
                  i18nKey="settings.postProcessing.prompts.promptTip"
                  components={{ code: <code /> }}
                />
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                onClick={() => void handleCreatePrompt()}
                variant="primary"
                size="md"
                disabled={isSaving || !draftName.trim() || !draftText.trim()}
                className="flex items-center gap-1.5"
              >
                <Plus className="h-4 w-4" />
                {t("settings.postProcessing.prompts.createPrompt")}
              </Button>
              <Button
                type="button"
                onClick={handleCancelCreate}
                variant="secondary"
                size="md"
                disabled={isSaving}
              >
                {t("settings.postProcessing.prompts.cancel")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </SettingContainer>
  );
};

export const PostProcessingSettingsApi = React.memo(
  PostProcessingSettingsApiComponent,
);
PostProcessingSettingsApi.displayName = "PostProcessingSettingsApi";

export const PostProcessingSettingsPrompts = React.memo(
  PostProcessingSettingsPromptsComponent,
);
PostProcessingSettingsPrompts.displayName = "PostProcessingSettingsPrompts";

export const PostProcessingSettings: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup>
        <PostProcessingToggle descriptionMode="inline" grouped={true} />
      </SettingsGroup>

      <SettingsGroup title={t("settings.postProcessing.hotkey.title")}>
        <ShortcutInput
          shortcutId="transcribe_with_post_process"
          descriptionMode="tooltip"
          grouped={true}
        />
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.postProcessing.api.title")}
        description={t("settings.postProcessing.api.description")}
      >
        <PostProcessingSettingsApi />
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.postProcessing.prompts.title")}
        description={t("settings.postProcessing.prompts.description")}
      >
        <PostProcessingSettingsPrompts />
      </SettingsGroup>
    </div>
  );
};
