import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Schwifty",
  description:
    "Create monthly shift plans, assign competencies, and extrapolate day, night, and off rotations from shift rules.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Schwifty",
    statusBarStyle: "default",
  },
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
