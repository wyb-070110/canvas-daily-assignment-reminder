import type { Page } from "@cloudflare/puppeteer";
import { CANVAS_BASE_URL, type CanvasReader } from "./canvas.ts";
import { parseNextLink, SafeHttpError } from "./http.ts";
import type {
  CanvasAssignment,
  CanvasCourse,
  CanvasQuiz
} from "./types.ts";

interface BrowserElementLike {
  click(options?: { clickCount?: number }): Promise<void>;
  press(key: "Enter"): Promise<void>;
  type(value: string, options?: { delay?: number }): Promise<void>;
}

export interface BrowserPageLike {
  url(): string;
  navigateTo(url: string): Promise<void>;
  findElement(selector: string): Promise<BrowserElementLike | null>;
  waitForNavigation(): Promise<void>;
  bodyText(): Promise<string>;
  currentUserStatus(): Promise<number>;
  apiGet(url: string): Promise<BrowserApiResponse>;
}

interface BrowserApiResponse {
  status: number;
  link: string | null;
  body: string;
  tooLarge?: boolean;
}

const USERNAME_SELECTORS = [
  "input[type='email']",
  "input[name='loginfmt']",
  "#userNameInput",
  "input[name='username']",
  "input[name='j_username']",
  "input[name='pseudonym_session[unique_id]']",
  "#username"
];

const PASSWORD_SELECTORS = [
  "input[type='password']",
  "input[name='passwd']",
  "#passwordInput",
  "input[name='j_password']",
  "input[name='pseudonym_session[password]']",
  "#password"
];

const SUBMIT_SELECTORS = [
  "#idSIButton9",
  "#submitButton",
  "button[type='submit']",
  "input[type='submit']",
  "button[name='_eventId_proceed']"
];

const API_TIMEOUT_MS = 15_000;
const MAX_API_BODY_CHARS = 2_000_000;

export class PuppeteerCanvasPage implements BrowserPageLike {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  url(): string {
    return this.page.url();
  }

  async navigateTo(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }

  async findElement(selector: string): Promise<BrowserElementLike | null> {
    const element = await this.page.$(selector);
    if (!element) return null;
    return {
      click: async (options) => element.click(options),
      press: async (key) => element.press(key),
      type: async (value, options) => element.type(value, options)
    };
  }

  async waitForNavigation(): Promise<void> {
    await this.page
      .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 })
      .then(() => undefined);
  }

  bodyText(): Promise<string> {
    return this.page.evaluate(() => document.body?.innerText || "");
  }

  currentUserStatus(): Promise<number> {
    return this.page.evaluate(async (timeoutMs) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch("/api/v1/users/self", {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json" },
          signal: controller.signal
        });
        return response.status;
      } catch {
        return 0;
      } finally {
        clearTimeout(timeout);
      }
    }, API_TIMEOUT_MS);
  }

  apiGet(url: string): Promise<BrowserApiResponse> {
    return this.page.evaluate(
      async (targetUrl, timeoutMs, maxBodyChars) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(targetUrl, {
            method: "GET",
            credentials: "include",
            headers: { Accept: "application/json" },
            signal: controller.signal
          });
          const contentLength = Number(response.headers.get("Content-Length") || "0");
          if (contentLength > maxBodyChars) {
            return { status: response.status, link: null, body: "", tooLarge: true };
          }
          const body = await response.text();
          return {
            status: response.status,
            link: response.headers.get("Link"),
            body: body.length <= maxBodyChars ? body : "",
            tooLarge: body.length > maxBodyChars
          };
        } catch {
          return { status: 0, link: null, body: "", tooLarge: false };
        } finally {
          clearTimeout(timeout);
        }
      },
      url,
      API_TIMEOUT_MS,
      MAX_API_BODY_CHARS
    );
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function firstElement(
  page: BrowserPageLike,
  selectors: string[]
): Promise<BrowserElementLike | null> {
  for (const selector of selectors) {
    const element = await page.findElement(selector);
    if (element) return element;
  }
  return null;
}

async function replaceValue(element: BrowserElementLike, value: string): Promise<void> {
  await element.click({ clickCount: 3 });
  await element.type(value, { delay: 20 });
}

