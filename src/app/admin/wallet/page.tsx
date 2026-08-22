export const dynamic = "force-dynamic";

import { requireRole } from "@/server/auth/session";
import {
  getOrCreateWallet,
  listTransactions,
} from "@/server/services/billing";
import { WalletView } from "@/components/features/admin/wallet-view";

export default async function AdminWalletPage() {
  const actor = await requireRole("admin");
  const walletId = actor.schoolId ?? actor.uid;

  let wallet = null;
  let transactions = [] as Awaited<ReturnType<typeof listTransactions>>;
  try {
    wallet = await getOrCreateWallet(walletId, actor.schoolId ? "school" : "admin");
    transactions = await listTransactions(walletId, 50);
  } catch (err) {
    console.error("[admin/wallet] load failed", err);
  }

  return (
    <WalletView
      wallet={wallet}
      transactions={transactions}
      ownerLabel={actor.schoolId ? "your school" : "your account"}
    />
  );
}
