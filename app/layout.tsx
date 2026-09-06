import type { Metadata, Viewport } from "next";

import "./globals.css";
import "./tokens.css";
import "./primitives.css";
import "./shell.css";
import "./data-table.css";
import "./overtime.css";
import "./mutuals.css";
import "./personnel.css";
import "./competencies.css";
import "./time-codes.css";
import "./shifts.css";

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

/**
 * The sidebar's collapsed state lives in localStorage, which the server cannot
 * read, so SSR always emits the expanded shell. Without this the page paints
 * wide and then snaps narrow once React hydrates. Stamping the preference on
 * <html> before first paint lets CSS render the collapsed rail immediately;
 * WorkspaceShell keeps the attribute in sync from then on.
 */
const SIDEBAR_COLLAPSE_PREPAINT = `try{if(localStorage.getItem('shift-canvas-sidebar-collapsed')==='true'&&window.innerWidth>=600){document.documentElement.dataset.sidebarCollapsed='true'}}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_COLLAPSE_PREPAINT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
