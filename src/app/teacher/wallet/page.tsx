export const dynamic = "force-dynamic";

import { requireRole } from "@/server/auth/session";
import {
  getWallet,
  listTransactions,
} from "@/server/services/billing";
import { WalletView } from "@/components/features/admin/wallet-view";
import { serializeDoc, serializeDocs } from "@/lib/serialize";

export default async function TeacherWalletPage() {
  const actor = await requireRole("teacher");
  const walletId = actor.schoolId ?? actor.uid;

  let wallet = null;
  let transactions = [] as Awaited<ReturnType<typeof listTransactions>>;
  let loadFailed = false;
  try {
    wallet = await getWallet(walletId);
    transactions = await listTransactions(walletId, 150);
  } catch (err) {
    console.error("[teacher/wallet] load failed", err);
    loadFailed = true;
  }

  return (
    <WalletView
      wallet={wallet ? serializeDoc(wallet) : null}
      transactions={serializeDocs(transactions)}
      ownerLabel="your school"
      loadFailed={loadFailed}
      selfTopup
    />
  );
}
