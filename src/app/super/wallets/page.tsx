export const dynamic = "force-dynamic";

import { schoolsCol } from "@/server/firebase/collections";
import { requireRole } from "@/server/auth/session";
import { listAllWallets, listTransactions } from "@/server/services/billing";
import { WalletsManager } from "@/components/features/super/wallets-manager";
import type { WithId, SchoolDoc, TransactionDoc, WalletDoc } from "@/types/firestore";

export default async function SuperWalletsPage() {
  await requireRole("super_admin");

  let wallets: WithId<WalletDoc>[] = [];
  let schools: WithId<SchoolDoc>[] = [];
  let recentTransactions: WithId<TransactionDoc>[] = [];
  try {
    [wallets, schools] = await Promise.all([listAllWallets(), listSchoolsSafe()]);
    if (wallets.length > 0) {
      // Merge recent transactions across the first few wallets for the feed.
      const perWallet = await Promise.all(
        wallets.slice(0, 8).map((w) => listTransactions(w.id, 8).catch(() => [])),
      );
      recentTransactions = perWallet
        .flat()
        .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0))
        .slice(0, 15);
    }
  } catch (err) {
    console.error("[super/wallets] load failed", err);
  }

  const labels: Record<string, string> = {};
  for (const s of schools) labels[s.id] = s.name;
  // Admin (standalone) wallets: labeled by uid for now; names resolve lazily
  // in a later analytics pass.
  for (const w of wallets) if (!labels[w.id]) labels[w.id] = `Admin ${w.id.slice(0, 8)}…`;

  return (
    <WalletsManager
      wallets={wallets}
      labels={labels}
      recentTransactions={recentTransactions}
    />
  );
}

async function listSchoolsSafe(): Promise<WithId<SchoolDoc>[]> {
  const snap = await schoolsCol().limit(500).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data()! }));
}
