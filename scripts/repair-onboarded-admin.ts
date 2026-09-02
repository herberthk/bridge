/**
 * One-off repair for accounts stuck mid-onboarding by the pre-fix promotion
 * bug: custom claims were updated to admin but the user profile doc (and the
 * session) still said "member", so /admin kept bouncing back to /onboarding.
 *
 * Run: bun --env-file=.env.local scripts/repair-onboarded-admin.ts user@email.com
 *
 * Finds the school owned by the user (ownerUid) — falling back to the schoolId
 * already baked into their claims — then aligns the profile doc and claims to
 * role "admin". Sign out and back in afterwards to get a fresh session cookie.
 */

import { adminAuth } from "@/server/firebase/admin";
import { schoolDoc, schoolsCol, userDoc } from "@/server/firebase/collections";
import { FieldValue } from "firebase-admin/firestore";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error("Usage: bun --env-file=.env.local scripts/repair-onboarded-admin.ts <email>");
    process.exit(1);
  }

  const authUser = await adminAuth().getUserByEmail(email).catch(() => null);
  if (!authUser) {
    console.error(`No Auth user found for ${email}.`);
    process.exit(1);
  }

  const claims = authUser.customClaims ?? {};
  console.log(`User ${authUser.uid} (${email}) — claims:`, claims);

  // The school they own wins; claims are a fallback for a half-applied run.
  let schoolId = (claims.schoolId as string | null) ?? null;
  const owned = await schoolsCol().where("ownerUid", "==", authUser.uid).limit(1).get();
  if (!owned.empty) schoolId = owned.docs[0]!.id;

  if (!schoolId) {
    console.error("No school found for this user (neither owned nor claimed). Nothing to repair.");
    process.exit(1);
  }

  const schoolSnap = await schoolDoc(schoolId).get();
  if (!schoolSnap.exists) {
    console.error(`School ${schoolId} does not exist. Nothing to repair.`);
    process.exit(1);
  }
  console.log(`Repairing into school: ${schoolSnap.data()!.name} (${schoolId})`);

  await userDoc(authUser.uid).update({
    role: "admin",
    schoolId,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await adminAuth().setCustomUserClaims(authUser.uid, {
    role: "admin",
    schoolId,
  });

  console.log("Done. Profile doc + claims now say admin. Sign out and sign back in to mint a fresh session cookie.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Repair failed:", err);
    process.exit(1);
  });
