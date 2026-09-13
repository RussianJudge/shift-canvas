"use client";

import { useEffect, useState } from "react";

export const BUSINESS_TIME_ZONE = "America/Edmonton";

/**
 * Today's date key in the business timezone, resolved after mount.
 *
 * The server renders these screens too, and a date computed during render
 * would differ from the client's across a midnight boundary, so callers get
 * `null` on the first pass and must treat that as "not known yet" rather than
 * as a date.
 */
export function useBusinessToday() {
  const [today, setToday] = useState<string | null>(null);

  useEffect(() => {
    setToday(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: BUSINESS_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
    );
  }, []);

  return today;
}
