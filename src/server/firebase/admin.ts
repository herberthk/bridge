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
  if (!raw) return fromIndividualFields();
  try {
    // Accept: raw JSON (single line or multi-line after whitespace squash),
    // or the same JSON base64-encoded.
    const json = raw.startsWith("{")
      ? raw
      : Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(json) as ServiceAccount;
    if (!parsed.projectId || !parsed.clientEmail || !parsed.privateKey) {
      throw new Error("missing projectId/clientEmail/privateKey");
    }
    return parsed;
  } catch (err) {
    const hint =
      err instanceof Error ? err.message : String(err);
    throw new Error(
      `Invalid FIREBASE_SERVICE_ACCOUNT_KEY (${hint}). Paste the service-account JSON on ONE line, wrap the whole multi-line JSON in single quotes, or base64-encode it — see .env.example.`,
    );
  }
}

/** Fallback: individual fields (FIREBASE_PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY). */
function fromIndividualFields(): ServiceAccount | undefined {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) return undefined;
  return { projectId, clientEmail, privateKey };
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
