import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAssignments } from "../src/reminder.ts";
import type { CanvasAssignment } from "../src/types.ts";

const course = { id: 42, name: "ELECTENG 204" };

function assignment(
  id: number,
  name: string,
  due_at: string,
  state = "unsubmitted"
): CanvasAssignment {
  return {
    id,
    name,
    due_at,
    html_url: `https://canvas.auckland.ac.nz/courses/42/assignments/${id}`,
    submission: { workflow_state: state }
  };
}

test("today overdue and tomorrow incomplete work are returned; submitted work is excluded", async () => {
  const now = new Date("2026-08-07T03:00:00Z"); // Auckland 15:00
  const result = await evaluateAssignments(
    [
      {
        course,
        assignments: [
          assignment(1, "Earlier today", "2026-08-06T22:00:00Z"),
          assignment(2, "Tomorrow", "2026-08-08T04:00:00Z"),
          assignment(3, "Submitted", "2026-08-08T04:00:00Z", "submitted")
        ]
      }
    ],
    now,
    async () => ({ id: 1, time_limit: null })
  );

  assert.equal(result.kind, "primary");
  if (result.kind === "primary") {
    assert.deepEqual(result.items.map((item) => item.assignment.id), [1, 2]);
    assert.equal(result.items[0].overdue, true);
    assert.equal(result.items[1].group, "tomorrow");
  }
});

test("major fallback runs only when today and tomorrow are empty", async () => {
  const now = new Date("2026-08-07T03:00:00Z");
  const result = await evaluateAssignments(
    [
      {
        course,
        assignments: [
          assignment(4, "Design report", "2026-08-11T04:00:00Z"),
          assignment(5, "Small exercise", "2026-08-12T04:00:00Z")
        ]
      }
    ],
    now,
    async () => ({ id: 1, time_limit: null })
  );

  assert.equal(result.kind, "major");
  if (result.kind === "major") {
    assert.deepEqual(result.items.map((item) => item.assignment.id), [4]);
  }
});

test("empty result is explicit when no qualifying work exists", async () => {
  const result = await evaluateAssignments(
    [{ course, assignments: [assignment(5, "Small exercise", "2026-08-12T04:00:00Z")] }],
    new Date("2026-08-07T03:00:00Z"),
    async () => ({ id: 1, time_limit: null })
  );
  assert.equal(result.kind, "empty");
});

test("fallback includes the whole seventh Auckland calendar day", async () => {
  const result = await evaluateAssignments(
    [
      {
        course,
        assignments: [
          assignment(6, "Test 1", "2026-08-19T06:50:00Z"), // Wednesday 18:50 NZST
          assignment(7, "Test 2", "2026-08-19T12:30:00Z") // Thursday 00:30 NZST
        ]
      }
    ],
    new Date("2026-08-12T03:00:00Z"), // Wednesday 15:00 NZST
    async () => ({ id: 1, time_limit: null })
  );

  assert.equal(result.kind, "major");
  if (result.kind === "major") {
    assert.deepEqual(result.items.map((item) => item.assignment.id), [6]);
  }
});
