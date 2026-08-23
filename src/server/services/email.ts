import nodemailer, { type Transporter } from "nodemailer";
import { render } from "@react-email/render";
import React from "react";

export class EmailServiceError extends Error {}

let transporter: Transporter | null = null;

function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
}

/**
 * Send a transactional email from a react-email template. No-ops with a
 * console warning when SMTP isn't configured (dev without credentials).
 */
export async function sendTemplateEmail(options: {
  to: string;
  subject: string;
  template: React.ReactElement;
}): Promise<void> {
  if (!smtpConfigured()) {
    console.warn(
      `[email] SMTP not configured — skipping "${options.subject}" to ${options.to}`,
    );
    return;
  }
  try {
    transporter ??= nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
       tls: {
          rejectUnauthorized: false,
        },
    });
    const html = await render(options.template);
    await transporter.sendMail({
      from: process.env.EMAIL_FROM ?? "Bridge <no-reply@bridge.example>",
      to: options.to,
      subject: options.subject,
      html,
    });
  } catch (err) {
    // Emails must never break the primary flow.
    console.error(`[email] failed to send "${options.subject}"`, err);
  }
}

export function appUrl(path = ""): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path}`;
}
