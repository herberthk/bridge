/**
 * Pure, unit-tested helpers for admin surfaces.
 *
 * Kept free of React/Firestore imports so they run in any runtime and stay
 * cheap to test. Client views memoize over these instead of inlining logic.
 */

export const ADMIN_AVATAR_COLORS = [
  "bg-violet-500",
  "bg-blue-500",
  "bg-cyan-500",
  "bg-emerald-500",
  "bg-orange-500",
  "bg-pink-500",
  "bg-indigo-500",
  "bg-teal-500",
] as const;

/** Deterministic avatar background for a stable id (no randomness). */
export function getAvatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) & 0xffffffff;
  }
  return ADMIN_AVATAR_COLORS[Math.abs(hash) % ADMIN_AVATAR_COLORS.length];
}

/** "Mary Atieno" -> "MA". Handles single names and blank input safely. */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export interface TeacherLike {
  displayName?: string | null;
  email?: string | null;
}

/** Case-insensitive substring match over name + email. Trims the query. */
export function filterTeachers<T extends TeacherLike>(
  teachers: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...teachers];
  return teachers.filter((t) => {
    const name = (t.displayName ?? "").toLowerCase();
    const email = (t.email ?? "").toLowerCase();
    return name.includes(q) || email.includes(q);
  });
}

export interface SchoolProfileLike {
  name?: string | null;
  motto?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  registrationNumber?: string | null;
  description?: string | null;
}

/** Minimal actor shape for workspace gating — avoids importing auth types. */
export interface WorkspaceActorLike {
  role: string;
  schoolId?: string | null;
}

/**
 * Whether the onboarding card applies. School-admin workspaces (role admin +
 * schoolId) invite teachers and create classes; standalone instructor
 * workspaces can't — both server paths 403 without a schoolId.
 */
export function isSchoolAdminWorkspace(actor: WorkspaceActorLike): boolean {
  return actor.role === "admin" && Boolean(actor.schoolId);
}

export interface LedgerTxLike {
  type: string;
  tokensDelta: number;
}

/**
 * Consumption for counts + "Deductions only" filter. `type === "consumption"`
 * is the source of truth so zero-token voice sessions (billed by minutes,
 * `tokensDelta: 0`) count; `tokensDelta < 0` catches negative adjustments
 * whose type is "adjustment".
 */
export function isConsumptionTransaction(tx: LedgerTxLike): boolean {
  return tx.type === "consumption" || tx.tokensDelta < 0;
}

/**
 * Credits for the "Credits only" filter. Zero-token consumption rows must not
 * leak into credits: a voice session with `tokensDelta: 0` is consumption,
 * not a top-up.
 */
export function isCreditTransaction(tx: LedgerTxLike): boolean {
  if (tx.type === "consumption") return false;
  return tx.type === "topup" || tx.type === "refund" || tx.tokensDelta > 0;
}

export interface ProfileCompleteness {
  completed: number;
  total: number;
  percent: number;
  missing: string[];
}

/**
 * Profile strength meter for the school page. Counts the seven public
 * fields; returns a 0-100 percent plus human-readable missing labels so the
 * view can render next-step guidance without extra logic.
 */
export function getSchoolProfileCompleteness(
  school: SchoolProfileLike,
): ProfileCompleteness {
  const fields: Array<{ key: string; label: string; filled: boolean }> = [
    { key: "name", label: "School name", filled: Boolean(school.name?.trim()) },
    { key: "motto", label: "Motto", filled: Boolean(school.motto?.trim()) },
    { key: "phone", label: "Phone", filled: Boolean(school.phone?.trim()) },
    {
      key: "email",
      label: "Contact email",
      filled: Boolean(school.email?.trim()),
    },
    { key: "address", label: "Address", filled: Boolean(school.address?.trim()) },
    {
      key: "registrationNumber",
      label: "Registration number",
      filled: Boolean(school.registrationNumber?.trim()),
    },
    {
      key: "description",
      label: "Description",
      filled: Boolean(school.description?.trim()),
    },
  ];
  const completed = fields.filter((f) => f.filled).length;
  const total = fields.length;
  const percent = Math.round((completed / total) * 100);
  return {
    completed,
    total,
    percent,
    missing: fields.filter((f) => !f.filled).map((f) => f.label),
  };
}
