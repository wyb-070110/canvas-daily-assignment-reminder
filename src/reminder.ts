import { classifyMajorAssignment, isIncomplete } from "./classifier.ts";
import { addCalendarDays, aucklandDateKey } from "./time.ts";
import type { CanvasReader } from "./canvas.ts";
import type {
  AssignmentWithCourse,
  CanvasAssignment,
  CanvasCourse,
  CanvasQuiz,
  ReminderResult
} from "./types.ts";

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker())
  );
  return results;
}

function toDatedAssignments(
  course: CanvasCourse,
  assignments: CanvasAssignment[]
): AssignmentWithCourse[] {
  const dated: AssignmentWithCourse[] = [];
  for (const assignment of assignments) {
    if (!assignment.due_at || !isIncomplete(assignment)) continue;
    const dueAt = new Date(assignment.due_at);
    if (Number.isNaN(dueAt.getTime())) continue;
    dated.push({ course, assignment, dueAt });
  }
  return dated;
}

export async function evaluateAssignments(
  coursesAndAssignments: Array<{
    course: CanvasCourse;
    assignments: CanvasAssignment[];
  }>,
  generatedAt: Date,
  loadQuiz: (courseId: number, quizId: number) => Promise<CanvasQuiz>
): Promise<ReminderResult> {
  const all = coursesAndAssignments.flatMap(({ course, assignments }) =>
    toDatedAssignments(course, assignments)
  );
  const today = aucklandDateKey(generatedAt);
  const tomorrow = addCalendarDays(today, 1);

  const primary = all
    .filter((item) => {
      const dueDate = aucklandDateKey(item.dueAt);
      return dueDate === today || dueDate === tomorrow;
    })
    .map((item) => ({
      ...item,
      group: aucklandDateKey(item.dueAt) === today ? ("today" as const) : ("tomorrow" as const),
      overdue: item.dueAt.getTime() < generatedAt.getTime()
    }))
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());

  if (primary.length > 0) {
    return { kind: "primary", generatedAt, items: primary };
  }

  const seventhAucklandDay = addCalendarDays(today, 7);
  const candidates = all.filter(
    (item) =>
      item.dueAt.getTime() >= generatedAt.getTime() &&
      aucklandDateKey(item.dueAt) <= seventhAucklandDay
  );

  const classified = await mapWithConcurrency(candidates, 4, (item) =>
    classifyMajorAssignment(item, loadQuiz)
  );
  const major = classified
    .filter((item) => item !== null)
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());

  if (major.length > 0) {
    return { kind: "major", generatedAt, items: major };
  }

  return { kind: "empty", generatedAt, items: [] };
}

export async function buildReminder(
  canvas: CanvasReader,
  generatedAt: Date
): Promise<ReminderResult> {
  const courses = await canvas.listActiveStudentCourses();
  const coursesAndAssignments = await mapWithConcurrency(courses, 4, async (course) => ({
    course,
    assignments: await canvas.listAssignments(course.id)
  }));

  return evaluateAssignments(
    coursesAndAssignments,
    generatedAt,
    (courseId, quizId) => canvas.getQuiz(courseId, quizId)
  );
}
