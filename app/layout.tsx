import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Schwifty",
  description:
    "Create monthly shift plans, assign competencies, and extrapolate day, night, and off rotations from shift rules.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Schwifty",
    // Transparent status bar so the standalone home-screen app draws under it.
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  /**
   * The app is used from the Home Screen, not a Safari tab — confirmed against
   * a real device via the iOS Simulator. `themeColor` only reaches the notch
   * area in a plain browser tab; in standalone with viewportFit: "cover" the
   * page draws under the status bar and paints that region itself, which is
   * what the safe-area strip below is for.
   */
  viewportFit: "cover",
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
