import assert from "node:assert/strict";
import test from "node:test";
import { retryTransientRun, SafeHttpError } from "../src/http.ts";

test("transient Canvas run failure is retried once and then succeeds", async () => {
  let calls = 0;
  const retries: number[] = [];
  const result = await retryTransientRun(
    async () => {
      calls += 1;
      if (calls === 1) throw new SafeHttpError("Browser Run launch failed", "UPSTREAM");
      return "ok";
    },
    { delayMs: 0, onRetry: (_error, attempt) => retries.push(attempt) }
  );

  assert.equal(result, "ok");
  assert.equal(calls, 2);
  assert.deepEqual(retries, [1]);
});

test("Canvas AUTH, CONFIG and RATE_LIMIT failures are never retried", async () => {
  for (const error of [
    new SafeHttpError("Canvas login was rejected", "AUTH"),
    new Error("Missing configuration: CANVAS_PASSWORD"),
    new SafeHttpError("Canvas browser request failed", "RATE_LIMIT", 429)
  ]) {
    let calls = 0;
    await assert.rejects(
      retryTransientRun(
        async () => {
          calls += 1;
          throw error;
        },
        { delayMs: 0 }
      ),
      error
    );
    assert.equal(calls, 1);
  }
});

test("repeated transient Canvas failures surface after the last attempt", async () => {
  let calls = 0;
  await assert.rejects(
    retryTransientRun(
      async () => {
        calls += 1;
        throw new SafeHttpError("Canvas browser request failed", "NETWORK");
      },
      { delayMs: 0 }
    ),
    (error: unknown) => error instanceof SafeHttpError && error.category === "NETWORK"
  );
  assert.equal(calls, 2);
});
