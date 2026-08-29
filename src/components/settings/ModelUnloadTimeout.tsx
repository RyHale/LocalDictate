import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import type { ModelUnloadTimeout } from "@/bindings";
import { Dropdown, type DropdownOption } from "../ui/Dropdown";
import { SettingContainer } from "../ui/SettingContainer";

export const MODEL_UNLOAD_TIMEOUT_VALUES = [
  "never",
  "immediately",
  "min_2",
  "min_5",
  "min_10",
  "min_15",
  "hour_1",
] as const satisfies readonly ModelUnloadTimeout[];

export const DEBUG_MODEL_UNLOAD_TIMEOUT_VALUE =
  "sec_15" as const satisfies ModelUnloadTimeout;

const MODEL_UNLOAD_TIMEOUT_LABEL_KEYS: Record<ModelUnloadTimeout, string> = {
  never: "settings.advanced.modelUnload.options.never",
  immediately: "settings.advanced.modelUnload.options.immediately",
  min_2: "settings.advanced.modelUnload.options.min2",
  min_5: "settings.advanced.modelUnload.options.min5",
  min_10: "settings.advanced.modelUnload.options.min10",
  min_15: "settings.advanced.modelUnload.options.min15",
  hour_1: "settings.advanced.modelUnload.options.hour1",
  sec_15: "settings.advanced.modelUnload.options.sec15",
};

interface ModelUnloadTimeoutProps {
  descriptionMode?: "tooltip" | "inline";
  grouped?: boolean;
}

export const ModelUnloadTimeoutSetting: React.FC<ModelUnloadTimeoutProps> = ({
  descriptionMode = "inline",
  grouped = false,
}) => {
  const { t } = useTranslation();
  const { settings, getSetting, updateSetting, isUpdating } = useSettings();

  const timeoutOptions: Array<DropdownOption & { value: ModelUnloadTimeout }> =
    MODEL_UNLOAD_TIMEOUT_VALUES.map((value) => ({
      value,
      label: t(MODEL_UNLOAD_TIMEOUT_LABEL_KEYS[value]),
    }));

  const debugTimeoutOptions: Array<
    DropdownOption & { value: ModelUnloadTimeout }
  > = [
    ...timeoutOptions,
    {
      value: DEBUG_MODEL_UNLOAD_TIMEOUT_VALUE,
      label: t(
        MODEL_UNLOAD_TIMEOUT_LABEL_KEYS[DEBUG_MODEL_UNLOAD_TIMEOUT_VALUE],
      ),
    },
  ];

  const handleChange = async (value: string) => {
    const newTimeout = value as ModelUnloadTimeout;

    try {
      await updateSetting("model_unload_timeout", newTimeout);
    } catch (error) {
      console.error("Failed to update model unload timeout:", error);
    }
  };

  const currentValue = getSetting("model_unload_timeout") ?? "never";

  const options =
    settings?.debug_mode === true ? debugTimeoutOptions : timeoutOptions;

  return (
    <SettingContainer
      title={t("settings.advanced.modelUnload.title")}
      description={t("settings.advanced.modelUnload.description")}
      descriptionMode={descriptionMode}
      grouped={grouped}
    >
      <Dropdown
        options={options}
        selectedValue={currentValue}
        onSelect={handleChange}
        disabled={isUpdating("model_unload_timeout")}
      />
    </SettingContainer>
  );
};
