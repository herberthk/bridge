"use client";

import { useEffect } from "react";

/**
 * Registers the Serwist service worker in production. In development it does
 * the opposite: any service worker left over from a previous production build
 * (`bun run build` → `bun run start`) would precache stale chunk URLs that
 * 404 under `next dev` and serve mixed old/new code — so we unregister every
 * worker and drop its caches to self-heal the origin.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }

    if (process.env.NODE_ENV !== "production") {
      void (async () => {
        const registrations = await navigator.serviceWorker
          .getRegistrations()
          .catch(() => []);
        await Promise.all(registrations.map((r) => r.unregister()));
        if (window.caches) {
          const keys = await caches.keys().catch(() => [] as string[]);
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      })();
      return;
    }

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .catch((err) => console.warn("SW registration failed:", err));
    };
    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
