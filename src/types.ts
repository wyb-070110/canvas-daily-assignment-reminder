export interface CanvasCourse {
  id: number;
  name: string;
  course_code?: string;
}

export interface CanvasSubmission {
  workflow_state?: string | null;
  submitted_at?: string | null;
  excused?: boolean | null;
}

export interface CanvasAssignment {
  id: number;
  name: string;
  description?: string | null;
  due_at?: string | null;
  html_url?: string | null;
  quiz_id?: number | null;
  submission_types?: string[];
  submission?: CanvasSubmission | null;
}

export interface CanvasQuiz {
  id: number;
  title?: string;
  time_limit?: number | null;
}

export interface AssignmentWithCourse {
  assignment: CanvasAssignment;
  course: CanvasCourse;
  dueAt: Date;
}

export interface PrimaryReminderItem extends AssignmentWithCourse {
  group: "today" | "tomorrow";
  overdue: boolean;
}

export interface MajorReminderItem extends AssignmentWithCourse {
  reason: string;
  probable: boolean;
}

export type ReminderResult =
  | {
      kind: "primary";
      generatedAt: Date;
      items: PrimaryReminderItem[];
    }
  | {
      kind: "major";
      generatedAt: Date;
      items: MajorReminderItem[];
    }
  | {
      kind: "empty";
      generatedAt: Date;
      items: [];
    };

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export type FetchLike = typeof fetch;