async function clickAndWait(page: BrowserPageLike, element: BrowserElementLike): Promise<void> {
  const previousUrl = page.url();
  const navigation = page.waitForNavigation().catch(() => undefined);
  try {
    await element.click();
  } catch (clickError) {
    await delay(250);
    if (page.url() === previousUrl) {
      try {
        await element.press("Enter");
      } catch (pressError) {
        throw new SafeHttpError(
          `Canvas login submit failed (${automationErrorCode(clickError)}; ${automationErrorCode(pressError)})`,
          "UPSTREAM"
        );
      }
    }
  }
  await navigation;
  await delay(500);
}

async function pageText(page: BrowserPageLike): Promise<string> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await page.bodyText();
    } catch (error) {
      const transient = automationErrorCode(error) === "execution_context";
      if (!transient || attempt === 5) throw error;
      await delay(300 * attempt);
    }
  }
  return "";
}

function currentHost(page: BrowserPageLike): string {
  try {
    return new URL(page.url()).hostname;
  } catch {
    return "";
  }
}

function automationErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("execution context")) return "execution_context";
  if (message.includes("detached")) return "detached_node";
  if (message.includes("target closed") || message.includes("session closed")) {
    return "target_closed";
  }
  if (message.includes("timeout")) return "timeout";
  if (message.includes("not clickable") || message.includes("not an element")) {
    return "not_clickable";
  }
  if (message.includes("protocol")) return "protocol";
  if (message.includes("navigation")) return "navigation";
  return "unclassified";
}

async function authenticatedProbe(page: BrowserPageLike): Promise<boolean> {
  if (currentHost(page) !== "canvas.auckland.ac.nz") return false;

  return (await page.currentUserStatus()) === 200;
}

export async function loginToCanvas(
  page: BrowserPageLike,
  username: string,
  password: string
): Promise<void> {
  let stage = "navigate_canvas";
  try {
    await page.navigateTo(CANVAS_BASE_URL);

    for (let step = 0; step < 8; step += 1) {
      stage = `step_${step}_probe`;
      if (await authenticatedProbe(page)) return;

      stage = `step_${step}_read_page`;
      const text = (await pageText(page)).toLowerCase();
      if (
        /approve sign[ -]?in|verification code|multi-factor|two-factor|authenticator|verify your identity/.test(
          text
        )
      ) {
        throw new SafeHttpError("Canvas login requires additional verification", "AUTH");
      }
      if (/incorrect|invalid password|couldn't sign you in|account.*locked|login failed/.test(text)) {
        throw new SafeHttpError("Canvas login was rejected", "AUTH");
      }
      if (/captcha|unusual activity|verify you are human/.test(text)) {
        throw new SafeHttpError("Canvas login was blocked by an interactive challenge", "AUTH");
      }

      stage = `step_${step}_find_username`;
      const usernameInput = await firstElement(page, USERNAME_SELECTORS);
      stage = `step_${step}_find_password`;
      const passwordInput = await firstElement(page, PASSWORD_SELECTORS);
      let enteredCredentials = false;

      if (usernameInput) {
        stage = `step_${step}_enter_username`;
        await replaceValue(usernameInput, username);
        enteredCredentials = true;
      }
      if (passwordInput) {
        stage = `step_${step}_enter_password`;
        await replaceValue(passwordInput, password);
        enteredCredentials = true;
      }

      if (enteredCredentials) {
        stage = `step_${step}_find_submit`;
        const submit = await firstElement(page, SUBMIT_SELECTORS);
        if (!submit) throw new SafeHttpError("Canvas login form was not recognized", "AUTH");
        stage = `step_${step}_submit`;
        await clickAndWait(page, submit);
        continue;
      }

      stage = `step_${step}_find_stay_signed_in`;
      const declineStaySignedIn = await page.findElement("#idBtn_Back");
      if (declineStaySignedIn) {
        stage = `step_${step}_decline_stay_signed_in`;
        await clickAndWait(page, declineStaySignedIn);
        continue;
      }

      stage = `step_${step}_wait`;
      await delay(1_000);
    }

    throw new SafeHttpError("Canvas login did not complete", "AUTH");
  } catch (error) {
    if (error instanceof SafeHttpError) throw error;
    throw new SafeHttpError(
      `Canvas login automation failed at ${stage} (${automationErrorCode(error)})`,
      "UPSTREAM"
    );
  }
}

