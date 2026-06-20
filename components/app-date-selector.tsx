"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { formatMonthLabel, shiftMonthKey } from "@/lib/scheduling";

type AppDateSelectorProps = {
  mode: "month" | "year";
  value: string;
  label?: string;
  triggerLabel?: string;
  availableMonths?: string[];
  disabled?: boolean;
  className?: string;
  onChange: (nextMonth: string) => void;
};

function parseMonthKey(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return {
    year: Number.isFinite(year) ? year : new Date().getFullYear(),
    month: Number.isFinite(month) ? month : 1,
  };
}

function formatMonthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function getFallbackMonthOptions(value: string) {
  return Array.from({ length: 25 }, (_, index) => shiftMonthKey(value, index - 12));
}

export function AppDateSelector({
  mode,
  value,
  label,
  triggerLabel,
  availableMonths,
  disabled = false,
  className = "",
  onChange,
}: AppDateSelectorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const { year: selectedYear, month: selectedMonth } = parseMonthKey(value);
  const [visibleYear, setVisibleYear] = useState(selectedYear);
  const monthOptions = useMemo(
    () => availableMonths ?? getFallbackMonthOptions(value),
    [availableMonths, value],
  );
  const availableMonthSet = useMemo(() => new Set(monthOptions), [monthOptions]);
  const yearOptions = useMemo(
    () => Array.from({ length: 11 }, (_, index) => selectedYear - 5 + index),
    [selectedYear],
  );
  const resolvedTriggerLabel =
    triggerLabel ?? (mode === "year" ? String(selectedYear) : formatMonthLabel(value));

  useEffect(() => {
    setVisibleYear(selectedYear);
  }, [selectedYear]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }

      setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function chooseMonth(month: string) {
    setIsOpen(false);
    onChange(month);
  }

  function chooseYear(year: number) {
    setIsOpen(false);
    onChange(formatMonthKey(year, selectedMonth));
  }

  return (
    <div ref={rootRef} className={`app-date-selector ${className}`.trim()}>
      <button
        type="button"
        className="app-date-selector__trigger"
        onClick={() => setIsOpen((current) => !current)}
        disabled={disabled}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        <span className="app-date-selector__eyebrow">{label ?? (mode === "year" ? "Year" : "Month")}</span>
        <strong>{resolvedTriggerLabel}</strong>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9l6 6l6-6" />
        </svg>
      </button>

      {isOpen ? (
        <section className="app-date-selector__popover" role="dialog" aria-label={label ?? "Date selector"}>
          {mode === "month" ? (
            <>
              <div className="app-date-selector__header">
                <button type="button" onClick={() => setVisibleYear((year) => year - 1)} aria-label="Previous year">
                  ‹
                </button>
                <strong>{visibleYear}</strong>
                <button type="button" onClick={() => setVisibleYear((year) => year + 1)} aria-label="Next year">
                  ›
                </button>
              </div>
              <div className="app-date-selector__grid app-date-selector__grid--months">
                {Array.from({ length: 12 }, (_, index) => {
                  const monthNumber = index + 1;
                  const monthKey = formatMonthKey(visibleYear, monthNumber);
                  const isSelected = monthKey === value;
                  const isAvailable = availableMonths ? availableMonthSet.has(monthKey) : true;

                  return (
                    <button
                      key={monthKey}
                      type="button"
                      className={isSelected ? "app-date-selector__option app-date-selector__option--selected" : "app-date-selector__option"}
                      onClick={() => chooseMonth(monthKey)}
                      disabled={!isAvailable}
                    >
                      {new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(
                        new Date(Date.UTC(visibleYear, index, 1)),
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="app-date-selector__grid app-date-selector__grid--years">
              {yearOptions.map((year) => (
                <button
                  key={year}
                  type="button"
                  className={
                    year === selectedYear
                      ? "app-date-selector__option app-date-selector__option--selected"
                      : "app-date-selector__option"
                  }
                  onClick={() => chooseYear(year)}
                >
                  {year}
                </button>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
