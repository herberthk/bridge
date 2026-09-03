/**
 * Backfill normalized directory names and retake provenance before deploying
 * queries that depend on those fields.
 *
 * Run once per existing environment:
 *   bun --env-file=.env.local scripts/backfill-directory-retake-fields.ts
 *
 * The migration is idempotent. Retake audit records provide the authoritative
 * provenance where available; older records fall back to matching the request
 * decision time and actor.
 */

import {
  FieldPath,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";

import { adminDb } from "@/server/firebase/admin";

const PAGE_SIZE = 400;

async function readCollection(name: string): Promise<QueryDocumentSnapshot[]> {
  const documents: QueryDocumentSnapshot[] = [];
  let cursor: QueryDocumentSnapshot | null = null;
  while (true) {
    let query = adminDb()
      .collection(name)
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    documents.push(...page.docs);
    if (page.size < PAGE_SIZE) return documents;
    cursor = page.docs.at(-1) ?? null;
    if (!cursor) return documents;
  }
}

async function applyUpdates(
  updates: { doc: QueryDocumentSnapshot; data: DocumentData }[],
): Promise<void> {
  for (let offset = 0; offset < updates.length; offset += PAGE_SIZE) {
    const batch = adminDb().batch();
    for (const update of updates.slice(offset, offset + PAGE_SIZE)) {
      batch.update(update.doc.ref, update.data);
    }
    await batch.commit();
  }
}

function millis(value: unknown): number | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "toMillis" in value &&
    typeof value.toMillis === "function"
  ) {
    return value.toMillis() as number;
  }
  return null;
}

async function main() {
  const [users, schools, attempts, requests, auditLogs] = await Promise.all([
    readCollection("users"),
    readCollection("schools"),
    readCollection("attempts"),
    readCollection("retake_requests"),
    readCollection("audit_logs"),
  ]);

  const approvedByAttempt = new Map<string, string>();
  const grantedAttempts = new Set<string>();
  for (const audit of auditLogs) {
    const data = audit.data();
    const newAttemptId = data.meta?.newAttemptId;
    if (typeof newAttemptId !== "string") continue;
    if (data.action === "retake.approved" && typeof data.targetId === "string") {
      approvedByAttempt.set(newAttemptId, data.targetId);
    } else if (data.action === "retake.granted") {
      grantedAttempts.add(newAttemptId);
    }
  }

  const approvedRequestsByOriginal = new Map<
    string,
    { id: string; decidedBy: string | null; decidedAt: number | null }[]
  >();
  for (const request of requests) {
    const data = request.data();
    if (data.status !== "approved" || typeof data.attemptId !== "string") continue;
    const list = approvedRequestsByOriginal.get(data.attemptId) ?? [];
    list.push({
      id: request.id,
      decidedBy: typeof data.decidedBy === "string" ? data.decidedBy : null,
      decidedAt: millis(data.decidedAt),
    });
    approvedRequestsByOriginal.set(data.attemptId, list);
  }

  const updates: { doc: QueryDocumentSnapshot; data: DocumentData }[] = [];
  for (const user of users) {
    const displayName = user.data().displayName;
    if (typeof displayName === "string" && user.data().displayNameLower !== displayName.toLowerCase()) {
      updates.push({ doc: user, data: { displayNameLower: displayName.toLowerCase() } });
    }
  }
  for (const school of schools) {
    const name = school.data().name;
    if (typeof name === "string" && school.data().nameLower !== name.toLowerCase()) {
      updates.push({ doc: school, data: { nameLower: name.toLowerCase() } });
    }
  }

  for (const attempt of attempts) {
    const data = attempt.data();
    if (!data.retakeOf || data.retakeSource === "request" || data.retakeSource === "direct") {
      continue;
    }

    const auditedRequestId = approvedByAttempt.get(attempt.id);
    let requestId = auditedRequestId ?? null;
    if (!requestId && !grantedAttempts.has(attempt.id)) {
      const createdAt = millis(data.createdAt);
      const candidates = approvedRequestsByOriginal.get(data.retakeOf) ?? [];
      const matched = candidates.find(
        (request) =>
          request.decidedBy === data.retakeAuthorizedBy &&
          request.decidedAt !== null &&
          createdAt !== null &&
          Math.abs(request.decidedAt - createdAt) <= 5 * 60_000,
      );
      requestId = matched?.id ?? null;
    }

    updates.push({
      doc: attempt,
      data: requestId
        ? { retakeSource: "request", retakeRequestId: requestId }
        : { retakeSource: "direct", retakeRequestId: null },
    });
  }

  await applyUpdates(updates);
  console.log(`Backfill complete: ${updates.length} document(s) updated.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
