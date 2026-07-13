import nodemailer from "nodemailer";

import type { AppConfig } from "@resonance/config";

export interface LoginMailer {
  sendLoginLink(email: string, loginUrl: string): Promise<void>;
}

/** SMTP mailer — Mailpit locally; a real provider is configured via env later. */
export function createSmtpMailer(config: AppConfig): LoginMailer {
  const transport = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: false,
  });
  return {
    async sendLoginLink(email, loginUrl) {
      await transport.sendMail({
        from: config.emailFrom,
        to: email,
        subject: "Your Resonance sign-in link",
        text: [
          "Sign in to Resonance by opening this link:",
          "",
          loginUrl,
          "",
          "The link works once and expires in 15 minutes.",
          "If you did not request it, you can ignore this email.",
        ].join("\n"),
      });
    },
  };
}

let mailer: LoginMailer | undefined;

export function getMailer(config: AppConfig): LoginMailer {
  mailer ??= createSmtpMailer(config);
  return mailer;
}

/** Test hook. */
export function setMailer(next: LoginMailer | undefined): void {
  mailer = next;
}
