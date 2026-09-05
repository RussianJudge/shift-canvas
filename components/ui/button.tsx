import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "subtle" | "destructive";
type ButtonSize = "sm" | "md" | "lg";

function classNames(...values: (string | false | undefined)[]) {
  return values.filter(Boolean).join(" ");
}

function buttonClass({
  variant,
  size,
  loading,
  iconOnly,
  fullWidth,
  className,
}: {
  variant: ButtonVariant;
  size: ButtonSize;
  loading?: boolean;
  iconOnly?: boolean;
  fullWidth?: boolean;
  className?: string;
}) {
  return classNames(
    "ui-button",
    `ui-button--${variant}`,
    size !== "md" && `ui-button--${size}`,
    iconOnly && "ui-button--icon",
    fullWidth && "ui-button--full",
    loading && "ui-button--loading",
    className,
  );
}

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
};

export function Button({
  children,
  variant = "secondary",
  size = "md",
  loading = false,
  fullWidth = false,
  disabled = false,
  type = "button",
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass({ variant, size, loading, fullWidth, className })}
    >
      {loading ? <span className="ui-button__spinner" aria-hidden="true" /> : null}
      <span className="ui-button__label">{children}</span>
    </button>
  );
}

type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "aria-label"
> & {
  /** Required: the control has no visible text to name it. */
  label: string;
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

export function IconButton({
  label,
  icon,
  variant = "subtle",
  size = "md",
  loading = false,
  disabled = false,
  type = "button",
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-label={label}
      aria-busy={loading || undefined}
      className={buttonClass({ variant, size, loading, iconOnly: true, className })}
    >
      {loading ? <span className="ui-button__spinner" aria-hidden="true" /> : null}
      <span className="ui-button__label" aria-hidden="true">
        {icon}
      </span>
    </button>
  );
}
