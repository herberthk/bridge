import {
  getPaymentProvider,
  registerPaymentProvider,
  type PaymentProvider,
  type TopupCheckoutInput,
  type TopupCheckoutSession,
} from "./provider";

/**
 * Simulated gateway — lets the pay-as-you-go flow run end to end (top-up
 * record → checkout session → confirmation → wallet credit + ledger) until a
 * real provider (Flutterwave / Stripe / MTN MoMo) is registered.
 *
 * The "hosted checkout" is an in-app page that mimics a hosted payment page;
 * swapping in a real provider only replaces `createTopupCheckout`'s redirect.
 */

export const MOCK_PROVIDER_ID = "mock";

function randomRef(): string {
  return `mock_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

const mockProvider: PaymentProvider = {
  id: MOCK_PROVIDER_ID,
  label: "Simulated checkout",
  supportedCurrencies: ["UGX", "USD"],
  async createTopupCheckout(input: TopupCheckoutInput): Promise<TopupCheckoutSession> {
    const providerRef = randomRef();
    const url = new URL(input.successUrl);
    url.searchParams.set("ref", providerRef);
    return { redirectUrl: url.toString(), providerRef };
  },
  async parseWebhook() {
    // The mock flow confirms in-app; webhooks only apply to real gateways.
    return null;
  },
};

let registered = false;

/** Idempotently register the mock provider and return it. */
export function ensureMockProvider(): PaymentProvider {
  if (!registered) {
    registerPaymentProvider(mockProvider);
    registered = true;
  }
  return getPaymentProvider(MOCK_PROVIDER_ID)!;
}
