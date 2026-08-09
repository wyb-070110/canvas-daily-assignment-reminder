import assert from "node:assert/strict";
import test from "node:test";
import {
  addCalendarDays,
  aucklandDateKey,
  isAucklandThreePm
} from "../src/time.ts";

test("Auckland 15:00 gate handles daylight saving time", () => {
  assert.equal(isAucklandThreePm(new Date("2026-01-15T02:00:00Z")), true);
  assert.equal(isAucklandThreePm(new Date("2026-08-15T03:00:00Z")), true);
  assert.equal(isAucklandThreePm(new Date("2026-01-15T03:00:00Z")), false);
  assert.equal(isAucklandThreePm(new Date("2026-08-15T02:00:00Z")), false);
});

test("Auckland date keys and calendar arithmetic cross month boundaries", () => {
  assert.equal(aucklandDateKey(new Date("2026-08-07T03:00:00Z")), "2026-08-07");
  assert.equal(addCalendarDays("2026-08-31", 1), "2026-09-01");
});
