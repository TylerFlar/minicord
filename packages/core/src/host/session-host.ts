import type { GatewayClient, GatewayStatus } from "../gateway/client.ts";
import type { GatewayDispatch } from "../types.ts";
import { Emitter } from "../util/emitter.ts";
import { isNewer } from "../util/snowflake.ts";

export interface SessionSnapshot {
  status: GatewayStatus;
  ready: GatewayDispatch | null;
  supplemental: GatewayDispatch | null;
  /** Dispatches since READY, compacted; apply in order after hydrating from `ready`. */
  backlog: GatewayDispatch[];
}

export interface SessionHostEvents extends Record<string, unknown> {
  event: GatewayDispatch;
  status: GatewayStatus;
  fatal: { code: number; reason: string };
}

/** Events the UI never needs to replay (typing is ephemeral, member lists are re-requested, etc.). */
const NOT_REPLAYED = new Set([
  "TYPING_START",
  "SESSIONS_REPLACE",
  "GUILD_MEMBER_LIST_UPDATE",
  "VOICE_CHANNEL_STATUS_UPDATE",
  "CONVERSATION_SUMMARY_UPDATE",
  "RESUMED",
]);

/** High-volume events the UI never uses; not worth the IPC/bridge hop. */
const NOT_FORWARDED = new Set(["SESSIONS_REPLACE", "VOICE_CHANNEL_STATUS_UPDATE", "CONVERSATION_SUMMARY_UPDATE"]);

/**
 * Which live events a session host passes on to the UI. Guild presence updates are
 * constant noise in big servers (the member list carries its own presence updates);
 * friends' presences have no guild_id and are kept. The Android runtime mirrors this.
 */
export function forwardToUi(event: GatewayDispatch): boolean {
  if (NOT_FORWARDED.has(event.t)) return false;
  if (event.t === "PRESENCE_UPDATE") return !(event.d as { guild_id?: string } | null)?.guild_id;
  return true;
}

const GUILD_MESSAGE_NOISE = new Set([
  "MESSAGE_UPDATE",
  "MESSAGE_DELETE",
  "MESSAGE_DELETE_BULK",
  "MESSAGE_REACTION_ADD",
  "MESSAGE_REACTION_REMOVE",
  "MESSAGE_REACTION_REMOVE_ALL",
  "MESSAGE_REACTION_REMOVE_EMOJI",
]);

/**
 * Owns the gateway connection outside the UI (Electron main process; the Android
 * service mirrors this in Kotlin). UI clients attach with `snapshot()` — READY plus
 * a compacted backlog — and then follow live `event`s, so reloading or reopening the
 * UI never costs a fresh IDENTIFY.
 */
export class SessionHost extends Emitter<SessionHostEvents> {
  readonly gateway: GatewayClient;
  readonly #maxBacklog: number;
  #ready: GatewayDispatch | null = null;
  #supplemental: GatewayDispatch | null = null;
  #backlog: GatewayDispatch[] = [];
  #lastMessageIds = new Map<string, string>();
  /** Latest presence per friend: replayed as a set, not as history. */
  #friendPresences = new Map<string, GatewayDispatch>();
  #overflowed = false;
  #meId: string | null = null;

  constructor(gateway: GatewayClient, opts: { maxBacklog?: number } = {}) {
    super();
    this.gateway = gateway;
    this.#maxBacklog = opts.maxBacklog ?? 20_000;
    gateway.on("dispatch", (d) => this.#onDispatch(d));
    gateway.on("status", (s) => this.emit("status", s));
    gateway.on("fatal", (f) => this.emit("fatal", f));
  }

  start(): void {
    this.gateway.connect();
  }

  stop(): void {
    this.gateway.close();
  }

  get meId(): string | null {
    return this.#meId;
  }

  snapshot(): SessionSnapshot {
    if (this.#overflowed) {
      this.#overflowed = false;
      this.#ready = null;
      this.gateway.resync();
    }
    const backlog = [...this.#backlog];
    if (this.#lastMessageIds.size) {
      backlog.push({ t: "MINICORD_CHANNEL_LAST_MESSAGES", s: null, d: Object.fromEntries(this.#lastMessageIds) });
    }
    backlog.push(...this.#friendPresences.values());
    return { status: this.gateway.status, ready: this.#ready, supplemental: this.#supplemental, backlog };
  }

  #onDispatch(event: GatewayDispatch): void {
    if (event.t === "READY") {
      this.#ready = event;
      this.#supplemental = null;
      this.#backlog = [];
      this.#lastMessageIds.clear();
      this.#friendPresences.clear();
      this.#meId = (event.d as { user?: { id: string } }).user?.id ?? null;
    } else if (event.t === "READY_SUPPLEMENTAL") {
      this.#supplemental = event;
    } else {
      this.#record(event);
    }
    this.emit("event", event);
  }

  #record(event: GatewayDispatch): void {
    if (!this.#ready || NOT_REPLAYED.has(event.t)) return;
    const d = event.d as Record<string, any>;

    if (event.t === "PRESENCE_UPDATE") {
      const userId = d?.user?.id ?? d?.user_id;
      if (!d?.guild_id && userId) this.#friendPresences.set(userId, event);
      return;
    }

    if (d?.guild_id && event.t === "MESSAGE_CREATE" && !this.#concernsMe(d)) {
      const prev = this.#lastMessageIds.get(d.channel_id);
      if (!prev || isNewer(d.id, prev)) this.#lastMessageIds.set(d.channel_id, d.id);
      return;
    }
    if (d?.guild_id && GUILD_MESSAGE_NOISE.has(event.t)) return;

    this.#backlog.push(event);
    if (this.#backlog.length > this.#maxBacklog) {
      // Too much to replay cheaply; the next attach triggers a fresh READY instead.
      this.#overflowed = true;
      this.#backlog = [];
    }
  }

  #concernsMe(d: Record<string, any>): boolean {
    const me = this.#meId;
    return (
      d.author?.id === me ||
      d.mention_everyone === true ||
      (d.mention_roles?.length ?? 0) > 0 ||
      d.mentions?.some((u: { id: string }) => u.id === me) === true ||
      d.referenced_message?.author?.id === me
    );
  }
}
