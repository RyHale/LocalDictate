import React from "react";
import { useTranslation } from "react-i18next";
import {
  AudioLines,
  Cog,
  FlaskConical,
  History,
  Info,
  Palette,
  Sparkles,
  Cpu,
} from "lucide-react";
import LocalDictateLogo from "./icons/LocalDictateLogo";
import { useSettings } from "../hooks/useSettings";
import {
  GeneralSettings,
  AdvancedSettings,
  HistorySettings,
  DebugSettings,
  AboutSettings,
  PostProcessingSettings,
  ModelsSettings,
  AppearanceSettings,
} from "./settings";

export type SidebarSection = keyof typeof SECTIONS_CONFIG;

interface IconProps {
  width?: number | string;
  height?: number | string;
  size?: number | string;
  className?: string;
  [key: string]: any;
}

interface SectionConfig {
  labelKey: string;
  icon: React.ComponentType<IconProps>;
  component: React.ComponentType;
  enabled: (settings: any) => boolean;
}

export const SECTIONS_CONFIG = {
  general: {
    labelKey: "sidebar.general",
    icon: AudioLines,
    component: GeneralSettings,
    enabled: () => true,
  },
  history: {
    labelKey: "sidebar.history",
    icon: History,
    component: HistorySettings,
    enabled: () => true,
  },
  models: {
    labelKey: "sidebar.models",
    icon: Cpu,
    component: ModelsSettings,
    enabled: () => true,
  },
  appearance: {
    labelKey: "appearance.title",
    icon: Palette,
    component: AppearanceSettings,
    enabled: () => true,
  },
  advanced: {
    labelKey: "sidebar.advanced",
    icon: Cog,
    component: AdvancedSettings,
    enabled: () => true,
  },
  postprocessing: {
    labelKey: "sidebar.postProcessing",
    icon: Sparkles,
    component: PostProcessingSettings,
    enabled: (settings) => settings?.post_process_enabled ?? false,
  },
  debug: {
    labelKey: "sidebar.debug",
    icon: FlaskConical,
    component: DebugSettings,
    enabled: (settings) => settings?.debug_mode ?? false,
  },
  about: {
    labelKey: "sidebar.about",
    icon: Info,
    component: AboutSettings,
    enabled: () => true,
  },
} as const satisfies Record<string, SectionConfig>;

interface SidebarProps {
  activeSection: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSectionChange,
}) => {
  const { t } = useTranslation();
  const { settings } = useSettings();

  const availableSections = Object.entries(SECTIONS_CONFIG)
    .filter(([_, config]) => config.enabled(settings))
    .map(([id, config]) => ({ id: id as SidebarSection, ...config }));

  return (
    <aside className="flex h-full w-52 shrink-0 flex-col bg-background-sidebar px-3 py-3">
      <div className="flex h-14 items-center px-2">
        <LocalDictateLogo width={120} className="max-h-8" />
      </div>
      <nav
        className="mt-3 flex w-full flex-col gap-1"
        aria-label={t("sidebar.navigation")}
      >
        {availableSections.map((section) => {
          const Icon = section.icon;
          const isActive = activeSection === section.id;

          return (
            <button
              type="button"
              key={section.id}
              className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-start transition-colors ${
                isActive
                  ? "bg-logo-primary/14 text-logo-primary"
                  : "text-text/65 hover:bg-mid-gray/10 hover:text-text"
              }`}
              onClick={() => onSectionChange(section.id)}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon width={18} height={18} className="shrink-0" />
              <p
                className="text-sm font-medium truncate"
                title={t(section.labelKey)}
              >
                {t(section.labelKey)}
              </p>
            </button>
          );
        })}
      </nav>
    </aside>
  );
};
