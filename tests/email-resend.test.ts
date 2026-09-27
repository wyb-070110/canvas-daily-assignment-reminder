import assert from "node:assert/strict";
import test from "node:test";
import { renderReminderEmail } from "../src/email.ts";
import { SafeHttpError } from "../src/http.ts";
import { buildResendPayload, sendResendEmail } from "../src/resend.ts";
import type { FetchLike, ReminderResult } from "../src/types.ts";

const rendered = {
  subject: "Canvas：测试提醒",
  html: "<p>测试内容</p>",
  text: "测试内容"
};

test("email renderer escapes untrusted Canvas content and replaces off-domain links", () => {
  const result: ReminderResult = {
    kind: "primary",
    generatedAt: new Date("2026-08-07T03:00:00Z"),
    items: [
      {
        course: { id: 1, name: '<script>alert("x")</script>' },
        assignment: {
          id: 2,
          name: "Report <img src=x>",
          due_at: "2026-08-08T04:00:00Z",
          html_url: "https://evil.example/steal",
          submission: { workflow_state: "unsubmitted" }
        },
        dueAt: new Date("2026-08-08T04:00:00Z"),
        group: "tomorrow",
        overdue: false
      }
    ]
  };
  const email = renderReminderEmail(result);
  assert.doesNotMatch(email.html, /<script>|<img/);
  assert.doesNotMatch(email.html, /evil\.example/);
  assert.match(email.html, /canvas\.auckland\.ac\.nz/);
});

test("Resend payload keeps UTF-8 content and a display name", () => {
  const payload = buildResendPayload(
    { from: "onboarding@resend.dev", to: "recipient@example.com" },
    rendered
  );
  assert.equal(payload.from, "Canvas 作业提醒 <onboarding@resend.dev>");
  assert.deepEqual(payload.to, ["recipient@example.com"]);
  assert.equal(payload.subject, rendered.subject);
  assert.equal(payload.html, rendered.html);
  assert.equal(payload.text, rendered.text);
  assert.equal("bcc" in payload, false);
});

test("Resend payload sends the backup recipient as Bcc", () => {
  const payload = buildResendPayload(
    { from: "alerts@example.com", to: "primary@example.com", bcc: "backup@example.com" },
    rendered
  );
  assert.deepEqual(payload.to, ["primary@example.com"]);
  assert.deepEqual(payload.bcc, ["backup@example.com"]);
});

test("Resend payload rejects header injection in addresses", () => {
  assert.throws(
    () =>
      buildResendPayload(
        { from: "onboarding@resend.dev", to: "a@example.com\r\nBcc: x@example.com" },
        rendered
      ),
    (error: unknown) => error instanceof SafeHttpError && error.category === "CONFIG"
  );
});

test("Resend API key stays in the Authorization header only", async () => {
  let calls = 0;
  const fetcher: FetchLike = async (input, init) => {
    calls += 1;
    assert.equal(String(input), "https://api.resend.com/emails");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Authorization"), "Bearer re_secret");
    assert.match(headers.get("Idempotency-Key") ?? "", /^canvas-reminder\//);
    assert.doesNotMatch(String(init?.body), /re_secret/);
    return Response.json({ id: "message-id" });
  };

  await sendResendEmail(
    { apiKey: "re_secret", from: "onboarding@resend.dev", to: "recipient@example.com" },
    rendered,
    fetcher
  );
  assert.equal(calls, 1);
});

test("Resend retries reuse the same idempotency key", async () => {
  const keys: string[] = [];
  const fetcher: FetchLike = async (_input, init) => {
    keys.push(new Headers(init?.headers).get("Idempotency-Key") ?? "");
    if (keys.length === 1) return new Response("unavailable", { status: 503 });
    return Response.json({ id: "message-id" });
  };

  await sendResendEmail(
    { apiKey: "re_secret", from: "onboarding@resend.dev", to: "recipient@example.com" },
    rendered,
    fetcher
  );
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
});

test("Resend rejected API key is reported as AUTH and not retried", async () => {
  let calls = 0;
  const fetcher: FetchLike = async () => {
    calls += 1;
    return new Response('{"name":"invalid_api_key"}', { status: 403 });
  };
  await assert.rejects(
    () =>
      sendResendEmail(
        { apiKey: "re_bad", from: "onboarding@resend.dev", to: "recipient@example.com" },
        rendered,
        fetcher
      ),
    (error: unknown) => error instanceof SafeHttpError && error.category === "AUTH"
  );
  assert.equal(calls, 1);
});
