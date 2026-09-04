import type { SchoolLevel } from "@/lib/constants";
import type { UserDoc } from "@/types/firestore";

/**
 * Class scope for the assign-exam modal — and the rule the server enforces.
 *
 * An exam belongs to exactly one class (`ExamDoc.classId`, stamped at
 * generation — both generation pages and `resolveExamClassId` refuse
 * class-less requests for school staff). The modal therefore lists only that
 * class's students, so a Senior One paper can never be handed to Senior Two.
 *
 * Pure and DOM-free on purpose: the dialog and its test suite share it.
 */

type ScopeExam = {
  classId: string | null;
  params: { level: SchoolLevel | null; classLevel: number | null };
};

type ScopeStudent = { id: string } & Pick<
  UserDoc,
  "classId" | "level" | "classLevel"
>;

/**
 * Whether a student may be shown (and selected) for an exam.
 *
 * - Already-assigned students always pass, so earlier work never vanishes from
 *   the roster when a class changes around it.
 * - Class exams (`classId` set — the only kind staff can generate) require an
 *   exact `classId` match. A student with no class is never in scope.
 * - Class-less legacy / super-admin exams fall back to the grade level, the
 *   same `level` + `classLevel` comparison the modal historically used.
 */
export function isStudentInExamScope(
  student: ScopeStudent,
  exam: ScopeExam,
  assignedIds?: ReadonlySet<string> | readonly string[],
): boolean {
  const assigned =
    assignedIds instanceof Set ? assignedIds : new Set(assignedIds ?? []);
  if (assigned.has(student.id)) return true;
  if (exam.classId) return student.classId === exam.classId;
  if (exam.params.level === null || exam.params.classLevel === null) return false;
  return (
    student.level === exam.params.level &&
    student.classLevel === exam.params.classLevel
  );
}
