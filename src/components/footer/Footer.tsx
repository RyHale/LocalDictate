import React, { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

import ModelSelector from "../model-selector";
import PostProcessProfileSelector from "./PostProcessProfileSelector";

const Footer: React.FC = () => {
  const [version, setVersion] = useState("");

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        setVersion(await getVersion());
      } catch (error) {
        console.error("Failed to get app version:", error);
        setVersion("0.1.0");
      }
    };

    void fetchVersion();
  }, []);

  return (
    <div className="relative z-40 w-full bg-background-raised px-4 py-2.5">
      <div className="flex min-h-8 items-center gap-5 text-xs text-text/60">
        <div className="min-w-0 flex-1">
          <ModelSelector />
        </div>
        <PostProcessProfileSelector />
        {/* eslint-disable-next-line i18next/no-literal-string */}
        <span className="shrink-0 text-text/35">v{version}</span>
      </div>
    </div>
  );
};

export default Footer;
