// Cloudflare Workers target (used by `npm run dev` / `npm run build` via vinext + Vite).
// The on-prem / local-server target (`npm run dev:local` / `npm run build:local`
// via Next.js) never bundles this file — `next.config.ts` aliases every
// `@/lib/runtime` import to `lib/runtime.local.ts` instead, so this file only
// needs to satisfy the Cloudflare build.
export { env } from "cloudflare:workers";
