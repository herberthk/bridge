"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircleIcon, ArrowRightIcon, EyeIcon, EyeOffIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

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

const formSchema = z.object({
  displayName: z.string().trim().min(2, "Enter your full name").max(80),
  password: z
    .string()
    .min(10, "Use at least 10 characters")
    .max(100)
    .regex(/[a-z]/, "Include a lowercase letter")
    .regex(/[A-Z]/, "Include an uppercase letter")
    .regex(/[0-9]/, "Include a number"),
});
type FormInput = z.infer<typeof formSchema>;

/** Teacher invite acceptance — creates the account via the server API. */
export function AcceptInviteForm({ token }: { token: string }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<FormInput>({
    resolver: zodResolver(formSchema),
    defaultValues: { displayName: "", password: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      const res = await fetch("/api/invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, ...values }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: true; email: string }
        | { ok: false; error: string }
        | null;
      if (!res.ok || !data || !("ok" in data) || !data.ok) {
        setServerError(data && "error" in data ? data.error : "Could not accept the invite.");
        return;
      }
      toast.success("Account created — sign in to get started!");
      router.replace(`/login?next=${encodeURIComponent("/teacher")}`);
    } catch {
      setServerError("Network error — check your internet connection.");
    }
  });

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate>
      <FieldGroup>
        {serverError && (
          <Alert variant="destructive">
            <AlertCircleIcon data-icon="inline-start" />
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}
        <Field data-invalid={form.formState.errors.displayName ? true : undefined}>
          <FieldLabel htmlFor="displayName">Your full name</FieldLabel>
          <Input
            id="displayName"
            autoComplete="name"
            placeholder="e.g. John Okello"
            aria-invalid={!!form.formState.errors.displayName}
            {...form.register("displayName")}
          />
          {form.formState.errors.displayName && (
            <FieldError>{form.formState.errors.displayName.message}</FieldError>
          )}
        </Field>
        <Field data-invalid={form.formState.errors.password ? true : undefined}>
          <FieldLabel htmlFor="password">Choose a password</FieldLabel>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="10+ chars, mixed case, number"
              className="pr-10"
              aria-invalid={!!form.formState.errors.password}
              {...form.register("password")}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex w-10 items-center justify-center transition-colors"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
            </button>
          </div>
          <FieldDescription>
            You&apos;ll use this to sign in — your email is already set from the
            invite.
          </FieldDescription>
          {form.formState.errors.password && (
            <FieldError>{form.formState.errors.password.message}</FieldError>
          )}
        </Field>
        <Button
          type="submit"
          className="shadow-glow mt-2 h-10 w-full font-medium"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? (
            <>
              <Loader2Icon className="size-4 animate-spin" data-icon="inline-start" />
              <span>Creating your account…</span>
            </>
          ) : (
            <>
              <span>Accept invitation</span>
              <ArrowRightIcon data-icon="inline-end" />
            </>
          )}
        </Button>
      </FieldGroup>
    </form>
  );
}
