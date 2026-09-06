/**
 * Grant pre-privilege teachers the class-creation right they always had.
 *
 * New teachers are created with `canCreateClasses: false`, but accounts that
 * predate the flag have no field — and the server gate treats a missing flag
 * as allowed. This script stamps those legacy docs `true` explicitly so the
 * roster UI (which renders `!== false` as Allowed) and the data agree.
 *
 * Safety properties:
 * - Only docs where the flag is missing or null are touched: an explicit
 *   `false` means an admin already revoked the right.
 * - Each write runs in its own transaction that re-reads the doc first, so a
 *   revocation landing between the scan and the write aborts the update
 *   instead of clobbering it (optimistic concurrency — no blind overwrites).
 * - Reads are cursor-paged; writes are intentionally serial per doc so one
 *   contention never fails its neighbours.
 *
 * Run once per existing environment:
 *   bun --env-file=.env.local scripts/backfill-teacher-can-create-classes.ts
 * Preview without writing:
 *   bun --env-file=.env.local scripts/backfill-teacher-can-create-classes.ts --dry-run
 *
 * The migration is idempotent.
 */

import {
  FieldPath,
  FieldValue,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";

import { adminDb } from "@/server/firebase/admin";

const PAGE_SIZE = 400;
const DRY_RUN = process.argv.includes("--dry-run");

/**
 * Whether a teacher doc predates the privilege flag and still needs
 * stamping. Pure and unit-tested: anything explicit (including `false`) is
 * an admin's choice and must never be touched here.
 */
export function isLegacyTeacherDoc(flag: unknown): boolean {
  return flag === undefined || flag === null;
}

/**
 * Stamp one teacher doc inside a transaction: the re-read makes a concurrent
 * revocation abort the write instead of being overwritten. Returns what
 * happened for progress reporting.
 */
export async function stampTeacherDoc(
  docRef: FirebaseFirestore.DocumentReference,
): Promise<"updated" | "skipped"> {
  return adminDb().runTransaction(async (tx) => {
    const fresh = await tx.get(docRef);
    if (!isLegacyTeacherDoc(fresh.data()?.canCreateClasses)) return "skipped";
    tx.update(docRef, {
      canCreateClasses: true,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return "updated";
  });
}

async function main() {
  let cursor: QueryDocumentSnapshot | null = null;
  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let listed = 0;

  for (;;) {
    let query = adminDb()
      .collection("users")
      .where("role", "==", "teacher")
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;

    for (const doc of page.docs) {
      scanned++;
      if (!isLegacyTeacherDoc(doc.data().canCreateClasses)) {
        skipped++;
        continue;
      }
      if (DRY_RUN) {
        if (listed < 20) console.log(`  would update ${doc.id}`);
        listed++;
        updated++;
        continue;
      }
      const outcome = await stampTeacherDoc(doc.ref);
      if (outcome === "updated") updated++;
      else skipped++;
    }

    if (page.size < PAGE_SIZE) break;
    cursor = page.docs.at(-1) ?? null;
    if (!cursor) break;
  }

  console.log(
    `Teachers scanned: ${scanned}, ${DRY_RUN ? "would update" : "updated"}: ${updated}, ` +
      `skipped (explicit choice kept): ${skipped}.`,
  );
  if (DRY_RUN) console.log("Dry run — no writes performed.");
}

// Guarded so unit tests can import the pure helpers without running the
// migration (`main` is a Bun runtime extension unknown to TS's ImportMeta).
const isMainEntry = (import.meta as unknown as { main?: unknown }).main === true;
if (isMainEntry) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Backfill failed:", err);
      process.exit(1);
    });
}
