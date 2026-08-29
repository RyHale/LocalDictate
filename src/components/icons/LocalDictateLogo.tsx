import React from "react";
import { useTranslation } from "react-i18next";

type LocalDictateLogoProps = {
  width?: number;
  height?: number;
  className?: string;
};

const LocalDictateLogo: React.FC<LocalDictateLogoProps> = ({
  width = 180,
  height,
  className,
}) => {
  const { t } = useTranslation();

  return (
    <div
      className={`inline-flex items-center gap-2.5 text-text ${className ?? ""}`}
      style={{ width, height }}
      aria-label={t("app.name")}
    >
      <svg
        className="h-auto w-[22%] min-w-7 max-w-10 shrink-0"
        viewBox="0 0 40 40"
        fill="none"
        aria-hidden="true"
      >
        <rect
          x="1"
          y="1"
          width="38"
          height="38"
          rx="11"
          className="fill-logo-primary"
        />
        <path
          d="M10 22v-4m5 9V13m5 18V9m5 18V13m5 9v-4"
          className="stroke-background"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      <span className="truncate text-[length:inherit] text-base font-semibold tracking-[-0.02em]">
        {t("app.name")}
      </span>
    </div>
  );
};

export default LocalDictateLogo;
