import puppeteer from "@cloudflare/puppeteer";
import {
  BrowserCanvasClient,
  loginToCanvas,
  PuppeteerCanvasPage
} from "./browser-canvas.ts";
import { renderFailureEmail, renderReminderEmail } from "./email.ts";
import { sendGmailEmail } from "./gmail.ts";
import { errorCategory, SafeHttpError } from "./http.ts";
import { buildReminder } from "./reminder.ts";
import { isAucklandThreePm } from "./time.ts";
import type { RenderedEmail } from "./types.ts";

export interface SecretEnv {
  CANVAS_USERNAME: string;
  CANVAS_PASSWORD: string;
  GMAIL_CLIENT_ID: string;
  GMAIL_CLIENT_SECRET: string;
  GMAIL_REFRESH_TOKEN: string;
  ALERT_FROM_EMAIL: string;
  ALERT_TO_EMAIL: string;
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
  requireConfig(env, [
    "GMAIL_CLIENT_ID",
    "GMAIL_CLIENT_SECRET",
    "GMAIL_REFRESH_TOKEN",
    "ALERT_FROM_EMAIL",
    "ALERT_TO_EMAIL"
  ]);
  const gmailConfig = {
    clientId: env.GMAIL_CLIENT_ID,
    clientSecret: env.GMAIL_CLIENT_SECRET,
    refreshToken: env.GMAIL_REFRESH_TOKEN,
    from: env.ALERT_FROM_EMAIL,
    to: env.ALERT_TO_EMAIL
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
    await sendGmailEmail(gmailConfig, email);
    if (successLog) {
      console.log(JSON.stringify({ event: "canvas_reminder_sent", ...successLog }));
    }
  } catch (mailError) {
    console.error(
      JSON.stringify({ event: "gmail_delivery_failed", category: errorCategory(mailError) })
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
