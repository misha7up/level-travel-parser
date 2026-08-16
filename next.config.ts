import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Не бандлить chromium — иначе пропадает bin/ на Vercel
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/enrich": [
      "./node_modules/@sparticuz/chromium/**/*",
      "./node_modules/@sparticuz/chromium/bin/**/*",
    ],
  },
};

export default nextConfig;
