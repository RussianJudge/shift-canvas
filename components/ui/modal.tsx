"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Escape and backdrop clicks stop closing the dialog, for in-flight work. */
  dismissible?: boolean;
};

/**
 * Portal + focus management only. It deliberately owns no submit, validation,
 * or persistence behavior — callers keep their own handlers.
 */
export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  description,
  children,
  footer,
  size = "md",
  dismissible = true,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  const requestClose = useCallback(() => {
    if (dismissible) onClose();
  }, [dismissible, onClose]);

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? dialog)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        requestClose();
        return;
      }

      if (event.key !== "Tab" || !dialog) return;

      const targets = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (targets.length === 0) {
        event.preventDefault();
        return;
      }

      const edge = event.shiftKey ? targets[0] : targets[targets.length - 1];
      if (document.activeElement === edge) {
        event.preventDefault();
        (event.shiftKey ? targets[targets.length - 1] : targets[0]).focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = overflow;
      restoreFocusRef.current?.focus();
    };
  }, [open, requestClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="ui-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`ui-modal${size === "md" ? "" : ` ui-modal--${size}`}`}
      >
        <div className="ui-modal__header">
          <div>
            {eyebrow ? <span className="ui-modal__eyebrow">{eyebrow}</span> : null}
            <h2 className="ui-modal__title" id={titleId}>
              {title}
            </h2>
            {description ? (
              <p className="ui-modal__description" id={descriptionId}>
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {children ? <div className="ui-modal__body">{children}</div> : null}
        {footer ? <div className="ui-modal__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
