import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminDb } = vi.hoisted(() => ({ adminDb: vi.fn() }));

vi.mock("@/server/firebase/admin", () => ({ adminDb }));

import {
  isLegacyTeacherDoc,
  stampTeacherDoc,
} from "../../scripts/backfill-teacher-can-create-classes";

describe("isLegacyTeacherDoc", () => {
  it("selects only docs missing the flag", () => {
    expect(isLegacyTeacherDoc(undefined)).toBe(true);
    expect(isLegacyTeacherDoc(null)).toBe(true);
  });

  it("keeps every explicit choice untouched", () => {
    expect(isLegacyTeacherDoc(true)).toBe(false);
    expect(isLegacyTeacherDoc(false)).toBe(false);
    expect(isLegacyTeacherDoc(0)).toBe(false);
    expect(isLegacyTeacherDoc("")).toBe(false);
  });
});

describe("stampTeacherDoc", () => {
  const update = vi.fn();

  function runTransactionWith(flag: unknown) {
    adminDb.mockReturnValue({
      runTransaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          get: vi.fn().mockResolvedValue({ data: () => ({ canCreateClasses: flag }) }),
          update,
        }),
      ),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stamps a doc that is still legacy at write time", async () => {
    runTransactionWith(undefined);

    await expect(stampTeacherDoc({} as never)).resolves.toBe("updated");
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]![1]).toMatchObject({ canCreateClasses: true });
  });

  it("skips instead of clobbering a concurrent revocation", async () => {
    // The scan saw a legacy doc, but an admin revoked it before the write:
    // the transactional re-read observes `false` and must not overwrite it.
    runTransactionWith(false);

    await expect(stampTeacherDoc({} as never)).resolves.toBe("skipped");
    expect(update).not.toHaveBeenCalled();
  });

  it("skips docs already granted", async () => {
    runTransactionWith(true);

    await expect(stampTeacherDoc({} as never)).resolves.toBe("skipped");
    expect(update).not.toHaveBeenCalled();
  });
});
