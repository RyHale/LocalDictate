import React from "react";

interface SettingsGroupProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
}

export const SettingsGroup: React.FC<SettingsGroupProps> = ({
  title,
  description,
  children,
}) => {
  return (
    <section className="space-y-2.5">
      {title && (
        <div className="px-1">
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-text/45">
            {title}
          </h2>
          {description && (
            <p className="text-xs text-mid-gray mt-1">{description}</p>
          )}
        </div>
      )}
      <div className="overflow-visible rounded-xl bg-background-raised">
        <div>{children}</div>
      </div>
    </section>
  );
};
