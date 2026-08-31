import { getApps, initializeApp, cert, type App, type ServiceAccount } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

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
  const serviceAccount = fromIndividualFields();
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  // Without an explicit credential, the SDK falls back to Application
  // Default Credentials (works on GCP/CI via GOOGLE_APPLICATION_CREDENTIALS).
  return initializeApp({
    ...(serviceAccount ? { credential: cert(serviceAccount) } : {}),
    ...(storageBucket ? { storageBucket } : {}),
  });
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
