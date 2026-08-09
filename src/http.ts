import type { FetchLike } from "./types.ts";

export type ErrorCategory =
  | "AUTH"
  | "RATE_LIMIT"
  | "UPSTREAM"
  | "NETWORK"
  | "CONFIG"
  | "UNKNOWN";

export class SafeHttpError extends Error {
  readonly category: ErrorCategory;
  readonly status?: number;

  constructor(message: string, category: ErrorCategory, status?: number) {
    super(message);
    this.name = "SafeHttpError";
    this.category = category;
    this.status = status;
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function categoryForStatus(status: number): ErrorCategory {
  if (status === 401 || status === 403) return "AUTH";
  if (status === 429) return "RATE_LIMIT";
  if (status >= 500) return "UPSTREAM";
  return "UNKNOWN";
}

export async function fetchWithRetry(
  fetcher: FetchLike,
  input: string,
  init: RequestInit,
  options: { attempts?: number; timeoutMs?: number; baseDelayMs?: number } = {}
): Promise<Response> {
  const attempts = options.attempts ?? 3;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const baseDelayMs = options.baseDelayMs ?? 150;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetcher(input, { ...init, signal: controller.signal });
      if (response.ok) return response;

      const retryable = RETRYABLE_STATUS.has(response.status);
      if (!retryable || attempt === attempts) {
        throw new SafeHttpError(
          `Remote request failed with status ${response.status}`,
          categoryForStatus(response.status),
          response.status
        );
      }
    } catch (error) {
      if (error instanceof SafeHttpError) throw error;
      if (attempt === attempts) {
        throw new SafeHttpError("Remote request failed", "NETWORK");
      }
    } finally {
      clearTimeout(timeout);
    }

    await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)));
  }

  throw new SafeHttpError("Remote request failed", "UNKNOWN");
}

export function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;

  for (const part of linkHeader.split(",")) {
    const urlMatch = part.match(/<([^>]+)>/);
    const relMatch = part.match(/;\s*rel="([^"]+)"/);
    if (urlMatch && relMatch?.[1].split(/\s+/).includes("next")) return urlMatch[1];
  }

  return null;
}

export function errorCategory(error: unknown): ErrorCategory {
  if (error instanceof SafeHttpError) return error.category;
  if (error instanceof Error && error.message.startsWith("Missing configuration:")) {
    return "CONFIG";
  }
  return "UNKNOWN";
}
