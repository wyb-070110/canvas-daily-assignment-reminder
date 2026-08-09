import type {
  CanvasAssignment,
  CanvasCourse,
  CanvasQuiz
} from "./types.ts";

export const CANVAS_BASE_URL = "https://canvas.auckland.ac.nz";

export interface CanvasReader {
  listActiveStudentCourses(): Promise<CanvasCourse[]>;
  listAssignments(courseId: number): Promise<CanvasAssignment[]>;
  getQuiz(courseId: number, quizId: number): Promise<CanvasQuiz>;
}
