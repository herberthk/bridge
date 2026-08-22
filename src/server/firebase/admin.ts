import { getApps, initializeApp, cert, type App, type ServiceAccount } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

/**
 * Admin SDK singletons. Prefer the exported accessor functions over importing
 * this module's internals directly; everything is lazy so importing never
 * triggers credential parsing at build time.
 */

function parseServiceAccount(): ServiceAccount | undefined {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
  if (!raw) return undefined;
  try {
    const json = raw.startsWith("{")
      ? raw
      : Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(json) as ServiceAccount;
    if (!parsed.projectId || !parsed.clientEmail || !parsed.privateKey) {
      throw new Error("missing projectId/clientEmail/privateKey");
    }
    return parsed;
  } catch (err) {
    throw new Error(
      `Invalid FIREBASE_SERVICE_ACCOUNT_KEY: ${err instanceof Error ? err.message : err}`,
    );
  }
}

export function getAdminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  const serviceAccount = parseServiceAccount();
  // Without an explicit credential, the SDK falls back to Application
  // Default Credentials (works on GCP/CI via GOOGLE_APPLICATION_CREDENTIALS).
  return initializeApp(
    serviceAccount ? { credential: cert(serviceAccount) } : undefined,
  );
}

/** Admin Auth — token verification, user provisioning, custom claims. */
export function adminAuth() {
  return getAuth(getAdminApp());
}

/** Admin Firestore — all server-side database access. */
export function adminDb() {
  return getFirestore(getAdminApp());
}

/** Admin Storage — proctoring recordings and uploaded documents. */
export function adminStorage() {
  return getStorage(getAdminApp());
}
