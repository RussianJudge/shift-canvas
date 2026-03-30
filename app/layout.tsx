import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Shift Canvas",
  description:
    "Create monthly schedules for multiple teams, assign competencies, and track rotating 601-604 shift patterns.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