export class BrowserCanvasClient implements CanvasReader {
  readonly page: BrowserPageLike;

  constructor(page: BrowserPageLike) {
    this.page = page;
  }

  private assertSafeCanvasUrl(value: string): void {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new SafeHttpError("Canvas returned an invalid pagination URL", "UPSTREAM");
    }
    if (url.origin !== CANVAS_BASE_URL) {
      throw new SafeHttpError("Canvas returned an unsafe pagination URL", "UPSTREAM");
    }
  }

  private async browserGet(url: string): Promise<BrowserApiResponse> {
    this.assertSafeCanvasUrl(url);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await this.page.apiGet(url);

      if (result.tooLarge) {
        throw new SafeHttpError("Canvas response exceeded the safe size limit", "UPSTREAM");
      }

      if (result.status >= 200 && result.status < 300) return result;
      if (result.status === 401 || result.status === 403) {
        throw new SafeHttpError("Canvas session is unauthorized", "AUTH", result.status);
      }

      const retryable =
        result.status === 0 ||
        result.status === 408 ||
        result.status === 425 ||
        result.status === 429 ||
        result.status >= 500;
      if (!retryable || attempt === 3) {
        const category =
          result.status === 429
            ? "RATE_LIMIT"
            : result.status >= 500
              ? "UPSTREAM"
              : "NETWORK";
        throw new SafeHttpError(
          "Canvas browser request failed",
          category,
          result.status || undefined
        );
      }
      await delay(150 * 2 ** (attempt - 1));
    }

    throw new SafeHttpError("Canvas browser request failed", "UNKNOWN");
  }

  private async getAllPages<T>(firstUrl: string): Promise<T[]> {
    const values: T[] = [];
    const visited = new Set<string>();
    let url: string | null = firstUrl;

    while (url) {
      if (visited.has(url) || visited.size >= 100) {
        throw new SafeHttpError("Canvas pagination was incomplete", "UPSTREAM");
      }
      visited.add(url);
      const response: BrowserApiResponse = await this.browserGet(url);

      let pageValues: unknown;
      try {
        pageValues = JSON.parse(response.body);
      } catch {
        throw new SafeHttpError("Canvas returned invalid JSON", "UPSTREAM");
      }
      if (!Array.isArray(pageValues)) {
        throw new SafeHttpError("Canvas returned an unexpected payload", "UPSTREAM");
      }

      values.push(...(pageValues as T[]));
      url = parseNextLink(response.link);
    }

    return values;
  }

  listActiveStudentCourses(): Promise<CanvasCourse[]> {
    const url = new URL("/api/v1/courses", CANVAS_BASE_URL);
    url.searchParams.set("enrollment_type", "student");
    url.searchParams.set("enrollment_state", "active");
    url.searchParams.append("state[]", "available");
    url.searchParams.set("per_page", "100");
    return this.getAllPages<CanvasCourse>(url.toString());
  }

  listAssignments(courseId: number): Promise<CanvasAssignment[]> {
    const url = new URL(`/api/v1/courses/${courseId}/assignments`, CANVAS_BASE_URL);
    url.searchParams.append("include[]", "submission");
    url.searchParams.append("include[]", "all_dates");
    url.searchParams.set("order_by", "due_at");
    url.searchParams.set("per_page", "100");
    return this.getAllPages<CanvasAssignment>(url.toString());
  }

  async getQuiz(courseId: number, quizId: number): Promise<CanvasQuiz> {
    const url = new URL(`/api/v1/courses/${courseId}/quizzes/${quizId}`, CANVAS_BASE_URL);
    const response = await this.browserGet(url.toString());
    let value: unknown;
    try {
      value = JSON.parse(response.body);
    } catch {
      throw new SafeHttpError("Canvas returned invalid quiz data", "UPSTREAM");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new SafeHttpError("Canvas returned invalid quiz data", "UPSTREAM");
    }
    return value as CanvasQuiz;
  }
}
