import { FieldValue } from "firebase-admin/firestore";

import {
  topupDoc,
  topupsCol,
  walletDoc,
} from "@/server/firebase/collections";
import { BillingError, creditWallet } from "@/server/services/billing";
import { writeAudit } from "@/server/services/audit";
import { appUrl } from "@/server/services/email";
import { ensureMockProvider, MOCK_PROVIDER_ID } from "@/server/services/payments/mock";
import type { SessionUser } from "@/server/auth/session";
import type { TopupDoc, WithId, WriteModel } from "@/types/firestore";
import { tokensToUsd, usdToUgx } from "@/lib/pricing";
import type { CreateTopupInput } from "@/lib/schemas/school";

export class TopupsServiceError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

/**
 * Pay-as-you-go wallet credit.
 *
 * Real payment APIs come later; today a registered PaymentProvider mints the
 * checkout session (the default "mock" provider points at an in-app simulated
 * gateway page). The wallet credit happens only in `completeTopup`, so wiring
 * a real gateway + webhook later can reuse that function unchanged.
 */

/** Wallet a staff member buys credits for: the school wallet, or their own. */
export function walletIdForActor(actor: SessionUser): string {
  return actor.schoolId ?? actor.uid;
}

/** Price a top-up before any I/O (pure, unit-tested). */
export function priceTopup(tokens: number): { usd: number; usdMicros: number; ugx: number } {
  const usdMicros = Math.round(tokensToUsd(tokens) * 1_000_000);
  return { usd: usdMicros / 1_000_000, usdMicros, ugx: usdToUgx(usdMicros / 1_000_000) };
}

