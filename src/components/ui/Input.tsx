import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: "default" | "compact";
}

export const Input: React.FC<InputProps> = ({
  className = "",
  variant = "default",
  disabled,
  ...props
}) => {
  const baseClasses =
    "min-h-9 px-3 py-1.5 text-sm font-medium bg-control border border-transparent rounded-lg text-start transition-colors duration-150";

  const interactiveClasses = disabled
    ? "opacity-60 cursor-not-allowed"
    : "hover:bg-logo-primary/10 hover:border-logo-primary/30 focus:outline-none focus:bg-logo-primary/10 focus:border-logo-primary";

  const variantClasses = {
    default: "px-3 py-2",
    compact: "px-3 py-1.5",
  } as const;

  return (
    <input
      className={`${baseClasses} ${variantClasses[variant]} ${interactiveClasses} ${className}`}
      disabled={disabled}
      {...props}
    />
  );
};
