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
    // Transparent status bar so the app draws under the camera/notch.
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Let the app extend into the safe area (flow up under the notch).
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#161618" },
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
