import { serwist } from "@serwist/next/config";

/**
 * Serwist configurator mode: the service worker is built by `serwist build`
 * (run after `next build` — see package.json), keeping Turbopack builds clean.
 * Dev never builds the SW: `bun run dev` doesn't invoke this config.
 */
export default serwist({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
});
