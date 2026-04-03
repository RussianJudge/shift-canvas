"use client";

import { useEffect, useState, useTransition } from "react";

export function PrintDialogLauncher() {
  const [hasTriggered, setHasTriggered] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;

    async function launchPrintDialog() {
      if (hasTriggered) {
        return;
      }

      const waitForLoad =
        document.readyState === "complete"
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              window.addEventListener("load", () => resolve(), { once: true });
            });

      const waitForFonts =
        "fonts" in document
          ? (document.fonts.ready.catch(() => undefined) as Promise<unknown>)
          : Promise.resolve();

      await Promise.all([waitForLoad, waitForFonts]);

      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

      if (cancelled) {
        return;
      }

      setHasTriggered(true);
      window.print();
    }

    const timeoutId = window.setTimeout(() => {
      startTransition(() => {
        void launchPrintDialog();
      });
    }, 320);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [hasTriggered]);

  return (
    <div className="print-preview-launcher">
      <p className="toolbar-status">
        {hasTriggered ? "Print dialog opened." : isPending ? "Preparing print preview..." : "Preparing print preview..."}
      </p>
      <button
        type="button"
        className="ghost-button"
        onClick={() => {
          setHasTriggered(true);
          window.print();
        }}
      >
        Open print dialog
      </button>
    </div>
  );
}
