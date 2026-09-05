/**
 * Finalize attempts stranded in "submitted" with a score already written.
 *
 * Before synchronous finalization, objective-only submits wrote their score
 * but kept status "submitted" — and the AI service (the sole writer of
 * "graded") never ran for them. Those attempts show "Grading…" forever and
 * are invisible to leaderboards and retake eligibility, which filter on
 * status.
 *
 * Run once per existing environment:
 *   bun --env-file=.env.local scripts/backfill-finalize-submitted-attempts.ts
 *
 * The migration is idempotent: only docs with status "submitted" AND a
 * non-null score are touched. Genuinely awaiting-AI attempts (score null)
 * are left alone for the grading path.
 */

import { FieldValue, FieldPath, type QueryDocumentSnapshot } from "firebase-admin/firestore";

import { adminDb } from "@/server/firebase/admin";
import { attemptsCol } from "@/server/firebase/collections";
import type { AttemptDoc } from "@/types/firestore";

const PAGE_SIZE = 400;

async function main() {
  // Typed accessor per repo convention (converters + single-field query shape
  // declared in firestore.indexes.json — equality on `status` plus document-id
  // ordering needs no composite index).
  let cursor: QueryDocumentSnapshot<AttemptDoc> | null = null;
  let updated = 0;
  let scanned = 0;

  for (;;) {
    let query = attemptsCol()
      .where("status", "==", "submitted")
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    scanned += page.size;
    if (page.empty) break;

    const batch = adminDb().batch();
    let batchSize = 0;
    for (const doc of page.docs) {
      const data = doc.data();
      // Score present = grading actually finished; only the status is wrong.
      if (data.score === null || data.score === undefined) continue;
      batch.update(doc.ref, {
        status: "graded",
        // Preserve an existing timestamp; stamp one where submit never wrote it.
        ...(data.gradedAt ? {} : { gradedAt: FieldValue.serverTimestamp() }),
        updatedAt: FieldValue.serverTimestamp(),
      });
      batchSize += 1;
    }
    if (batchSize > 0) {
      await batch.commit();
      updated += batchSize;
    }

    if (page.size < PAGE_SIZE) break;
    cursor = page.docs.at(-1) ?? null;
    if (!cursor) break;
  }

  console.log(`Backfill complete: scanned ${scanned}, finalized ${updated} attempt(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
