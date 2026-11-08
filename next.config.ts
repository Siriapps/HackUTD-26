import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* No Next dev badge on the judge's screen. */
  devIndicators: false,
  cacheComponents: true,
  // Dev only: let phones open the console / field page through a cloudflared quick tunnel (P3 Photon testing).
  allowedDevOrigins: ["*.trycloudflare.com"],
  partialPrefetching: true,
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
