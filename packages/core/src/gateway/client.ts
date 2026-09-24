import type { GatewayDispatch } from "../types.ts";
import { Emitter } from "../util/emitter.ts";
import { ZlibStreamInflater } from "./inflate.ts";
import type { SocketFactory, SocketLike } from "./socket.ts";

export const GatewayOp = {
  Dispatch: 0,
  Heartbeat: 1,
  Identify: 2,
  PresenceUpdate: 3,
  VoiceStateUpdate: 4,
  Resume: 6,
  Reconnect: 7,
  RequestGuildMembers: 8,
  InvalidSession: 9,
  Hello: 10,
  HeartbeatAck: 11,
  CallConnect: 13,
  GuildSubscriptionsBulk: 37,
  QosHeartbeat: 40,
  UpdateTimeSpent: 41,
} as const;

/** Close codes after which reconnecting would be pointless (bad token, bad config). */
const FATAL_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
/** Close codes that invalidate the session, so we must identify again instead of resuming. */
const REIDENTIFY_CLOSE_CODES = new Set([4007, 4009]);

export type GatewayStatus = "idle" | "connecting" | "identifying" | "resuming" | "ready" | "reconnecting" | "closed";

export interface IdentifyPayload {
  token: string;
  capabilities: number;
  properties: Record<string, unknown>;
  presence?: { status: string; since: number; activities: unknown[]; afk: boolean };
  compress?: boolean;
  client_state?: Record<string, unknown>;
}

export interface GatewayOptions {
  /** Called on each (re)identify so properties such as launch ids stay fresh. */
  identify: () => IdentifyPayload;
  socketFactory: SocketFactory;
  url?: string;
  version?: number;
  compress?: boolean;
  /** Heartbeat payload builder; defaults to op 1. The web client sends op 40 (QoS). */
  heartbeat?: (seq: number | null) => { op: number; d: unknown };
  /** If set, sent as op 41 right after READY and every 30 minutes, like the web client. */
  timeSpent?: () => unknown;
  logger?: (message: string) => void;
}

export interface GatewayEvents extends Record<string, unknown> {
  dispatch: GatewayDispatch;
  status: GatewayStatus;
  fatal: { code: number; reason: string };
}

interface GatewayPayload {
  op: number;
  d: unknown;
  s?: number | null;
  t?: string | null;
}

export class GatewayClient extends Emitter<GatewayEvents> {
  readonly #opts: GatewayOptions;
  #socket: SocketLike | null = null;
  #inflater: ZlibStreamInflater | null = null;
  #status: GatewayStatus = "idle";
  #seq: number | null = null;
  #sessionId: string | null = null;
  #resumeUrl: string | null = null;
  #heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  #heartbeatInterval = 41_250;
  #awaitingAck = false;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #timeSpentTimer: ReturnType<typeof setInterval> | null = null;
  #attempts = 0;
  #stopped = false;
  /** Incremented per socket so late events from an old socket are ignored. */
  #generation = 0;

  constructor(opts: GatewayOptions) {
    super();
    this.#opts = opts;
  }

  get status(): GatewayStatus {
    return this.#status;
  }

  get sessionId(): string | null {
    return this.#sessionId;
  }

  get sequence(): number | null {
    return this.#seq;
  }

  connect(): void {
    this.#stopped = false;
    this.#open(false);
  }

  /**
   * Close for good. With the default 4000 the session stays resumable server-side for a
   * few minutes; 1000 ends it immediately (the account goes offline for this session).
   */
  close(code = 4000): void {
    this.#stopped = true;
    this.#clearTimers();
    this.#socket?.close(code, "client shutdown");
    this.#socket = null;
    this.#setStatus("closed");
  }

  /** Drop the session and start over with a fresh IDENTIFY (and so a fresh READY). */
  resync(): void {
    this.#sessionId = null;
    this.#seq = null;
    this.#resumeUrl = null;
    this.#restart(false, 0);
  }

  send(op: number, d: unknown): void {
    this.#socket?.send(JSON.stringify({ op, d }));
  }

