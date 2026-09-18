import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This project also ships a Cloudflare Workers build (vinext + Vite, see
// vite.config.ts / package.json's `dev`/`build`/`start` scripts) that imports
// real Cloudflare bindings through `lib/runtime.ts`. The Next.js build below
// (`dev:local`/`build:local`/`start:local`) is the on-prem/local-server
// target, so it swaps that import for the SQLite + local-filesystem shim in
// `lib/runtime.local.ts` instead.
const dirname = path.dirname(fileURLToPath(import.meta.url));
const runtimeLocalPath = path.resolve(dirname, "lib/runtime.local.ts");

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      "@/lib/runtime": "./lib/runtime.local.ts",
    },
  },
  webpack: (config) => {
    config.resolve.alias["@/lib/runtime"] = runtimeLocalPath;
    return config;
  },
};

export default nextConfig;
