"use client";

import { useActionState, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { ArrowDownIcon, ArrowUpIcon, CoinsIcon, PlusIcon } from "lucide-react";

import { topupWalletAction } from "@/app/super/actions";
import type { ActionState } from "@/app/admin/actions";
import { formatUgx, formatUsd, TOPUP_PACKS, tokensToUsd, usdToUgx } from "@/lib/pricing";
import type { WithId, TransactionDoc, WalletDoc } from "@/types/firestore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

function TopupDialog({ walletId, walletLabel }: { walletId: string; walletLabel: string }) {
  const [open, setOpen] = useState(false);
  const [tokens, setTokens] = useState<number>(TOPUP_PACKS[1].tokens);
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    topupWalletAction,
    null,
  );
  const [handled, setHandled] = useState<ActionState | null>(null);

  if (state && state !== handled) {
    setHandled(state);
    if (state.ok) {
      setOpen(false);
      toast.success("Wallet topped up", {
        description: `${tokens.toLocaleString()} tokens credited.`,
      });
    } else {
      toast.error(state.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <PlusIcon data-icon="inline-start" />
        Top up
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Top up {walletLabel}</DialogTitle>
          <DialogDescription>
            Credits the wallet instantly. Payment gateway integration plugs in
            later — this is the manual/credits flow.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction}>
          <input type="hidden" name="walletId" value={walletId} />
          <FieldGroup>
            <Field>
              <FieldLabel>Packs</FieldLabel>
              <ToggleGroup
                value={[String(tokens)]}
                onValueChange={(v: readonly string[]) => {
                  const first = v[0];
                  if (first) setTokens(Number(first));
                }}
                className="flex flex-wrap justify-start"
              >
                {TOPUP_PACKS.map((p) => (
                  <ToggleGroupItem key={p.tokens} value={String(p.tokens)}>
                    {p.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
            <Field>
              <FieldLabel htmlFor="tokens">Tokens</FieldLabel>
              <Input
                id="tokens"
                name="tokens"
                type="number"
                min={1}
                step={1000}
                value={tokens}
                onChange={(e) => setTokens(Number(e.target.value))}
                required
              />
            </Field>
            <div className="bg-muted flex items-center justify-between rounded-lg px-4 py-3 text-sm">
              <span className="text-muted-foreground">Value</span>
              <span className="font-medium">
                {formatUsd(tokensToUsd(tokens))} · {formatUgx(usdToUgx(tokensToUsd(tokens)))}
              </span>
            </div>
            <Field>
              <FieldLabel htmlFor="description">Note (optional)</FieldLabel>
              <Input id="description" name="description" placeholder="e.g. Term 2 budget" />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Crediting…" : "Credit wallet"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function WalletsManager({
  wallets,
  labels,
  recentTransactions,
}: {
  wallets: WithId<WalletDoc>[];
  labels: Record<string, string>;
  recentTransactions: WithId<TransactionDoc>[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Wallets &amp; billing</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Credit school and admin wallets. Token pricing: $0.027 / 1,000 tokens ·
          $0.08 / voice minute · 1 USD = 3,800 UGX.
        </p>
      </div>

      <div className="shadow-card rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Wallet</TableHead>
              <TableHead>Balance</TableHead>
              <TableHead>Topped up</TableHead>
              <TableHead>Consumed</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {wallets.map((w) => (
              <TableRow key={w.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="bg-brand-soft flex size-8 items-center justify-center rounded-lg text-accent-foreground">
                      <CoinsIcon className="size-4" />
                    </span>
                    <div className="flex flex-col">
                      <span className="font-medium">{labels[w.id] ?? w.id}</span>
                      <span className="text-muted-foreground text-xs capitalize">
                        {w.ownerType} wallet
                      </span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="font-semibold tabular-nums">
                  {w.balanceTokens.toLocaleString()}
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">
                  {w.totalTopupTokens.toLocaleString()}
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">
                  {w.totalConsumedTokens.toLocaleString()}
                </TableCell>
                <TableCell>
                  <TopupDialog walletId={w.id} walletLabel={labels[w.id] ?? w.id} />
                </TableCell>
              </TableRow>
            ))}
            {wallets.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground py-10 text-center">
                  No wallets yet — create a school or standalone admin first.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="shadow-card rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-medium">Recent transactions</h2>
          <Badge variant="secondary">all wallets</Badge>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Wallet</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Tokens</TableHead>
              <TableHead>Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentTransactions.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="text-muted-foreground text-sm">
                  {t.createdAt ? format(t.createdAt.toDate(), "d MMM, HH:mm") : "–"}
                </TableCell>
                <TableCell>{labels[t.walletId] ?? t.walletId}</TableCell>
                <TableCell className="max-w-64 truncate">{t.description}</TableCell>
                <TableCell className="flex items-center gap-1 tabular-nums">
                  {t.tokensDelta >= 0 ? (
                    <ArrowUpIcon className="size-3.5 text-emerald-600" />
                  ) : (
                    <ArrowDownIcon className="size-3.5 text-destructive" />
                  )}
                  {Math.abs(t.tokensDelta).toLocaleString()}
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">
                  {t.usdMicros > 0 ? formatUsd(t.usdMicros / 1_000_000) : "—"}
                </TableCell>
              </TableRow>
            ))}
            {recentTransactions.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground py-10 text-center">
                  No transactions yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
