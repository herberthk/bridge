"use client";

import { format } from "date-fns";
import { ArrowDownIcon, ArrowUpIcon, CoinsIcon, InfoIcon } from "lucide-react";

import { formatUgx, formatUsd } from "@/lib/pricing";
import type { WithId, TransactionDoc, WalletDoc } from "@/types/firestore";
import { AnimatedCounter } from "@/components/motion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function WalletView({
  wallet,
  transactions,
  ownerLabel,
}: {
  wallet: WithId<WalletDoc> | null;
  transactions: WithId<TransactionDoc>[];
  ownerLabel: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Wallet &amp; usage</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Pay-as-you-go tokens for {ownerLabel}. AI consumes tokens only when it
          works for you.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="bg-brand shadow-glow relative overflow-hidden rounded-2xl p-6 text-primary-foreground md:col-span-2">
          <div
            className="pointer-events-none absolute inset-0 opacity-20"
            style={{
              backgroundImage:
                "radial-gradient(24rem 14rem at 15% 0%, rgba(255,255,255,.5), transparent 60%)",
            }}
          />
          <div className="relative flex items-start justify-between">
            <div>
              <p className="flex items-center gap-2 text-sm opacity-80">
                <CoinsIcon className="size-4" />
                Available balance
              </p>
              <p className="mt-2 text-4xl font-semibold tabular-nums">
                <AnimatedCounter value={wallet?.balanceTokens ?? 0} />
                <span className="ml-2 text-base font-normal opacity-80">tokens</span>
              </p>
            </div>
            <Badge variant="secondary">{wallet?.ownerType === "school" ? "School wallet" : "Personal wallet"}</Badge>
          </div>
          <p className="relative mt-4 text-sm opacity-75">
            ≈ {formatUsd(((wallet?.balanceTokens ?? 0) * 27) / 1_000_000)} of AI
            capacity ({formatUgx(((wallet?.balanceTokens ?? 0) * 27) / 1_000_000 * 3800)})
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Totals</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Topped up</span>
              <span className="font-medium tabular-nums">
                {(wallet?.totalTopupTokens ?? 0).toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Consumed</span>
              <span className="font-medium tabular-nums">
                {(wallet?.totalConsumedTokens ?? 0).toLocaleString()}
              </span>
            </div>
            <Alert className="mt-1">
              <InfoIcon data-icon="inline-start" />
              <AlertTitle>Need a top-up?</AlertTitle>
              <AlertDescription>
                Contact the platform administrator to credit your wallet.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>

      <div className="shadow-card rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-medium">Transaction history</h2>
          <Badge variant="secondary">{transactions.length} recent</Badge>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Tokens</TableHead>
              <TableHead>Balance after</TableHead>
              <TableHead>Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="text-muted-foreground text-sm">
                  {t.createdAt ? format(t.createdAt.toDate(), "d MMM yyyy, HH:mm") : "–"}
                </TableCell>
                <TableCell className="max-w-72 truncate">{t.description}</TableCell>
                <TableCell className="flex items-center gap-1 tabular-nums">
                  {t.tokensDelta >= 0 ? (
                    <ArrowUpIcon className="size-3.5 text-emerald-600" />
                  ) : (
                    <ArrowDownIcon className="size-3.5 text-destructive" />
                  )}
                  {Math.abs(t.tokensDelta).toLocaleString()}
                </TableCell>
                <TableCell className="tabular-nums">{t.balanceAfter.toLocaleString()}</TableCell>
                <TableCell className="text-muted-foreground tabular-nums">
                  {t.usdMicros > 0 ? formatUsd(t.usdMicros / 1_000_000) : "—"}
                </TableCell>
              </TableRow>
            ))}
            {transactions.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground py-10 text-center">
                  No transactions yet — generate an exam to see usage here.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
