import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Schwifty",
    short_name: "Schwifty",
    description:
      "Create monthly shift plans, assign competencies, and manage overtime coverage.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f4efe7",
    theme_color: "#f97316",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
