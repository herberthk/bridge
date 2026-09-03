import { classDoc, schoolDoc } from "@/server/firebase/collections";
import type { SessionUser } from "@/server/auth/session";
import type { GenerateExamInput } from "@/lib/schemas/exam";
import { ExamsServiceError } from "./errors";

/**
 * Validate generation scope and resolve the class the exam attaches to.
 *
 * Runs before the affordability check so authorization errors surface before
 * billing ones. Returns the class id, or null for the class-less path kept by
 * super admins and school-less admins (who operate outside any class roster).
 *
 * Class scoping: school staff generate only from a class — teachers from one
 * they manage, admins from any class of their school. The class pins the
 * exam's level and year.
 */
export async function resolveExamClassId(
  actor: SessionUser,
  input: Pick<GenerateExamInput, "classId" | "params">,
): Promise<string | null> {
  if (input.classId) {
    const classSnap = await classDoc(input.classId).get();
    if (!classSnap.exists) throw new ExamsServiceError("Class not found.", 404);
    const cls = classSnap.data()!;
    if (actor.schoolId && cls.schoolId !== actor.schoolId) {
      throw new ExamsServiceError("This class belongs to another school.", 403);
    }
    if (actor.role === "teacher" && !(cls.teacherIds ?? []).includes(actor.uid)) {
      throw new ExamsServiceError("You are not assigned to this class.", 403);
    }
    if (cls.level !== input.params.level || cls.classLevel !== input.params.classLevel) {
      throw new ExamsServiceError(
        "Exam level/class doesn't match the selected class.",
        400,
      );
    }
    return input.classId;
  }
  if (actor.role === "teacher") {
    // A class-less exam could never be assigned by a teacher (assignment is
    // restricted to their exam's class), so require the class up front.
    throw new ExamsServiceError(
      "Teachers generate exams from a class — open one of your classes and generate there.",
      403,
    );
  }
  if (actor.role === "admin" && actor.schoolId) {
    // Same class-first rule for school admins: every entry point lives inside
    // a class dashboard, so a class-less request is a stale link or a forged
    // call — refuse it before any wallet movement.
    throw new ExamsServiceError(
      "Generate exams from a class — open one of your school's classes and generate there.",
      403,
    );
  }
  if (actor.schoolId) {
    // A school chose primary OR secondary at creation; its exams can't cross
    // that line even when generated outside a class dashboard.
    const schoolSnap = await schoolDoc(actor.schoolId).get();
    if (schoolSnap.exists && schoolSnap.data()!.level !== input.params.level) {
      throw new ExamsServiceError(
        `This exam is for a ${input.params.level} class, but your school is a ${schoolSnap.data()!.level} school.`,
        400,
      );
    }
  }
  return null;
}
