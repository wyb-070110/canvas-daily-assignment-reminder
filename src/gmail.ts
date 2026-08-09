import { fetchWithRetry, SafeHttpError } from "./http.ts";
import type { FetchLike, RenderedEmail } from "./types.ts";

export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  from: string;
  to: string;
}

interface TokenResponse {
  access_token?: string;
}

function assertEmailHeader(value: string, label: string): void {
  if (!value || value.length > 254 || /[\r\n]/.test(value) || !value.includes("@")) {
    throw new SafeHttpError(`Invalid ${label} email configuration`, "CONFIG");
  }
}

function bytesToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
  }
  return btoa(binary);
}

function base64Url(value: string): string {
  return bytesToBase64(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function wrapBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function encodeHeader(value: string): string {
  return `=?UTF-8?B?${bytesToBase64(value)}?=`;
}

export function buildGmailRawMessage(
  config: Pick<GmailConfig, "from" | "to">,
  email: RenderedEmail
): string {
  assertEmailHeader(config.from, "sender");
  assertEmailHeader(config.to, "recipient");
  const boundary = `canvas-reminder-${crypto.randomUUID()}`;
  const mime = [
    `From: ${encodeHeader("Canvas 作业提醒")} <${config.from}>`,
    `To: ${config.to}`,
    `Subject: ${encodeHeader(email.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(bytesToBase64(email.text)),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(bytesToBase64(email.html)),
    `--${boundary}--`,
    ""
  ].join("\r\n");
  return base64Url(mime);
}

async function refreshAccessToken(
  config: GmailConfig,
  fetcher: FetchLike
): Promise<string> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token"
  }).toString();

  let response: Response;
  try {
    response = await fetchWithRetry(
      fetcher,
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body
      },
      { attempts: 3, timeoutMs: 10_000 }
    );
  } catch (error) {
    if (error instanceof SafeHttpError && error.status === 400) {
      throw new SafeHttpError("Gmail OAuth authorization was rejected", "AUTH", 400);
    }
    throw error;
  }

  const text = await response.text();
  if (text.length > 100_000) {
    throw new SafeHttpError("Gmail OAuth returned an oversized response", "UPSTREAM");
  }
  let payload: TokenResponse;
  try {
    payload = JSON.parse(text) as TokenResponse;
  } catch {
    throw new SafeHttpError("Gmail OAuth returned invalid JSON", "UPSTREAM");
  }
  if (!payload.access_token) {
    throw new SafeHttpError("Gmail OAuth did not return an access token", "AUTH");
  }
  return payload.access_token;
}

export async function sendGmailEmail(
  config: GmailConfig,
  email: RenderedEmail,
  fetcher: FetchLike = fetch
): Promise<void> {
  const accessToken = await refreshAccessToken(config, fetcher);
  const raw = buildGmailRawMessage(config, email);
  await fetchWithRetry(
    fetcher,
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ raw })
    },
    { attempts: 3, timeoutMs: 10_000 }
  );
}
