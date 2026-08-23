import { describe, expect, it } from "vitest";

import {
  estimateGenerationTokens,
  estimateGradingTokens,
  formatUgx,
  formatUsd,
  textTokensToMicros,
  tokensToUsd,
  usdMicrosToUgx,
  usdToUgx,
  voiceMinutesToMicros,
  voiceMinutesToUsd,
  TOPUP_PACKS,
} from "@/lib/pricing";
import { BILLING } from "@/lib/constants";

describe("pricing: text tokens", () => {
  it("charges $0.027 per 1,000 tokens (27 micros/token)", () => {
    expect(textTokensToMicros(1000)).toBe(27_000);
    expect(tokensToUsd(1000)).toBeCloseTo(0.027, 6);
  });

  it("scales linearly", () => {
    expect(textTokensToMicros(100_000)).toBe(2_700_000);
    expect(tokensToUsd(1_000_000)).toBeCloseTo(27, 6);
  });

  it("rounds fractional tokens to whole micros", () => {
    expect(textTokensToMicros(0.5)).toBe(14);
    expect(textTokensToMicros(1)).toBe(27);
  });
});

describe("pricing: voice minutes", () => {
  it("charges $0.08 per minute", () => {
    expect(voiceMinutesToMicros(1)).toBe(80_000);
    expect(voiceMinutesToUsd(10)).toBeCloseTo(0.8, 6);
  });

  it("handles fractional minutes", () => {
    expect(voiceMinutesToMicros(1.5)).toBe(120_000);
    expect(voiceMinutesToUsd(0.25)).toBeCloseTo(0.02, 6);
  });
});

describe("pricing: UGX conversion", () => {
  it("uses the configured 3,800 rate", () => {
    expect(BILLING.ugxPerUsd).toBe(3800);
    expect(usdToUgx(1)).toBe(3800);
    expect(usdToUgx(10)).toBe(38_000);
  });

  it("converts micro-dollars without float drift", () => {
    expect(usdMicrosToUgx(1_000_000)).toBe(3800);
    expect(usdMicrosToUgx(27_000)).toBe(103); // 0.027 USD → 102.6 → 103
  });

  it("formats currency for display", () => {
    expect(formatUgx(47500)).toBe("UGX 47,500");
    expect(formatUsd(0.027)).toBe("$0.03");
    expect(formatUsd(1234.5)).toBe("$1,234.50");
  });
});

describe("pricing: estimates", () => {
  it("grows with question count and document grounding", () => {
    const small = estimateGenerationTokens(10, false);
    const large = estimateGenerationTokens(50, false);
    const grounded = estimateGenerationTokens(10, true);
    expect(large).toBeGreaterThan(small);
    expect(grounded).toBeGreaterThan(small);
  });

  it("grading estimate grows with answers", () => {
    expect(estimateGradingTokens(20)).toBeGreaterThan(estimateGradingTokens(5));
  });
});

describe("pricing: top-up packs", () => {
  it("exposes ascending packs", () => {
    const tokens = TOPUP_PACKS.map((p) => p.tokens);
    expect(tokens).toEqual([...tokens].sort((a, b) => a - b));
    expect(tokens.length).toBeGreaterThan(2);
  });
});
