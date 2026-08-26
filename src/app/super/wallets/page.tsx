export const dynamic = "force-dynamic";

import { countQuery, schoolsCol, usersCol, walletsCol } from "@/server/firebase/collections";
import { requireRole } from "@/server/auth/session";
import {
  listAllWallets,
  recentTransactions,
} from "@/server/services/billing";
import { WalletsManager } from "@/components/features/super/wallets-manager";
import { serializeDocs } from "@/lib/serialize";
import type { WithId, SchoolDoc, TransactionDoc, UserDoc, WalletDoc } from "@/types/firestore";

const WALLET_CAP = 200;

export default async function SuperWalletsPage() {
  await requireRole("super_admin");

  let wallets: WithId<WalletDoc>[] = [];
  let schools: WithId<SchoolDoc>[] = [];
  let standaloneAdmins: WithId<UserDoc>[] = [];
  let transactions: WithId<TransactionDoc>[] = [];
  let totalWallets = 0;
  try {
    [wallets, schools, standaloneAdmins, transactions, totalWallets] = await Promise.all([
      listAllWallets(WALLET_CAP),
      listSchoolsSafe(),
      usersCol()
        .where("role", "==", "admin")
        .where("schoolId", "==", null)
        .limit(500)
        .get()
        .then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data()! }))),
      recentTransactions(15),
      countQuery(walletsCol()),
    ]);
  } catch (err) {
    console.error("[super/wallets] load failed", err);
  }

  const labels: Record<string, string> = {};
  for (const s of schools) labels[s.id] = s.name;
  // Standalone admin wallets: label with the admin's real name.
  const adminNames = new Map(standaloneAdmins.map((a) => [a.id, a.displayName]));
  for (const w of wallets) {
    if (!labels[w.id]) {
      labels[w.id] = adminNames.get(w.ownerId) ?? `Admin ${w.id.slice(0, 8)}…`;
    }
  }

  return (
    <WalletsManager
      wallets={serializeDocs(wallets)}
      labels={labels}
      recentTransactions={serializeDocs(transactions)}
      totals={{
        wallets: totalWallets,
        truncated: totalWallets > wallets.length,
      }}
    />
  );
}

async function listSchoolsSafe(): Promise<WithId<SchoolDoc>[]> {
  const snap = await schoolsCol().limit(500).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data()! }));
}
