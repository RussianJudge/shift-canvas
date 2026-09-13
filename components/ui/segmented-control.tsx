import type { ReactNode } from "react";

export type SegmentedControlOption<Value extends string> = {
  value: Value;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
};

/**
 * Two or more closely related views, one of which is always current.
 *
 * Only offer options that exist — a segment with nothing behind it is a
 * control without behaviour. Selection is carried by `aria-pressed` as well as
 * the fill, so it does not depend on colour alone.
 */
export function SegmentedControl<Value extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: Value;
  options: SegmentedControlOption<Value>[];
  onChange: (value: Value) => void;
  /** Accessible name for the group; the segments only name themselves. */
  label: string;
  className?: string;
}) {
  return (
    <div className={["ui-segmented", className].filter(Boolean).join(" ")} role="group" aria-label={label}>
      {options.map((option) => {
        const isSelected = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            className="ui-segmented__option"
            aria-pressed={isSelected}
            disabled={option.disabled}
            onClick={() => {
              if (!isSelected) {
                onChange(option.value);
              }
            }}
          >
            {option.icon ? (
              <span className="ui-segmented__icon" aria-hidden="true">
                {option.icon}
              </span>
            ) : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
