import { fetchWithRetry, SafeHttpError } from "./http.ts";
import type { FetchLike, RenderedEmail } from "./types.ts";

// Resend's shared sender. Without a verified domain it can only deliver to the
// email address that owns the Resend account.
export const RESEND_DEFAULT_FROM = "onboarding@resend.dev";

export interface ResendConfig {
  apiKey: string;
  from: string;
  to: string;
  bcc?: string;
}

function assertEmailAddress(value: string, label: string): void {
  if (!value || value.length > 254 || /[\r\n<>,]/.test(value) || !value.includes("@")) {
    throw new SafeHttpError(`Invalid ${label} email configuration`, "CONFIG");
  }
}

export function buildResendPayload(
  config: Pick<ResendConfig, "from" | "to" | "bcc">,
  email: RenderedEmail
): Record<string, unknown> {
  assertEmailAddress(config.from, "sender");
  assertEmailAddress(config.to, "recipient");
  if (config.bcc) assertEmailAddress(config.bcc, "backup recipient");
  return {
    from: `Canvas 作业提醒 <${config.from}>`,
    to: [config.to],
    ...(config.bcc ? { bcc: [config.bcc] } : {}),
    subject: email.subject,
    html: email.html,
    text: email.text
  };
}

export async function sendResendEmail(
  config: ResendConfig,
  email: RenderedEmail,
  fetcher: FetchLike = fetch
): Promise<void> {
  if (!config.apiKey || /[\r\n]/.test(config.apiKey)) {
    throw new SafeHttpError("Invalid Resend API key configuration", "CONFIG");
  }
  const payload = buildResendPayload(config, email);
  await fetchWithRetry(
    fetcher,
    "https://api.resend.com/emails",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "canvas-daily-assignment-reminder",
        // Shared across retries so a timed-out attempt that actually succeeded
        // is not delivered twice.
        "Idempotency-Key": `canvas-reminder/${crypto.randomUUID()}`
      },
      body: JSON.stringify(payload)
    },
    { attempts: 3, timeoutMs: 10_000 }
  );
}
