export const dynamic = "force-dynamic";

import { requireRole } from "@/server/auth/session";
import {
  getWallet,
  listTransactions,
} from "@/server/services/billing";
import { WalletView } from "@/components/features/admin/wallet-view";
import { serializeDoc, serializeDocs } from "@/lib/serialize";

export default async function AdminWalletPage() {
  const actor = await requireRole("admin");
  const walletId = actor.schoolId ?? actor.uid;

  // Read-only: rendering must not create Firestore documents. Wallets are
  // provisioned when the admin first consumes tokens instead.
  let wallet = null;
  let transactions = [] as Awaited<ReturnType<typeof listTransactions>>;
  let loadFailed = false;
  try {
    wallet = await getWallet(walletId);
    transactions = await listTransactions(walletId, 150);
  } catch (err) {
    console.error("[admin/wallet] load failed", err);
    loadFailed = true;
  }

  return (
    <WalletView
      wallet={wallet ? serializeDoc(wallet) : null}
      transactions={serializeDocs(transactions)}
      ownerLabel={actor.schoolId ? "your school" : "your account"}
      loadFailed={loadFailed}
    />
  );
}
