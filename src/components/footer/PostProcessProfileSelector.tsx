import React from "react";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Dropdown } from "@/components/ui";
import { useSettings } from "@/hooks/useSettings";

const PostProcessProfileSelector: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const enabled = getSetting("post_process_enabled") ?? false;
  const prompts = getSetting("post_process_prompts") ?? [];
  const selected = getSetting("post_process_selected_prompt_id") ?? null;

  if (!enabled || prompts.length === 0) return null;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-logo-primary" />
      <span className="shrink-0 text-xs text-text/45">
        {t("settings.postProcessing.prompts.profile")}
      </span>
      <Dropdown
        options={prompts.map((prompt) => ({
          value: prompt.id,
          label: prompt.name,
        }))}
        selectedValue={selected}
        onSelect={(value) =>
          void updateSetting("post_process_selected_prompt_id", value)
        }
        disabled={isUpdating("post_process_selected_prompt_id")}
        placement="top"
        className="w-52"
      />
    </div>
  );
};

export default PostProcessProfileSelector;
