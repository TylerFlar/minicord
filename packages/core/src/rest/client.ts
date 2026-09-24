import type { HttpFn } from "./http.ts";

export interface CaptchaChallenge {
  captcha_key?: string[];
  captcha_sitekey: string;
  captcha_service: string;
  captcha_rqdata?: string;
  captcha_rqtoken?: string;
  captcha_session_id?: string;
}

export class DiscordApiError extends Error {
  readonly status: number;
  readonly code: number | undefined;
  readonly body: unknown;
  readonly captcha: CaptchaChallenge | undefined;

  constructor(status: number, body: unknown, method: string, path: string) {
    const b = (body ?? {}) as { message?: string; code?: number; captcha_sitekey?: string };
    super(`${method} ${path} → ${status}${b.message ? `: ${b.message}` : ""}`);
    this.name = "DiscordApiError";
    this.status = status;
    this.code = b.code;
    this.body = body;
    this.captcha = b.captcha_sitekey ? (body as CaptchaChallenge) : undefined;
  }
}

export type Query = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  query?: Query;
  json?: unknown;
  /** Text fields sent as multipart/form-data (Discord's payload_json style). */
  form?: Record<string, string>;
  headers?: Record<string, string>;
  /** Solved captcha, when retrying a request that returned a challenge. */
  captcha?: { key: string; rqtoken?: string; sessionId?: string };
}

export interface RestClientOptions {
  token: string;
  http: HttpFn;
  /** Headers that make requests look like the web client (UA, X-Super-Properties, locale, ...). */
  baseHeaders: () => Record<string, string>;
  apiBase?: string;
  logger?: (message: string) => void;
}

const MAX_RETRIES = 3;
const MIN_SPACING_MS = 60;

/**
 * Small REST client for user-account requests. Requests are serialized with a
 * little spacing (a human-paced client never bursts), and 429s are retried after
 * the server-provided delay.
 */
export class RestClient {
  readonly #opts: RestClientOptions;
  #queue: Promise<unknown> = Promise.resolve();
  #lastRequestAt = 0;
  #globalResumeAt = 0;

  constructor(opts: RestClientOptions) {
    this.#opts = opts;
  }

  get<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>("GET", path, query ? { query } : {});
  }

  post<T>(path: string, json?: unknown, opts: RequestOptions = {}): Promise<T> {
    return this.request<T>("POST", path, { ...opts, json });
  }

  patch<T>(path: string, json?: unknown): Promise<T> {
    return this.request<T>("PATCH", path, { json });
  }

  put<T>(path: string, json?: unknown, query?: Query): Promise<T> {
    return this.request<T>("PUT", path, query ? { json, query } : { json });
  }

  delete<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>("DELETE", path, query ? { query } : {});
  }

  request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const run = this.#queue.then(() => this.#execute<T>(method, path, opts));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #execute<T>(method: string, path: string, opts: RequestOptions): Promise<T> {
    const base = this.#opts.apiBase ?? "https://discord.com/api/v9";
    let url = `${base}${path}`;
    if (opts.query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(opts.query)) {
        if (value !== undefined && value !== null) params.set(key, String(value));
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }

    const headers: Record<string, string> = {
      ...this.#opts.baseHeaders(),
      Authorization: this.#opts.token,
      ...opts.headers,
    };
    let body: string | undefined;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    } else if (opts.form) {
      const boundary = formBoundary();
      headers["Content-Type"] = `multipart/form-data; boundary=${boundary}`;
      body = multipartBody(opts.form, boundary);
    }
    if (opts.captcha) {
      headers["X-Captcha-Key"] = opts.captcha.key;
      if (opts.captcha.rqtoken) headers["X-Captcha-Rqtoken"] = opts.captcha.rqtoken;
      if (opts.captcha.sessionId) headers["X-Captcha-Session-Id"] = opts.captcha.sessionId;
    }

    for (let attempt = 0; ; attempt++) {
      const wait = Math.max(this.#globalResumeAt, this.#lastRequestAt + MIN_SPACING_MS) - Date.now();
      if (wait > 0) await sleep(wait);
      this.#lastRequestAt = Date.now();

      const res = await this.#opts.http({ method, url, headers, ...(body !== undefined ? { body } : {}) });
      const parsed = parseBody(res.text);

      if (res.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = Number((parsed as { retry_after?: number })?.retry_after ?? res.headers["retry-after"] ?? 1);
        const delay = Math.ceil(retryAfter * 1000) + 100;
        if ((parsed as { global?: boolean })?.global) this.#globalResumeAt = Date.now() + delay;
        this.#opts.logger?.(`[rest] 429 on ${method} ${path}; retrying in ${delay}ms`);
        await sleep(delay);
        continue;
      }
      if (res.status >= 500 && res.status < 600 && attempt < MAX_RETRIES && method === "GET") {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      if (res.status >= 400) throw new DiscordApiError(res.status, parsed, method, path);
      return parsed as T;
    }
  }
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Chrome-style boundary, so multipart requests look like the browser's. */
export function formBoundary(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "----WebKitFormBoundary";
  for (let i = 0; i < 16; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function multipartBody(fields: Record<string, string>, boundary: string): string {
  let body = "";
  for (const [name, value] of Object.entries(fields)) body += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  return `${body}--${boundary}--\r\n`;
}
