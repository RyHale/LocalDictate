import React from "react";
import { useTranslation } from "react-i18next";

import type { UiFontSize, WidgetAnimation } from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import {
  applyUiFontSize,
  applyWidgetAnimation,
  UI_FONT_SIZE_OPTIONS,
  WIDGET_ANIMATION_OPTIONS,
} from "@/lib/utils/theme";
import { Dropdown } from "@/components/ui/Dropdown";
import { SettingContainer } from "@/components/ui/SettingContainer";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import { ThemePackSelector } from "../ThemePackSelector";
import { ThemeSelector } from "../ThemeSelector";
import { AppLanguageSelector } from "../AppLanguageSelector";

const FontSizeSelector: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const currentSize = settings?.ui_font_size ?? "default";
  const options = UI_FONT_SIZE_OPTIONS.map((value) => ({
    value,
    label: t(`appearance.fontSize.options.${value}`),
  }));

  const handleChange = async (value: string) => {
    const size = value as UiFontSize;
    try {
      await updateSetting("ui_font_size", size);
      applyUiFontSize(size);
    } catch {
      // The settings store restores the previous value and reports the error.
    }
  };

  return (
    <SettingContainer
      title={t("appearance.fontSize.title")}
      description={t("appearance.fontSize.description")}
      grouped={true}
    >
      <Dropdown
        options={options}
        selectedValue={currentSize}
        onSelect={handleChange}
      />
    </SettingContainer>
  );
};

const WidgetAnimationSelector: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const currentLevel = settings?.widget_animation ?? "full";
  const options = WIDGET_ANIMATION_OPTIONS.map((value) => ({
    value,
    label: t(`appearance.widgetAnimation.options.${value}`),
  }));

  const handleChange = async (value: string) => {
    const level = value as WidgetAnimation;
    try {
      await updateSetting("widget_animation", level);
      applyWidgetAnimation(level);
    } catch {
      // The settings store restores the previous value and reports the error.
    }
  };

  return (
    <SettingContainer
      title={t("appearance.widgetAnimation.title")}
      description={t("appearance.widgetAnimation.description")}
      grouped={true}
    >
      <Dropdown
        options={options}
        selectedValue={currentLevel}
        onSelect={handleChange}
      />
    </SettingContainer>
  );
};

export const AppearanceSettings: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup title={t("appearance.interfaceTitle")}>
        <ThemeSelector descriptionMode="tooltip" grouped={true} />
        <FontSizeSelector />
        <AppLanguageSelector descriptionMode="tooltip" grouped={true} />
      </SettingsGroup>

      <SettingsGroup title={t("appearance.widgetTitle")}>
        <WidgetAnimationSelector />
        <ThemePackSelector grouped={true} />
      </SettingsGroup>
    </div>
  );
};
