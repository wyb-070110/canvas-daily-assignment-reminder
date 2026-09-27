import puppeteer from "@cloudflare/puppeteer";
import {
  BrowserCanvasClient,
  loginToCanvas,
  PuppeteerCanvasPage
} from "./browser-canvas.ts";
import { renderFailureEmail, renderReminderEmail } from "./email.ts";
import { errorCategory, SafeHttpError } from "./http.ts";
import { buildReminder } from "./reminder.ts";
import { RESEND_DEFAULT_FROM, sendResendEmail } from "./resend.ts";
import { isAucklandThreePm } from "./time.ts";
import type { RenderedEmail } from "./types.ts";

export interface SecretEnv {
  CANVAS_USERNAME: string;
  CANVAS_PASSWORD: string;
  RESEND_API_KEY: string;
  RESEND_FROM_EMAIL?: string;
  ALERT_TO_EMAIL: string;
  ALERT_BACKUP_TO_EMAIL?: string;
}

export type RuntimeEnv = Env & SecretEnv;
type SecretKey = keyof SecretEnv;

function requireConfig(env: RuntimeEnv, required: SecretKey[]): void {
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing configuration: ${missing.join(", ")}`);
  }
}

export async function runDailyCheck(env: RuntimeEnv, now: Date): Promise<void> {
  requireConfig(env, ["RESEND_API_KEY", "ALERT_TO_EMAIL"]);
  const customFrom = env.RESEND_FROM_EMAIL?.trim();
  const resendConfig = {
    apiKey: env.RESEND_API_KEY.trim(),
    from: customFrom || RESEND_DEFAULT_FROM,
    to: env.ALERT_TO_EMAIL.trim(),
    // Resend's shared sender rejects any recipient other than the account
    // owner, so the backup copy is only possible with a verified domain.
    bcc: customFrom ? env.ALERT_BACKUP_TO_EMAIL?.trim() || undefined : undefined
  };

  let email: RenderedEmail;
  let successLog: { kind: string; count: number } | null = null;
  let canvasPhase = "config";

  try {
    requireConfig(env, ["CANVAS_USERNAME", "CANVAS_PASSWORD"]);
    canvasPhase = "browser_launch";
    const browser = await puppeteer.launch(env.BROWSER);
    try {
      canvasPhase = "page_open";
      const page = new PuppeteerCanvasPage(await browser.newPage());
      canvasPhase = "canvas_login";
      await loginToCanvas(page, env.CANVAS_USERNAME, env.CANVAS_PASSWORD);
      canvasPhase = "canvas_read";
      const reminder = await buildReminder(new BrowserCanvasClient(page), now);
      email = renderReminderEmail(reminder);
      successLog = { kind: reminder.kind, count: reminder.items.length };
    } finally {
      await browser.close().catch(() => {
        console.error(JSON.stringify({ event: "browser_close_failed" }));
      });
    }
  } catch (error) {
    const category = errorCategory(error);
    console.error(
      JSON.stringify({
        event: "canvas_check_failed",
        category,
        phase: canvasPhase,
        errorName: error instanceof Error ? error.name : "UnknownError",
        safeReason: error instanceof SafeHttpError ? error.message : undefined
      })
    );
    email = renderFailureEmail(category);
  }

  try {
    await sendResendEmail(resendConfig, email);
    if (successLog) {
      console.log(JSON.stringify({ event: "canvas_reminder_sent", ...successLog }));
    }
  } catch (mailError) {
    console.error(
      JSON.stringify({ event: "email_delivery_failed", category: errorCategory(mailError) })
    );
    throw new Error("Notification delivery failed");
  }
}

export default {
  async scheduled(controller, env): Promise<void> {
    const scheduledAt = new Date(controller.scheduledTime);
    if (!isAucklandThreePm(scheduledAt)) {
      console.log(JSON.stringify({ event: "cron_skipped", reason: "not_auckland_15_00" }));
      return;
    }

    await runDailyCheck(env, scheduledAt);
  }
} satisfies ExportedHandler<RuntimeEnv>;
