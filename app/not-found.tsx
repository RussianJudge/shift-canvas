import type { Metadata } from "next";

import { PatLeaveNotice } from "@/components/pat-leave-notice";

export const metadata: Metadata = {
  title: "Page not found · Schwifty",
};

export default function NotFound() {
  return (
    <PatLeaveNotice
      eyebrow="404 · Page not found"
      title="This page is off on pat leave."
      actionHref="/"
      actionLabel="Back to Schwifty"
    />
  );
}
