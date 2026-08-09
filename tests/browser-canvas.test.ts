import assert from "node:assert/strict";
import test from "node:test";
import {
  BrowserCanvasClient,
  loginToCanvas,
  type BrowserPageLike
} from "../src/browser-canvas.ts";
import { SafeHttpError } from "../src/http.ts";

function mockApiPage(responses: Array<{ status: number; link: string | null; body: string }>): {
  page: BrowserPageLike;
  calls: string[];
} {
  const calls: string[] = [];
  let index = 0;
  const page: BrowserPageLike = {
    url: () => "https://canvas.auckland.ac.nz/",
    navigateTo: async () => undefined,
    findElement: async () => null,
    waitForNavigation: async () => undefined,
    bodyText: async () => "",
    currentUserStatus: async () => 200,
    apiGet: async (url) => {
      calls.push(url);
      return responses[index++];
    }
  };
  return { page, calls };
}

test("browser Canvas client follows Link pagination", async () => {
  const { page, calls } = mockApiPage([
    {
      status: 200,
      link: '<https://canvas.auckland.ac.nz/api/v1/courses?page=2>; rel="next"',
      body: JSON.stringify([{ id: 1, name: "Course 1" }])
    },
    { status: 200, link: null, body: JSON.stringify([{ id: 2, name: "Course 2" }]) }
  ]);

  const courses = await new BrowserCanvasClient(page).listActiveStudentCourses();
  assert.deepEqual(courses.map((course) => course.id), [1, 2]);
  assert.equal(calls.length, 2);
});

test("browser Canvas client refuses an off-domain next link", async () => {
  const { page, calls } = mockApiPage([
    {
      status: 200,
      link: '<https://evil.example/collect>; rel="next"',
      body: JSON.stringify([{ id: 1, name: "Course 1" }])
    }
  ]);

  await assert.rejects(
    () => new BrowserCanvasClient(page).listActiveStudentCourses(),
    (error: unknown) => error instanceof SafeHttpError && error.category === "UPSTREAM"
  );
  assert.equal(calls.length, 1);
});

test("browser Canvas 401 fails without retrying", async () => {
  const { page, calls } = mockApiPage([{ status: 401, link: null, body: "" }]);
  await assert.rejects(
    () => new BrowserCanvasClient(page).listActiveStudentCourses(),
    (error: unknown) => error instanceof SafeHttpError && error.category === "AUTH"
  );
  assert.equal(calls.length, 1);
});

test("Canvas login retries page reads during a redirect", async () => {
  let bodyTextCalls = 0;
  const page: BrowserPageLike = {
    url: () => "https://login.example/",
    navigateTo: async () => undefined,
    findElement: async () => null,
    waitForNavigation: async () => undefined,
    bodyText: async () => {
      bodyTextCalls += 1;
      if (bodyTextCalls === 1) throw new Error("Execution context was destroyed");
      return "Verify your identity";
    },
    currentUserStatus: async () => 0,
    apiGet: async () => ({ status: 0, link: null, body: "" })
  };

  await assert.rejects(
    () => loginToCanvas(page, "user", "password"),
    (error: unknown) => error instanceof SafeHttpError && error.category === "AUTH"
  );
  assert.equal(bodyTextCalls, 2);
});
