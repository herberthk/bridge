import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";

import {
  generateInviteToken,
  hashInviteToken,
  isInviteExpired,
} from "@/server/services/invites";

describe("invite tokens", () => {
  it("generates URL-safe tokens with reasonable entropy", () => {
    const token = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    // 24 random bytes → 32 base64url chars.
    expect(token.length).toBe(32);
  });

  it("generates unique tokens", () => {
    const seen = new Set(Array.from({ length: 100 }, () => generateInviteToken()));
    expect(seen.size).toBe(100);
  });

  it("hashes deterministically as sha-256 hex", () => {
    const hash = hashInviteToken("token-value");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashInviteToken("token-value")).toBe(hash);
    expect(hashInviteToken("token-value-2")).not.toBe(hash);
  });

  it("never stores the raw token in the hash", () => {
    const token = generateInviteToken();
    expect(hashInviteToken(token)).not.toContain(token);
  });
});

describe("isInviteExpired", () => {
  it("is expired when the expiry instant has passed", () => {
    const invite = { expiresAt: Timestamp.fromMillis(Date.now() - 1000) };
    expect(isInviteExpired(invite)).toBe(true);
  });

  it("is not expired while the link is live", () => {
    const invite = { expiresAt: Timestamp.fromMillis(Date.now() + 60_000) };
    expect(isInviteExpired(invite)).toBe(false);
  });

  it("treats a missing expiry as expired (fail closed)", () => {
    expect(isInviteExpired({ expiresAt: null })).toBe(true);
    expect(isInviteExpired({ expiresAt: undefined })).toBe(true);
  });
});
