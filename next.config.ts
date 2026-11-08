import type { NextConfig } from "next";

/**
 * Cache Components are deliberately OFF: every page of the Hub is personal (role-based
 * data behind a login), so classic dynamic rendering is simpler and safer to reason about.
 * See docs/decisions.md (ADR-003).
 */
const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres", "exceljs", "highs"],
  experimental: {
    serverActions: { bodySizeLimit: "6mb" }, // CV uploads (max 5 MB) go through server actions
  },
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
