import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Shift Canvas",
  description:
    "Create monthly schedules, assign competencies, and extrapolate day, night, and off rotations from schedule rules.",
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
