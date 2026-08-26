import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/server/firebase/admin";
import {
  COLLECTIONS,
  createConverter,
  dailyMetricDoc,
  todayMetricId,
  transactionsCol,
  walletDoc,
  walletsCol,
} from "@/server/firebase/collections";
import { writeAudit } from "@/server/services/audit";
import type { SessionUser } from "@/server/auth/session";
import type {
  TransactionCategory,
  TransactionDoc,
  WithId,
  WalletDoc,
  WriteModel,
} from "@/types/firestore";
import { textTokensToMicros, voiceMinutesToMicros, usdMicrosToUgx } from "@/lib/pricing";

export class BillingError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

export class InsufficientTokensError extends BillingError {
  constructor(needed: number, available: number) {
    super(
      `Not enough tokens: need ~${needed.toLocaleString()}, wallet has ${available.toLocaleString()}. Ask the platform admin for a top-up.`,
      402,
    );
  }
}

/** Read a wallet without creating it. Returns null when missing. */
export async function getWallet(ownerId: string): Promise<WithId<WalletDoc> | null> {
  const snap = await walletDoc(ownerId).get();
  return snap.exists ? { id: snap.id, ...snap.data()! } : null;
}

interface ConsumeInput {
  walletId: string;
  tokens: number;
  category: TransactionCategory;
  description: string;
  refType?: string | null;
  refId?: string | null;
  actorId: string | null;
  voiceMinutes?: number;
}

/**
 * Atomically debit tokens and append a ledger transaction. Throws
 * InsufficientTokensError when the balance can't cover the request.
 */
export async function consumeTokens(
  input: ConsumeInput,
): Promise<Omit<TransactionDoc, "createdAt">> {
  type TxResult =
    | { ok: true; ledger: Omit<TransactionDoc, "createdAt"> }
    | { ok: false; error: BillingError };

  const result: TxResult = await adminDb().runTransaction(async (tx) => {
    const walletRef = walletDoc(input.walletId);
    const snap = await tx.get(walletRef);
    if (!snap.exists) {
      return { ok: false, error: new BillingError("Wallet not found.", 404) };
    }
    const wallet = snap.data()!;
    const tokens = Math.round(input.tokens);
    if (tokens > 0 && wallet.balanceTokens < tokens) {
      return {
        ok: false,
        error: new InsufficientTokensError(tokens, wallet.balanceTokens),
      };
    }

    const micros = input.voiceMinutes
      ? voiceMinutesToMicros(input.voiceMinutes)
      : textTokensToMicros(tokens);
    const ugx = usdMicrosToUgx(micros);
    const balanceAfter = wallet.balanceTokens - tokens;

    tx.update(walletRef, {
      balanceTokens: balanceAfter,
      totalConsumedTokens: wallet.totalConsumedTokens + Math.max(tokens, 0),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const ledgerBase: Omit<WriteModel<TransactionDoc>, "createdAt"> = {
      walletId: input.walletId,
      ownerId: wallet.ownerId,
      type: "consumption",
      category: input.category,
      tokensDelta: -tokens,
      balanceAfter,
      usdMicros: micros,
      ugx,
      description: input.description,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      createdBy: input.actorId,
    };
    tx.create(transactionsCol().doc(), {
      ...ledgerBase,
      createdAt: FieldValue.serverTimestamp(),
    } as WriteModel<TransactionDoc>);
    return {
      ok: true,
      ledger: ledgerBase as unknown as Omit<TransactionDoc, "createdAt">,
    };
  });

  if (!result.ok) throw result.error;

  await recordRevenue(result.ledger.usdMicros, result.ledger.tokensDelta).catch(
    () => undefined,
  );
  return result.ledger;
}

/** Super Admin credits a wallet (manual top-up). */
export async function topupWallet(
  actor: SessionUser,
  input: { walletId: string; tokens: number; description?: string },
): Promise<void> {
  if (actor.role !== "super_admin") {
    throw new BillingError("Only super admins can top up wallets.", 403);
  }
  const tokens = Math.round(input.tokens);
  if (tokens <= 0) throw new BillingError("Top-up must be positive.");

  await adminDb().runTransaction(async (tx) => {
    const walletRef = walletDoc(input.walletId);
    const snap = await tx.get(walletRef);
    if (!snap.exists) throw new BillingError("Wallet not found.", 404);
    const wallet = snap.data()!;
    const balanceAfter = wallet.balanceTokens + tokens;
    tx.update(walletRef, {
      balanceTokens: balanceAfter,
      totalTopupTokens: wallet.totalTopupTokens + tokens,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const ledger: WriteModel<TransactionDoc> = {
      walletId: input.walletId,
      ownerId: wallet.ownerId,
      type: "topup",
      category: "topup",
      tokensDelta: tokens,
      balanceAfter,
      usdMicros: 0,
      ugx: 0,
      description: input.description ?? "Manual top-up",
      refType: null,
      refId: null,
      createdBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
    };
    tx.create(transactionsCol().doc(), ledger);
  });

  await writeAudit({
    actorId: actor.uid,
    actorRole: actor.role,
    action: "wallet.topup",
    targetType: "wallet",
    targetId: input.walletId,
    meta: { tokens },
  });
}

/** Pre-flight: fails fast if the balance clearly can't cover an estimate. */
export async function assertCanAfford(
  walletId: string,
  estimatedTokens: number,
): Promise<void> {
  const snap = await walletDoc(walletId).get();
  if (!snap.exists) {
    throw new BillingError("Wallet not found. Contact the platform admin.", 404);
  }
  if (snap.data()!.balanceTokens < estimatedTokens) {
    throw new InsufficientTokensError(estimatedTokens, snap.data()!.balanceTokens);
  }
}

export async function listTransactions(
  walletId: string,
  limit = 50,
): Promise<WithId<TransactionDoc>[]> {
  const snap = await transactionsCol()
    .where("walletId", "==", walletId)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data()! }));
}

/** Total number of wallets (cheap aggregate for truncation indicators). */
export async function countWallets(): Promise<number> {
  const snap = await walletsCol().count().get();
  return snap.data().count;
}

export async function listAllWallets(limit = 200): Promise<WithId<WalletDoc>[]> {
  const snap = await walletsCol().orderBy("updatedAt", "desc").limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data()! }));
}

/** Most recent ledger entries across ALL wallets (single indexed query). */
export async function recentTransactions(limit = 15): Promise<WithId<TransactionDoc>[]> {
  const snap = await adminDb()
    .collectionGroup(COLLECTIONS.transactions)
    .withConverter(createConverter<TransactionDoc>())
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data()! }));
}

/** Fold consumption into the daily platform metrics (best-effort). */
async function recordRevenue(usdMicros: number, tokensDelta: number): Promise<void> {
  await dailyMetricDoc(todayMetricId()).set(
    {
      date: todayMetricId(),
      usdRevenueMicros: FieldValue.increment(Math.max(usdMicros, 0)),
      tokensConsumed: FieldValue.increment(Math.max(-tokensDelta, 0)),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}
