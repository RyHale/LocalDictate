import React from "react";
import { useTranslation } from "react-i18next";
import { Dropdown } from "../ui/Dropdown";
import { SettingContainer } from "../ui/SettingContainer";
import { useSettings } from "@/hooks/useSettings";
import {
  applyTheme,
  applyThemeAccent,
  THEME_ACCENT_OPTIONS,
  THEME_OPTIONS,
} from "@/lib/utils/theme";
import type { Theme, ThemeAccent } from "@/bindings";

interface ThemeSelectorProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const ThemeSelector: React.FC<ThemeSelectorProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { settings, updateSetting } = useSettings();

    const currentTheme: Theme = settings?.theme ?? "system";
    const currentAccent: ThemeAccent = settings?.theme_accent ?? "blue";

    const themeOptions = THEME_OPTIONS.map((value) => ({
      value,
      label: t(`theme.options.${value}`),
    }));

    const handleThemeChange = async (value: string) => {
      const theme = value as Theme;
      try {
        await updateSetting("theme", theme);
        applyTheme(theme);
      } catch {
        // The settings store restores the previous value and reports the error.
      }
    };

    const accentOptions = THEME_ACCENT_OPTIONS.map((value) => ({
      value,
      label: t(`theme.accents.${value}`),
    }));

    const handleAccentChange = async (value: string) => {
      const accent = value as ThemeAccent;
      try {
        await updateSetting("theme_accent", accent);
        applyThemeAccent(accent);
      } catch {
        // The settings store restores the previous value and reports the error.
      }
    };

    return (
      <>
        <SettingContainer
          title={t("theme.title")}
          description={t("theme.description")}
          descriptionMode={descriptionMode}
          grouped={grouped}
        >
          <Dropdown
            options={themeOptions}
            selectedValue={currentTheme}
            onSelect={handleThemeChange}
          />
        </SettingContainer>
        <SettingContainer
          title={t("theme.accentTitle")}
          description={t("theme.accentDescription")}
          descriptionMode={descriptionMode}
          grouped={grouped}
        >
          <Dropdown
            options={accentOptions}
            selectedValue={currentAccent}
            onSelect={handleAccentChange}
          />
        </SettingContainer>
      </>
    );
  },
);

ThemeSelector.displayName = "ThemeSelector";
