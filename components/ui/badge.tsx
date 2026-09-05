import type { HTMLAttributes, ReactNode } from "react";

type BadgeTone =
  | "neutral"
  | "primary"
  | "success"
  | "info"
  | "warning"
  | "leave"
  | "conflict";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  tone?: BadgeTone;
  pill?: boolean;
  /** Adds a non-colour signal for tones the label alone does not carry. */
  dot?: boolean;
};

export function Badge({
  children,
  tone = "neutral",
  pill = false,
  dot = false,
  className,
  ...rest
}: BadgeProps) {
  const classes = ["ui-badge", `ui-badge--${tone}`];
  if (pill) classes.push("ui-badge--pill");
  if (className) classes.push(className);

  return (
    <span {...rest} className={classes.join(" ")}>
      {dot ? <span className="ui-badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
