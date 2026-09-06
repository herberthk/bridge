/**
 * Grant pre-privilege teachers the class-creation right they always had.
 *
 * New teachers are created with `canCreateClasses: false`, but accounts that
 * predate the flag have no field — and the server gate treats a missing flag
 * as allowed. This script stamps those legacy docs `true` explicitly so the
 * roster UI (which renders `!== false` as Allowed) and the data agree.
 *
 * Only docs where the flag is missing or null are touched: an explicit
 * `false` means an admin already revoked the right, and re-granting it here
 * would silently undo that decision.
 *
 * Run once per existing environment:
 *   bun --env-file=.env.local scripts/backfill-teacher-can-create-classes.ts
 * Preview without writing:
 *   bun --env-file=.env.local scripts/backfill-teacher-can-create-classes.ts --dry-run
 *
 * The migration is idempotent.
 */

import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/server/firebase/admin";

const PAGE_SIZE = 400;
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const snap = await adminDb()
    .collection("users")
    .where("role", "==", "teacher")
    .get();

  const targets = snap.docs.filter((d) => {
    const flag = d.data().canCreateClasses;
    return flag === undefined || flag === null;
  });
  const skippedExplicit = snap.docs.filter((d) => {
    const flag = d.data().canCreateClasses;
    return flag === true || flag === false;
  }).length;
  console.log(
    `Teachers: ${snap.size}, to update: ${targets.length}, ` +
      `skipped (explicit choice kept): ${skippedExplicit}.`,
  );
  if (DRY_RUN) {
    for (const doc of targets.slice(0, 20)) {
      console.log(`  would update ${doc.id}`);
    }
    if (targets.length > 20) console.log(`  …and ${targets.length - 20} more`);
    console.log("Dry run — no writes performed.");
    return;
  }

  for (let offset = 0; offset < targets.length; offset += PAGE_SIZE) {
    const batch = adminDb().batch();
    for (const doc of targets.slice(offset, offset + PAGE_SIZE)) {
      batch.update(doc.ref, {
        canCreateClasses: true,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }

  console.log(`Backfill complete: ${targets.length} teacher(s) updated.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
