import { FieldValue } from "firebase-admin/firestore";

import { auditLogsCol } from "@/server/firebase/collections";
import type { Role } from "@/lib/constants";
import type { LoginMeta } from "@/types/firestore";

export interface AuditEntry {
  actorId: string | null;
  actorRole: Role | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  meta?: Record<string, unknown> | null;
  context?: LoginMeta | null;
}

/** Append-only audit trail. Never throws into the caller's flow. */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await auditLogsCol().add({
      actorId: entry.actorId,
      actorRole: entry.actorRole,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      meta: entry.meta ?? null,
      ip: entry.context?.ip ?? null,
      userAgent: entry.context?.userAgent ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error("[audit] failed to write entry", entry.action, err);
  }
}
