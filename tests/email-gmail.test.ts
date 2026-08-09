import assert from "node:assert/strict";
import test from "node:test";
import { renderReminderEmail } from "../src/email.ts";
import { buildGmailRawMessage, sendGmailEmail } from "../src/gmail.ts";
import { SafeHttpError } from "../src/http.ts";
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

test("Gmail MIME message is UTF-8 base64url encoded", () => {
  const raw = buildGmailRawMessage(
    { from: "sender@gmail.com", to: "recipient@example.com" },
    rendered
  );
  assert.doesNotMatch(raw, /[+/=]/);
  const padding = "=".repeat((4 - (raw.length % 4)) % 4);
  const padded = raw.replaceAll("-", "+").replaceAll("_", "/") + padding;
  const mime = Buffer.from(padded, "base64").toString("utf8");
  assert.match(mime, /From: .+ <sender@gmail\.com>/);
  assert.match(mime, /To: recipient@example\.com/);
  assert.match(mime, /multipart\/alternative/);
});

test("Gmail OAuth secret and access token stay in their intended requests", async () => {
  let calls = 0;
  const fetcher: FetchLike = async (input, init) => {
    calls += 1;
    if (String(input) === "https://oauth2.googleapis.com/token") {
      assert.match(String(init?.body), /refresh_token=refresh-secret/);
      assert.equal(new Headers(init?.headers).get("Authorization"), null);
      return Response.json({ access_token: "short-access-token" });
    }
    assert.equal(
      String(input),
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
    );
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer short-access-token");
    assert.doesNotMatch(String(init?.body), /refresh-secret|short-access-token/);
    return Response.json({ id: "message-id" });
  };

  await sendGmailEmail(
    {
      clientId: "client-id",
      clientSecret: "client-secret",
      refreshToken: "refresh-secret",
      from: "sender@gmail.com",
      to: "recipient@example.com"
    },
    rendered,
    fetcher
  );
  assert.equal(calls, 2);
});

test("Gmail invalid refresh token is not retried", async () => {
  let calls = 0;
  const fetcher: FetchLike = async () => {
    calls += 1;
    return new Response("invalid_grant", { status: 400 });
  };
  await assert.rejects(
    () =>
      sendGmailEmail(
        {
          clientId: "client-id",
          clientSecret: "client-secret",
          refreshToken: "bad-refresh-token",
          from: "sender@gmail.com",
          to: "recipient@example.com"
        },
        rendered,
        fetcher
      ),
    (error: unknown) => error instanceof SafeHttpError && error.category === "AUTH"
  );
  assert.equal(calls, 1);
});
