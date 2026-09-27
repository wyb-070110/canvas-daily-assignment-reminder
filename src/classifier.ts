import type {
  AssignmentWithCourse,
  CanvasAssignment,
  CanvasQuiz,
  MajorReminderItem
} from "./types.ts";

const COMPLETED_STATES = new Set(["submitted", "graded", "pending_review"]);

const EXAM_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:mid[ -]?semester|midterm|final)\s+(?:exam(?:ination)?|test)\b/i, "考试"],
  [/\b(?:exam(?:ination)?|test)\b/i, "考试"],
  [/考试/i, "考试"]
];

const STRONG_PATTERNS: Array<[RegExp, string]> = [
  [/\blab(?:oratory)?\s+report\b/i, "实验报告"],
  [/\b(?:technical|design|research|final|project)\s+report\b/i, "报告"],
  [/\breport\b/i, "报告"],
  [/\bessay\b|\bresearch\s+paper\b|\bterm\s+paper\b/i, "论文"],
  [/\bproject\b|\bcapstone\b/i, "项目"],
  [/\bjournal\b|\bdiary\b|\blogbook\b/i, "日志"],
  [/\bportfolio\b/i, "作品集"],
  [/\bpresentation\b/i, "演示"],
  [/论文|报告|项目|日志|作品集|演示/i, "长任务类型"]
];

const PROBABLE_PATTERNS: Array<[RegExp, string]> = [
  [/\bcase\s+study\b/i, "案例分析"],
  [/\breflection\b|\breflective\b/i, "反思作业"],
  [/\bdesign\b/i, "设计任务"],
  [/\binvestigation\b/i, "研究任务"],
  [/案例分析|反思|设计任务|研究任务/i, "可能的长任务"]
];

function plainText(value: string | null | undefined): string {
  return (value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function isIncomplete(assignment: CanvasAssignment): boolean {
  const submission = assignment.submission;
  if (submission?.excused) return false;
  if (submission?.submitted_at) return false;

  const state = submission?.workflow_state?.toLowerCase();
  if (state && COMPLETED_STATES.has(state)) return false;
  return true;
}

function firstMatch(
  value: string,
  patterns: Array<[RegExp, string]>
): string | null {
  for (const [pattern, label] of patterns) {
    if (pattern.test(value)) return label;
  }
  return null;
}

export async function classifyMajorAssignment(
  item: AssignmentWithCourse,
  loadQuiz: (courseId: number, quizId: number) => Promise<CanvasQuiz>
): Promise<MajorReminderItem | null> {
  const title = item.assignment.name;
  const description = plainText(item.assignment.description);

  if (!item.assignment.quiz_id) {
    const examTitle = firstMatch(title, EXAM_PATTERNS);
    if (examTitle) {
      return { ...item, reason: `类型：${examTitle}`, probable: false };
    }

    const examDescription = firstMatch(description, EXAM_PATTERNS);
    if (examDescription) {
      return { ...item, reason: `说明中显示：${examDescription}`, probable: false };
    }
  }

  const strongTitle = firstMatch(title, STRONG_PATTERNS);
  if (strongTitle) {
    return { ...item, reason: `类型：${strongTitle}`, probable: false };
  }

  const strongDescription = firstMatch(description, STRONG_PATTERNS);
  if (strongDescription) {
    return { ...item, reason: `说明中显示：${strongDescription}`, probable: false };
  }

  if (item.assignment.quiz_id) {
    const quiz = await loadQuiz(item.course.id, item.assignment.quiz_id);
    if (typeof quiz.time_limit === "number" && quiz.time_limit > 60) {
      return {
        ...item,
        reason: `Quiz 时限 ${quiz.time_limit} 分钟`,
        probable: false
      };
    }
  }

  const probableTitle = firstMatch(title, PROBABLE_PATTERNS);
  if (probableTitle) {
    return { ...item, reason: `名称显示：${probableTitle}`, probable: true };
  }

  return null;
}
