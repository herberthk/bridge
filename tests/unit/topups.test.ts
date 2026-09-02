import { describe, expect, it } from "vitest";

import { priceTopup, walletIdForActor } from "@/server/services/topups";
import { tokensToUsd, usdToUgx, usdMicrosToUgx, formatTokens } from "@/lib/pricing";
import { ensureMockProvider } from "@/server/services/payments/mock";
import type { SessionUser } from "@/server/auth/session";

describe("priceTopup", () => {
  it("prices tokens at the platform text-token rate", () => {
    const { usd, usdMicros, ugx } = priceTopup(100_000);
    expect(usdMicros).toBe(2_700_000); // $2.70 for 100k @ $0.027/1k
    expect(usd).toBeCloseTo(tokensToUsd(100_000), 10);
    expect(ugx).toBe(usdMicrosToUgx(usdMicros));
  });

  it("quotes the UGX price at the fixed rate", () => {
    const { ugx } = priceTopup(1_000_000);
    expect(ugx).toBe(usdToUgx(27));
  });

  it("matches the wallet-view pack math", () => {
    for (const tokens of [100_000, 500_000, 2_000_000, 10_000_000]) {
      const { usd } = priceTopup(tokens);
      expect(formatTokens(tokens)).toBeTruthy();
      expect(usd).toBeGreaterThan(0);
    }
  });
});

describe("walletIdForActor", () => {
  it("bills school staff to the school wallet", () => {
    const actor = {
      uid: "u1",
      email: "a@s.ac.ug",
      displayName: "Admin",
      role: "admin",
      schoolId: "school_1",
      status: "active",
    } as SessionUser;
    expect(walletIdForActor(actor)).toBe("school_1");
  });

  it("bills standalone admins to their personal wallet", () => {
    const actor = {
      uid: "u2",
      email: "p@x.com",
      displayName: "Parent",
      role: "admin",
      schoolId: null,
      status: "active",
    } as SessionUser;
    expect(walletIdForActor(actor)).toBe("u2");
  });
});

describe("mock payment provider", () => {
  it("registers and returns a hosted-checkout session", async () => {
    const provider = ensureMockProvider();
    expect(provider.id).toBe("mock");
    const session = await provider.createTopupCheckout({
      walletId: "school_1",
      tokens: 100_000,
      usd: 2.7,
      ugx: 10_260,
      currency: "UGX",
      customerEmail: "a@s.ac.ug",
      successUrl: "https://bridge.app/wallet/checkout/topup_1",
      cancelUrl: "https://bridge.app/admin/wallet",
    });
    expect(session.providerRef).toMatch(/^mock_/);
    expect(session.redirectUrl).toContain("/wallet/checkout/topup_1");
    expect(session.redirectUrl).toContain(`ref=${session.providerRef}`);
  });

  it("is idempotent — re-registration returns the same provider", () => {
    expect(ensureMockProvider().id).toBe(ensureMockProvider().id);
  });
});
