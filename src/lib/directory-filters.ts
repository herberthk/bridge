import type { UserStatus } from "@/lib/constants";

const DIRECTORY_STATUSES = new Set<UserStatus>(["active", "suspended", "banned"]);

export function normalizeDirectoryStatus(value: string | null | undefined): UserStatus | null {
  return DIRECTORY_STATUSES.has(value as UserStatus) ? (value as UserStatus) : null;
}

export function normalizeDirectorySchool(
  value: string | null | undefined,
  schools: ReadonlyArray<{ id: string }>,
): string | null {
  return value && schools.some((school) => school.id === value) ? value : null;
}
