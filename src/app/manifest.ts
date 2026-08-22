import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bridge — AI-Powered Assessment Platform",
    short_name: "Bridge",
    description:
      "AI-generated, proctored, and auto-graded exams for primary and secondary students.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f7f7fb",
    theme_color: "#4f46e5",
    icons: [
      {
        src: "/icons/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
