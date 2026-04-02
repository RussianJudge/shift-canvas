"use client";

import { useEffect } from "react";

export function PrintDialogLauncher() {
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      window.print();
    }, 120);

    return () => window.clearTimeout(timeoutId);
  }, []);

  return null;
}
