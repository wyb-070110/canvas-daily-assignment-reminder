import assert from "node:assert/strict";
import test from "node:test";
import { classifyMajorAssignment, isIncomplete } from "../src/classifier.ts";
import type { AssignmentWithCourse, CanvasAssignment } from "../src/types.ts";

const baseAssignment: CanvasAssignment = {
  id: 1,
  name: "Task",
  due_at: "2026-08-10T04:00:00Z",
  submission: { workflow_state: "unsubmitted" }
};

test("completion state excludes submitted, graded, pending review, and excused work", () => {
  assert.equal(isIncomplete({ ...baseAssignment, submission: null }), true);
  assert.equal(isIncomplete(baseAssignment), true);
  for (const workflow_state of ["submitted", "graded", "pending_review"]) {
    assert.equal(isIncomplete({ ...baseAssignment, submission: { workflow_state } }), false);
  }
  assert.equal(isIncomplete({ ...baseAssignment, submission: { excused: true } }), false);
  assert.equal(
    isIncomplete({ ...baseAssignment, submission: { submitted_at: "2026-08-01T00:00:00Z" } }),
    false
  );
});

test("major classifier recognizes reports and quizzes longer than 60 minutes", async () => {
  const item: AssignmentWithCourse = {
    course: { id: 10, name: "Course" },
    assignment: { ...baseAssignment, name: "Final lab report" },
    dueAt: new Date(baseAssignment.due_at!)
  };
  const report = await classifyMajorAssignment(item, async () => ({ id: 1, time_limit: 10 }));
  assert.equal(report?.probable, false);
  assert.match(report?.reason ?? "", /报告/);

  const quiz = await classifyMajorAssignment(
    { ...item, assignment: { ...baseAssignment, name: "Quiz 5", quiz_id: 5 } },
    async () => ({ id: 5, time_limit: 90 })
  );
  assert.equal(quiz?.reason, "Quiz 时限 90 分钟");
});

test("unknown short quizzes are not guessed to be major", async () => {
  const item: AssignmentWithCourse = {
    course: { id: 10, name: "Course" },
    assignment: { ...baseAssignment, name: "Quiz 5", quiz_id: 5 },
    dueAt: new Date(baseAssignment.due_at!)
  };
  const result = await classifyMajorAssignment(item, async () => ({ id: 5, time_limit: 60 }));
  assert.equal(result, null);
});