/** Start a checkout session for a token pack / custom amount. */
export async function createTopup(
  actor: SessionUser,
  input: CreateTopupInput,
): Promise<{ topup: WithId<TopupDoc>; redirectUrl: string }> {
  if (actor.role !== "admin" && actor.role !== "teacher") {
    throw new TopupsServiceError("Only school staff can add wallet credit.", 403);
  }
  const walletId = walletIdForActor(actor);
  const walletSnap = await walletDoc(walletId).get();
  if (!walletSnap.exists) {
    throw new TopupsServiceError("Wallet not found. Contact the platform admin.", 404);
  }
  const wallet = walletSnap.data()!;

  const provider = ensureMockProvider();
  const { usdMicros, ugx, usd } = priceTopup(input.tokens);

  const now = FieldValue.serverTimestamp();
  const doc: WriteModel<TopupDoc> = {
    walletId,
    ownerId: wallet.ownerId,
    ownerType: wallet.ownerType,
    packId: input.packId ?? null,
    tokens: input.tokens,
    amountUsdMicros: usdMicros,
    amountUgx: ugx,
    currency: "UGX",
    status: "pending",
    provider: provider.id,
    providerRef: null,
    checkoutUrl: null,
    completedAt: null,
    failedReason: null,
    createdBy: actor.uid,
    createdAt: now,
    updatedAt: now,
  };
  const ref = await topupsCol().add(doc as WriteModel<TopupDoc>);

  // The "hosted" checkout lives in-app for the mock provider; real gateways
  // return their own hosted URL from createTopupCheckout.
  const session = await provider.createTopupCheckout({
    walletId,
    tokens: input.tokens,
    usd,
    ugx,
    currency: "UGX",
    customerEmail: actor.email,
    successUrl: appUrl(`/wallet/checkout/${ref.id}`),
    cancelUrl: appUrl(actor.role === "teacher" ? "/teacher/wallet" : "/admin/wallet"),
  });

  await ref.update({
    providerRef: session.providerRef,
    checkoutUrl: session.redirectUrl,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await writeAudit({
    actorId: actor.uid,
    actorRole: actor.role,
    action: "topup.checkout_created",
    targetType: "topup",
    targetId: ref.id,
    meta: { tokens: input.tokens, usdMicros, provider: provider.id },
  });

  const saved = await ref.get();
  return { topup: { id: ref.id, ...saved.data()! }, redirectUrl: session.redirectUrl };
}

/** Ownership guard shared by confirm/cancel. */
async function loadOwnedTopup(
  actor: SessionUser,
  topupId: string,
): Promise<WithId<TopupDoc>> {
  const snap = await topupDoc(topupId).get();
  if (!snap.exists) throw new TopupsServiceError("Top-up not found.", 404);
  const topup = { id: snap.id, ...snap.data()! } as WithId<TopupDoc>;
  const owns =
    topup.createdBy === actor.uid ||
    (actor.role === "super_admin") ||
    (actor.schoolId && topup.walletId === actor.schoolId) ||
    topup.walletId === actor.uid;
  if (!owns) throw new TopupsServiceError("Not allowed.", 403);
  return topup;
}

/**
 * Mark a checkout as paid and credit the wallet. Idempotent: a top-up that is
 * already completed returns without double-crediting (safe for webhook replays).
 */
export async function completeTopup(
  actor: SessionUser,
  topupId: string,
): Promise<{ walletId: string; alreadyCompleted: boolean }> {
  const topup = await loadOwnedTopup(actor, topupId);
  if (topup.status === "completed") {
    return { walletId: topup.walletId, alreadyCompleted: true };
  }
  if (topup.status !== "pending" && topup.status !== "processing") {
    throw new TopupsServiceError(`This payment was ${topup.status}.`, 409);
  }

  await topupDoc(topupId).update({
    status: "processing",
    updatedAt: FieldValue.serverTimestamp(),
  });

  try {
    await creditWallet({
      walletId: topup.walletId,
      tokens: topup.tokens,
      description: `Wallet credit (${topup.tokens.toLocaleString()} tokens) via ${topup.provider} checkout`,
      refType: "topup",
      refId: topupId,
      actorId: actor.uid,
      usdMicros: topup.amountUsdMicros,
      ugx: topup.amountUgx,
    });
  } catch (err) {
    await topupDoc(topupId).update({
      status: "failed",
      failedReason: err instanceof BillingError ? err.message : "Wallet credit failed.",
      updatedAt: FieldValue.serverTimestamp(),
    }).catch(() => undefined);
    throw err;
  }

  await topupDoc(topupId).update({
    status: "completed",
    completedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await writeAudit({
    actorId: actor.uid,
    actorRole: actor.role,
    action: "topup.completed",
    targetType: "topup",
    targetId: topupId,
    meta: { tokens: topup.tokens, walletId: topup.walletId },
  });

  return { walletId: topup.walletId, alreadyCompleted: false };
}

/** Buyer abandons a pending checkout. */
export async function cancelTopup(actor: SessionUser, topupId: string): Promise<void> {
  const topup = await loadOwnedTopup(actor, topupId);
  if (topup.status !== "pending") {
    throw new TopupsServiceError("Only pending checkouts can be cancelled.", 409);
  }
  await topupDoc(topupId).update({
    status: "cancelled",
    updatedAt: FieldValue.serverTimestamp(),
  });
  await writeAudit({
    actorId: actor.uid,
    actorRole: actor.role,
    action: "topup.cancelled",
    targetType: "topup",
    targetId: topupId,
  });
}

export async function getTopup(actor: SessionUser, topupId: string): Promise<WithId<TopupDoc>> {
  return loadOwnedTopup(actor, topupId);
}

export async function listTopups(walletId: string, limit = 25): Promise<WithId<TopupDoc>[]> {
  const snap = await topupsCol()
    .where("walletId", "==", walletId)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data()! }));
}

/** Whether a pending checkout exists for a wallet (badge helper). */
export async function hasPendingTopup(walletId: string): Promise<boolean> {
  const snap = await topupsCol()
    .where("walletId", "==", walletId)
    .where("status", "in", ["pending", "processing"])
    .limit(1)
    .get();
  return !snap.empty;
}

export { MOCK_PROVIDER_ID };
