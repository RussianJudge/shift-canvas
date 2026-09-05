import type { Metadata, Viewport } from "next";

import "./globals.css";
import "./tokens.css";
import "./primitives.css";
import "./shell.css";

export const metadata: Metadata = {
  title: "Schwifty",
  description:
    "Create monthly shift plans, assign competencies, and extrapolate day, night, and off rotations from shift rules.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Schwifty",
    // Transparent status bar so the app draws under the camera/notch.
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Let the app extend into the safe area (flow up under the notch).
  viewportFit: "cover",
  // Match the header / toolbar surface so the top safe-area bar blends in.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#242427" },
  ],
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
