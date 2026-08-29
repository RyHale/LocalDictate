import React from "react";
import { useTranslation } from "react-i18next";
import { Dropdown } from "../ui/Dropdown";
import { SettingContainer } from "../ui/SettingContainer";
import { useSettings } from "../../hooks/useSettings";
import { RecordingRetentionPeriod } from "@/bindings";

export const RECORDING_RETENTION_PERIOD_VALUES = [
  "never",
  "preserve_limit",
  "days_3",
  "weeks_2",
  "months_3",
] as const satisfies readonly RecordingRetentionPeriod[];

const RECORDING_RETENTION_LABEL_KEYS: Record<RecordingRetentionPeriod, string> =
  {
    never: "settings.debug.recordingRetention.never",
    preserve_limit: "settings.debug.recordingRetention.preserveLimit",
    days_3: "settings.debug.recordingRetention.days3",
    weeks_2: "settings.debug.recordingRetention.weeks2",
    months_3: "settings.debug.recordingRetention.months3",
  };

interface RecordingRetentionPeriodProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const RecordingRetentionPeriodSelector: React.FC<RecordingRetentionPeriodProps> =
  React.memo(({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const selectedRetentionPeriod =
      getSetting("recording_retention_period") ?? "never";
    const historyLimit = getSetting("history_limit") ?? 5;

    const handleRetentionPeriodSelect = async (period: string) => {
      await updateSetting(
        "recording_retention_period",
        period as RecordingRetentionPeriod,
      );
    };

    const retentionOptions = RECORDING_RETENTION_PERIOD_VALUES.map((value) => ({
      value,
      label: t(
        RECORDING_RETENTION_LABEL_KEYS[value],
        value === "preserve_limit"
          ? { count: Number(historyLimit) }
          : undefined,
      ),
    }));

    return (
      <SettingContainer
        title={t("settings.debug.recordingRetention.title")}
        description={t("settings.debug.recordingRetention.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      >
        <Dropdown
          options={retentionOptions}
          selectedValue={selectedRetentionPeriod}
          onSelect={handleRetentionPeriodSelect}
          placeholder={t("settings.debug.recordingRetention.placeholder")}
          disabled={isUpdating("recording_retention_period")}
        />
      </SettingContainer>
    );
  });

RecordingRetentionPeriodSelector.displayName =
  "RecordingRetentionPeriodSelector";
