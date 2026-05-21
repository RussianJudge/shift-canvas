"use client";

import { createPortal } from "react-dom";

import type { Competency, ShiftKind, TimeCode } from "@/lib/types";

type AssignmentSelection = {
  competencyId: string | null;
  timeCodeId: string | null;
  notes: string | null;
};

function getCompactCode(code: string) {
  if (code.startsWith("Post ")) {
    return code.replace("Post ", "");
  }

  if (code.startsWith("Dock ")) {
    return code.replace("Dock ", "D");
  }

  if (code.startsWith("Pack ")) {
    return code.replace("Pack ", "PK");
  }

  return code.replace(/\s+/g, "");
}

function formatShortDate(isoDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

export function ScheduleAssignmentModal({
  selectedEmployeeName,
  selectedDate,
  shiftKind,
  selection,
  competencies,
  timeCodes,
  onApply,
  onClear,
  onClose,
  clearDisabledReason,
}: {
  selectedEmployeeName: string | null;
  selectedDate: string | null;
  shiftKind: ShiftKind;
  selection: AssignmentSelection;
  competencies: Competency[];
  timeCodes: TimeCode[];
  onApply: (selection: AssignmentSelection) => void;
  onClear: () => void;
  onClose: () => void;
  clearDisabledReason?: string | null;
}) {
  if (!selectedEmployeeName || !selectedDate || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="assignment-modal-backdrop" onClick={onClose}>
      <section
        className="assignment-modal"
        aria-label="Assignment editor"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="assignment-modal__header">
          <div>
            <h2 className="assignment-modal__title">Assignment</h2>
            <p className="assignment-modal__context">
              {selectedEmployeeName} · {formatShortDate(selectedDate)} · {shiftKind.toLowerCase()}
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="assignment-modal__group">
          <span className="assignment-modal__label">Time Codes</span>
          <div className="assignment-modal__options">
            {timeCodes.map((timeCode) => (
              <button
                key={timeCode.id}
                type="button"
                className={`legend-pill legend-pill--${timeCode.colorToken.toLowerCase()} ${
                  selection.timeCodeId === timeCode.id ? "legend-pill--selected" : ""
                }`}
                onClick={() => {
                  onApply({
                    ...selection,
                    competencyId: null,
                    timeCodeId: timeCode.id,
                  });
                  onClose();
                }}
              >
                {timeCode.code}
              </button>
            ))}
          </div>
        </div>

        <div className="assignment-modal__group">
          <span className="assignment-modal__label">Competencies</span>
          <div className="assignment-modal__options">
            {competencies.map((competency) => (
              <button
                key={competency.id}
                type="button"
                className={`legend-pill legend-pill--${competency.colorToken.toLowerCase()} ${
                  selection.competencyId === competency.id ? "legend-pill--selected" : ""
                }`}
                onClick={() => {
                  onApply({
                    ...selection,
                    competencyId: competency.id,
                    timeCodeId: null,
                  });
                  onClose();
                }}
              >
                {getCompactCode(competency.code)}
              </button>
            ))}
          </div>
        </div>

        <div className="assignment-modal__group">
          <label className="assignment-modal__label" htmlFor="assignment-note">
            Note
          </label>
          <textarea
            id="assignment-note"
            className="assignment-modal__note-input"
            rows={3}
            value={selection.notes ?? ""}
            placeholder="Add a note for this cell"
            onChange={(event) =>
              onApply({
                ...selection,
                notes: event.target.value || null,
              })
            }
          />
        </div>

        <div className="assignment-modal__footer">
          {clearDisabledReason ? <p className="toolbar-status">{clearDisabledReason}</p> : null}
          <button
            type="button"
            className="ghost-button"
            onClick={onClear}
            disabled={Boolean(clearDisabledReason)}
          >
            Clear assignment
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