  #log(message: string): void {
    this.#opts.logger?.(`[gateway] ${message}`);
  }

  #setStatus(status: GatewayStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.emit("status", status);
  }

  #open(resume: boolean): void {
    this.#clearTimers();
    const generation = ++this.#generation;
    const version = this.#opts.version ?? 9;
    const base = (resume && this.#resumeUrl) || this.#opts.url || "wss://gateway.discord.gg";
    const compress = this.#opts.compress ?? true;
    const url = `${base.replace(/\/$/, "")}/?encoding=json&v=${version}${compress ? "&compress=zlib-stream" : ""}`;
    this.#inflater = compress ? new ZlibStreamInflater() : null;
    this.#awaitingAck = false;
    this.#setStatus(this.#attempts > 0 ? "reconnecting" : "connecting");
    this.#log(`connecting (${resume ? "resume" : "identify"})`);

    this.#socket = this.#opts.socketFactory(url, {
      onOpen: () => {},
      onMessage: (data) => {
        if (generation === this.#generation) this.#onFrame(data, resume);
      },
      onClose: (code, reason) => {
        if (generation === this.#generation) this.#onClose(code, reason);
      },
      onError: (error) => {
        if (generation === this.#generation) this.#log(`socket error: ${String(error)}`);
      },
    });
  }

  #onFrame(data: string | Uint8Array, resume: boolean): void {
    let text: string | null;
    if (typeof data === "string") text = data;
    else if (this.#inflater) text = this.#inflater.push(data);
    else text = new TextDecoder().decode(data);
    if (text === null) return;

    let payload: GatewayPayload;
    try {
      payload = JSON.parse(text) as GatewayPayload;
    } catch {
      this.#log("failed to parse payload");
      return;
    }
    if (typeof payload.s === "number") this.#seq = payload.s;

    switch (payload.op) {
      case GatewayOp.Hello: {
        const interval = (payload.d as { heartbeat_interval: number }).heartbeat_interval;
        this.#heartbeatInterval = interval;
        // First beat is jittered, per Discord's guidance.
        this.#scheduleHeartbeat(interval * Math.random());
        if (resume && this.#sessionId) this.#sendResume();
        else this.#sendIdentify();
        break;
      }
      case GatewayOp.Heartbeat:
        this.#beat();
        break;
      case GatewayOp.HeartbeatAck:
        this.#awaitingAck = false;
        break;
      case GatewayOp.Reconnect:
        this.#log("server requested reconnect");
        this.#restart(true, 0);
        break;
      case GatewayOp.InvalidSession: {
        const resumable = payload.d === true;
        this.#log(`invalid session (resumable: ${resumable})`);
        if (!resumable) {
          this.#sessionId = null;
          this.#seq = null;
        }
        this.#restart(resumable, 1000 + Math.random() * 4000);
        break;
      }
      case GatewayOp.Dispatch:
        this.#onDispatch(payload);
        break;
    }
  }

  #onDispatch(payload: GatewayPayload): void {
    const t = payload.t ?? "";
    if (t === "READY") {
      const d = payload.d as { session_id: string; resume_gateway_url?: string };
      this.#sessionId = d.session_id;
      this.#resumeUrl = d.resume_gateway_url ?? null;
      this.#attempts = 0;
      this.#setStatus("ready");
      this.#startTimeSpent();
      this.#beat();
    } else if (t === "RESUMED") {
      this.#attempts = 0;
      this.#setStatus("ready");
    }
    this.emit("dispatch", { t, s: payload.s ?? null, d: payload.d });
  }

  #sendIdentify(): void {
    this.#setStatus("identifying");
    this.send(GatewayOp.Identify, this.#opts.identify());
  }

  #sendResume(): void {
    this.#setStatus("resuming");
    const { token } = this.#opts.identify();
    this.send(GatewayOp.Resume, { token, session_id: this.#sessionId, seq: this.#seq });
  }

  #scheduleHeartbeat(delay: number): void {
    if (this.#heartbeatTimer) clearTimeout(this.#heartbeatTimer);
    this.#heartbeatTimer = setTimeout(() => {
      if (this.#awaitingAck) {
        this.#log("heartbeat not acknowledged; reconnecting");
        this.#restart(true, 0);
        return;
      }
      this.#beat();
      this.#scheduleHeartbeat(this.#heartbeatInterval);
    }, delay);
  }

  #beat(): void {
    this.#awaitingAck = true;
    const hb = this.#opts.heartbeat?.(this.#seq) ?? { op: GatewayOp.Heartbeat, d: this.#seq };
    this.send(hb.op, hb.d);
  }

  #startTimeSpent(): void {
    const build = this.#opts.timeSpent;
    if (!build) return;
    if (this.#timeSpentTimer) clearInterval(this.#timeSpentTimer);
    this.send(GatewayOp.UpdateTimeSpent, build());
    this.#timeSpentTimer = setInterval(() => this.send(GatewayOp.UpdateTimeSpent, build()), 30 * 60_000);
  }

  #onClose(code: number, reason: string): void {
    this.#clearTimers();
    this.#socket = null;
    this.#log(`closed ${code} ${reason}`);
    if (this.#stopped) {
      this.#setStatus("closed");
      return;
    }
    if (FATAL_CLOSE_CODES.has(code)) {
      this.#stopped = true;
      this.#setStatus("closed");
      this.emit("fatal", { code, reason });
      return;
    }
    if (REIDENTIFY_CLOSE_CODES.has(code)) {
      this.#sessionId = null;
      this.#seq = null;
    }
    this.#attempts += 1;
    const backoff = Math.min(60_000, 1000 * 2 ** Math.min(this.#attempts - 1, 6)) * (0.8 + Math.random() * 0.4);
    this.#setStatus("reconnecting");
    this.#reconnectTimer = setTimeout(() => this.#open(this.#sessionId !== null), backoff);
  }

  /** Tear down the current socket and reconnect after `delay`, resuming if possible. */
  #restart(resume: boolean, delay: number): void {
    this.#clearTimers();
    const old = this.#socket;
    this.#socket = null;
    this.#generation++; // ignore the old socket's close event
    old?.close(4000, "reconnecting");
    if (this.#stopped) return;
    this.#setStatus("reconnecting");
    this.#reconnectTimer = setTimeout(() => this.#open(resume && this.#sessionId !== null), delay);
  }

  #clearTimers(): void {
    if (this.#heartbeatTimer) clearTimeout(this.#heartbeatTimer);
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    if (this.#timeSpentTimer) clearInterval(this.#timeSpentTimer);
    this.#heartbeatTimer = null;
    this.#reconnectTimer = null;
    this.#timeSpentTimer = null;
  }
}
