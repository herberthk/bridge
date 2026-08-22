"use client";

import { getApp, getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth as fbGetAuth,
  type Auth,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore as fbGetFirestore,
  type Firestore,
} from "firebase/firestore";
import {
  connectStorageEmulator,
  getStorage as fbGetStorage,
  type FirebaseStorage,
} from "firebase/storage";

/**
 * Client SDK singletons — lazily initialized so importing this module never
 * triggers Firebase setup during prerender. Emulators are wired when
 * NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true (see .env.example).
 */

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let emulatorsConnected = false;

function app() {
  const existing = getApps();
  return existing.length ? getApp() : initializeApp(firebaseConfig);
}

function connectEmulators(auth: Auth, db: Firestore, storage: FirebaseStorage) {
  if (emulatorsConnected || process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== "true") {
    return;
  }
  emulatorsConnected = true;
  try {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    connectStorageEmulator(storage, "127.0.0.1", 9199);
  } catch {
    // Already connected (HMR) — safe to ignore.
  }
}

let authCache: Auth | null = null;
let dbCache: Firestore | null = null;
let storageCache: FirebaseStorage | null = null;

export function authClient(): Auth {
  if (!authCache) {
    authCache = fbGetAuth(app());
    if (!firebaseConfig.apiKey) {
      console.warn(
        "[bridge] Firebase config missing — copy .env.example to .env.local and fill in the NEXT_PUBLIC_FIREBASE_* values.",
      );
    }
    connectEmulators(authCache, fbGetFirestore(app()), fbGetStorage(app()));
  }
  return authCache;
}

export function dbClient(): Firestore {
  if (!dbCache) {
    dbCache = fbGetFirestore(app());
    connectEmulators(fbGetAuth(app()), dbCache, fbGetStorage(app()));
  }
  return dbCache;
}

export function storageClient(): FirebaseStorage {
  if (!storageCache) {
    storageCache = fbGetStorage(app());
    connectEmulators(fbGetAuth(app()), fbGetFirestore(app()), storageCache);
  }
  return storageCache;
}
