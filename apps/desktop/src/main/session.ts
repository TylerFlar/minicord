import {
  createSession,
  DiscordApiError,
  FALLBACK_BUILD_NUMBER,
  fetchBuildNumber,
  forwardToUi,
  Ipc,
  webIdentity,
  type BridgeResult,
  type HttpFn,
  type RequestOptions,
  type Session,
  type SessionSnapshot,
} from "@minicord/core";
import { gatewayHeaders, nodeSocketFactory } from "@minicord/core/node";
import { app, type WebContents } from "electron";
import { chromeMajor, userAgent } from "./discord-web.ts";
import { loadState, saveState } from "./storage.ts";

const BUILD_CACHE_MS = 12 * 60 * 60 * 1000;

function writeAllowed(path: string): boolean {
  const allowed = (process.env.MINICORD_WRITE_CHANNELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const channelId = /^\/channels\/(\d+)\//.exec(path)?.[1];
  return !!channelId && allowed.includes(channelId);
}

/**
 * The single Discord session for the desktop app. Lives in the main process so the
 * token never reaches the renderer and UI reloads never cost a re-IDENTIFY; renderers
 * attach and get READY + a replay backlog, then live events.
 */
export class DesktopSession {
  #session: Session | null = null;
  #listeners = new Set<WebContents>();
  #onAuthFailed: () => void;

  constructor(onAuthFailed: () => void) {
    this.#onAuthFailed = onAuthFailed;
  }

  get active(): boolean {
    return this.#session !== null;
  }

  async start(token: string, http: HttpFn): Promise<void> {
    this.stop();
    const ua = userAgent();
    const cached = loadState<{ value: number; at: number }>("build-number");
    let buildNumber = cached && Date.now() - cached.at < BUILD_CACHE_MS ? cached.value : null;
    if (!buildNumber) {
      buildNumber = await fetchBuildNumber(http, ua);
      if (buildNumber) saveState("build-number", { value: buildNumber, at: Date.now() });
    }
    const identity = webIdentity({
      chromeMajor: chromeMajor(),
      buildNumber: buildNumber ?? FALLBACK_BUILD_NUMBER,
      locale: app.getLocale() || "en-US",
    });
    if (identity.userAgent !== ua) console.warn("[session] user agent mismatch between identity and partition");

    const session = createSession({
      token,
      identity,
      socketFactory: nodeSocketFactory(() => gatewayHeaders(identity.userAgent, identity.locale)),
      http,
      logger: (m) => console.log(m),
    });
    session.host.on("event", (e) => {
      if (forwardToUi(e)) this.#broadcast(Ipc.sessionEvent, e);
    });
    session.host.on("status", (s) => this.#broadcast(Ipc.sessionStatus, s));
    session.host.on("fatal", (f) => {
      this.#broadcast(Ipc.sessionFatal, f);
      if (f.code === 4004) {
        this.stop();
        this.#onAuthFailed();
      }
    });
    session.host.start();
    this.#session = session;
    console.log(`[session] started (Chrome ${identity.browserVersion}, build ${identity.buildNumber})`);
  }

  stop(): void {
    this.#session?.gateway.close();
    this.#session = null;
  }

  attach(wc: WebContents): SessionSnapshot | null {
    if (!this.#session) return null;
    if (!this.#listeners.has(wc)) {
      this.#listeners.add(wc);
      wc.once("destroyed", () => this.#listeners.delete(wc));
    }
    return this.#session.host.snapshot();
  }

  send(op: number, d: unknown): void {
    this.#session?.gateway.send(op, d);
  }

  async request(method: string, path: string, opts: RequestOptions): Promise<BridgeResult<unknown>> {
    if (!this.#session) return { ok: false, error: { message: "Not signed in" } };
    // Safety switch for automated runs against a real account: no writes, except in explicitly
    // allowed test channels (MINICORD_WRITE_CHANNELS, comma-separated).
    if (process.env.MINICORD_READONLY === "1" && method !== "GET" && !writeAllowed(path)) {
      console.log(`[readonly] blocked ${method} ${path}`);
      return { ok: false, error: { message: `Read-only mode: blocked ${method} ${path}` } };
    }
    try {
      return { ok: true, value: await this.#session.rest.request(method, path, opts) };
    } catch (err) {
      if (err instanceof DiscordApiError) {
        return { ok: false, error: { message: err.message, status: err.status, body: err.body, method, path } };
      }
      return { ok: false, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  }

  setFocused(focused: boolean): void {
    if (this.#session) this.#session.properties.appState = focused ? "focused" : "unfocused";
  }

  #broadcast(channel: string, payload: unknown): void {
    for (const wc of this.#listeners) if (!wc.isDestroyed()) wc.send(channel, payload);
  }
}
