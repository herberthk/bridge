"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircleIcon, KeyRoundIcon, PartyPopperIcon } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";

import { authClient } from "@/lib/firebase/client";
import { setupSchema, type SetupInput } from "@/lib/schemas/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function SetupForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const form = useForm<SetupInput>({
    resolver: zodResolver(setupSchema),
    defaultValues: { setupKey: "", displayName: "", email: "", password: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const data = (await res.json().catch(() => null)) as
      | { ok: true }
      | { error: string }
      | null;
    if (!res.ok || !data || !("ok" in data)) {
      setServerError(data && "error" in data ? data.error : "Setup failed.");
      return;
    }

    // Sign straight in as the newly created Super Admin.
    try {
      const cred = await signInWithEmailAndPassword(
        authClient(),
        values.email,
        values.password,
      );
      const idToken = await cred.user.getIdToken();
      await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      toast.success("Platform ready — welcome aboard!");
      router.replace("/super");
    } catch {
      setDone(true); // Account exists; user can sign in manually.
    }
  });

  if (done) {
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Alert>
          <PartyPopperIcon data-icon="inline-start" />
          <AlertDescription>
            Super Admin created. You were not signed in automatically —{" "}
            <a href="/login" className="font-medium underline">
              sign in now
            </a>
            .
          </AlertDescription>
        </Alert>
      </motion.div>
    );
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate>
      <FieldGroup>
        {serverError && (
          <Alert variant="destructive">
            <AlertCircleIcon data-icon="inline-start" />
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <Field data-invalid={form.formState.errors.setupKey ? true : undefined}>
          <FieldLabel htmlFor="setupKey">Setup key</FieldLabel>
          <div className="relative">
            <KeyRoundIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              id="setupKey"
              className="pl-9"
              placeholder="From SETUP_ADMIN_KEY in .env.local"
              aria-invalid={!!form.formState.errors.setupKey}
              {...form.register("setupKey")}
            />
          </div>
          {form.formState.errors.setupKey ? (
            <FieldError>{form.formState.errors.setupKey.message}</FieldError>
          ) : (
            <FieldDescription>
              Find it in your <code>.env.local</code> as SETUP_ADMIN_KEY.
            </FieldDescription>
          )}
        </Field>

        <Field data-invalid={form.formState.errors.displayName ? true : undefined}>
          <FieldLabel htmlFor="displayName">Your name</FieldLabel>
          <Input
            id="displayName"
            placeholder="e.g. Herbert Netbritz"
            autoComplete="name"
            aria-invalid={!!form.formState.errors.displayName}
            {...form.register("displayName")}
          />
          {form.formState.errors.displayName && (
            <FieldError>{form.formState.errors.displayName.message}</FieldError>
          )}
        </Field>

        <Field data-invalid={form.formState.errors.email ? true : undefined}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="admin@bridge.school"
            aria-invalid={!!form.formState.errors.email}
            {...form.register("email")}
          />
          {form.formState.errors.email && (
            <FieldError>{form.formState.errors.email.message}</FieldError>
          )}
        </Field>

        <Field data-invalid={form.formState.errors.password ? true : undefined}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="10+ chars, mixed case, a number"
            aria-invalid={!!form.formState.errors.password}
            {...form.register("password")}
          />
          {form.formState.errors.password && (
            <FieldError>{form.formState.errors.password.message}</FieldError>
          )}
        </Field>

        <Button
          type="submit"
          className="shadow-glow mt-2 h-10 w-full"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? "Creating platform…" : "Create Super Admin"}
        </Button>
      </FieldGroup>
    </form>
  );
}
