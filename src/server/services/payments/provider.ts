/**
 * Payment gateway abstraction — "gateway-ready" seam for the future.
 *
 * Today the platform runs on manual top-ups (Super Admin credits wallets).
 * To plug in Stripe / Flutterwave / MTN MoMo later: implement
 * PaymentProvider, register it, and add a checkout route that calls
 * `createTopupCheckout`. The wallet/ledger side needs zero changes.
 */

export interface TopupCheckoutInput {
  walletId: string;
  tokens: number;
  /** USD amount for this purchase. */
  usd: number;
  /** UGX equivalent (rounded). */
  ugx: number;
  currency: "USD" | "UGX";
  customerEmail: string | null;
  successUrl: string;
  cancelUrl: string;
}

export interface TopupCheckoutSession {
  /** Provider-specific redirect URL (hosted checkout). */
  redirectUrl: string;
  /** Provider session id, stored for webhook reconciliation. */
  providerRef: string;
}

export interface PaymentProvider {
  readonly id: string;
  readonly label: string;
  readonly supportedCurrencies: readonly ("USD" | "UGX")[];
  createTopupCheckout(input: TopupCheckoutInput): Promise<TopupCheckoutSession>;
  /** Verify a webhook payload is authentic and return the paid top-up. */
  parseWebhook(
    payload: unknown,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ walletId: string; tokens: number; providerRef: string } | null>;
}

const providers = new Map<string, PaymentProvider>();

export function registerPaymentProvider(provider: PaymentProvider): void {
  providers.set(provider.id, provider);
}

export function getPaymentProvider(id: string): PaymentProvider | null {
  return providers.get(id) ?? null;
}

export function listPaymentProviders(): PaymentProvider[] {
  return [...providers.values()];
}
