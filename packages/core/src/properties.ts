import type { HttpFn } from "./rest/http.ts";

/**
 * Client identity for IDENTIFY `properties` and the X-Super-Properties header.
 * minicord presents itself exactly like the Discord web client in Chrome; the
 * user agent here must match the real User-Agent sent on the wire.
 */
export interface ClientIdentity {
  os: "Windows" | "Mac OS X" | "Linux" | "Android";
  osVersion: string;
  browser: string;
  browserVersion: string;
  userAgent: string;
  locale: string;
  timezone: string;
  buildNumber: number;
}

/** Verified live on 2026-09-23; used only if scraping the current build fails. */
export const FALLBACK_BUILD_NUMBER = 619060;
export const FALLBACK_CHROME_MAJOR = 146;

/**
 * Live web capabilities are 1734653. minicord clears AUTH_TOKEN_REFRESH (1<<8), so the
 * server never rotates the token under us, and DEBOUNCE_MESSAGE_REACTIONS (1<<13), whose
 * batched reaction events aren't documented.
 */
export const CAPABILITIES = 1734653 & ~(1 << 8) & ~(1 << 13);

/** Bits of the launch signature that flag detected client mods; they must be zero. */
const CLIENT_MOD_BITS = [119, 108, 100, 91, 84, 75, 61, 55, 48, 38, 24, 11];

export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

function formatUUID(bytes: Uint8Array): string {
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A UUIDv4 with every client-mod detection bit cleared ("clean" client). */
export function launchSignature(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  for (const bit of CLIENT_MOD_BITS) {
    const index = 15 - Math.floor(bit / 8);
    bytes[index] = bytes[index]! & ~(1 << bit % 8);
  }
  return formatUUID(bytes);
}

export function chromeUserAgent(chromeMajor: number, os: ClientIdentity["os"] = "Windows"): string {
  const platform =
    os === "Windows"
      ? "Windows NT 10.0; Win64; x64"
      : os === "Mac OS X"
        ? "Macintosh; Intel Mac OS X 10_15_7"
        : os === "Android"
          ? "Linux; Android 10; K"
          : "X11; Linux x86_64";
  const mobile = os === "Android" ? " Mobile" : "";
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0${mobile} Safari/537.36`;
}

export function webIdentity(opts: {
  chromeMajor: number;
  buildNumber: number;
  locale?: string;
  timezone?: string;
}): ClientIdentity {
  return {
    os: "Windows",
    osVersion: "10",
    browser: "Chrome",
    browserVersion: `${opts.chromeMajor}.0.0.0`,
    userAgent: chromeUserAgent(opts.chromeMajor, "Windows"),
    locale: opts.locale ?? "en-US",
    timezone: opts.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    buildNumber: opts.buildNumber,
  };
}

function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export class ClientProperties {
  readonly identity: ClientIdentity;
  readonly launchId = randomUUID();
  readonly launchSignature = launchSignature();
  readonly launchedAt = Date.now();
  appState: "focused" | "unfocused" = "focused";
  #heartbeatSessionId = randomUUID();
  #heartbeatSessionStarted = Date.now();

  constructor(identity: ClientIdentity) {
    this.identity = identity;
  }

  /** Analytics heartbeat session id; the web client regenerates it every 30 minutes. */
  heartbeatSessionId(): string {
    if (Date.now() - this.#heartbeatSessionStarted > 30 * 60_000) {
      this.#heartbeatSessionId = randomUUID();
      this.#heartbeatSessionStarted = Date.now();
    }
    return this.#heartbeatSessionId;
  }

  /** Same key order as the web client's getSuperProperties(). */
  superProperties(): Record<string, unknown> {
    const id = this.identity;
    return {
      os: id.os,
      browser: id.browser,
      device: "",
      system_locale: id.locale,
      has_client_mods: false,
      browser_user_agent: id.userAgent,
      browser_version: id.browserVersion,
      os_version: id.osVersion,
      referrer: "",
      referring_domain: "",
      referrer_current: "",
      referring_domain_current: "",
      release_channel: "stable",
      client_build_number: id.buildNumber,
      client_event_source: null,
      client_launch_id: this.launchId,
      launch_signature: this.launchSignature,
      client_heartbeat_session_id: this.heartbeatSessionId(),
      client_app_state: this.appState,
    };
  }

  /** IDENTIFY properties = super properties + gateway-only extras. */
  gatewayProperties(): Record<string, unknown> {
    return { ...this.superProperties(), is_fast_connect: false, gateway_connect_reasons: "AppSkeleton" };
  }

  /** Headers the web client sends on every authenticated REST request. */
  headers(): Record<string, string> {
    return {
      "User-Agent": this.identity.userAgent,
      "X-Super-Properties": base64Utf8(JSON.stringify(this.superProperties())),
      "X-Discord-Locale": this.identity.locale,
      "X-Discord-Timezone": this.identity.timezone,
      "X-Debug-Options": "bugReporterEnabled",
      "Accept-Language": `${this.identity.locale},${this.identity.locale.split("-")[0]};q=0.9`,
      Origin: "https://discord.com",
      Referer: "https://discord.com/channels/@me",
    };
  }
}

export function contextProperties(value: Record<string, unknown>): string {
  return base64Utf8(JSON.stringify(value));
}

/** Scrape the current web client build number from discord.com (GLOBAL_ENV.BUILD_NUMBER). */
export async function fetchBuildNumber(http: HttpFn, userAgent: string): Promise<number | null> {
  try {
    const res = await http({ method: "GET", url: "https://discord.com/login", headers: { "User-Agent": userAgent } });
    const match = /"BUILD_NUMBER"\s*:\s*"(\d+)"/.exec(res.text) ?? /BUILD_NUMBER\W{1,4}(\d{5,7})/.exec(res.text);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/** Latest stable Chrome major for Windows, so the user agent looks current. */
export async function fetchChromeMajor(http: HttpFn): Promise<number | null> {
  try {
    const res = await http({
      method: "GET",
      url: "https://versionhistory.googleapis.com/v1/chrome/platforms/win/channels/stable/versions",
      headers: {},
    });
    const version = (JSON.parse(res.text) as { versions?: { version: string }[] }).versions?.[0]?.version;
    return version ? Number(version.split(".")[0]) : null;
  } catch {
    return null;
  }
}
