import { isEventChannel, modeOf } from "./commitment.ts";
import { startOfLocalDay } from "./time.ts";
import type { Pass, PassKind, PassWait, RulesState } from "./types.ts";

const HISTORY_LIMIT = 500;
/** After its pause, a manual pass waits this long to be claimed before it lapses. */
export const PASS_CLAIM_WINDOW_MS = 10 * 60_000;
const MAX_PAUSE_MS = 30 * 60_000;

export interface PassRequest {
  guildId: string;
  channelId: string;
  kind: PassKind;
  reason?: string;
  anchorMessageId?: string;
}

export type OpenPassResult =
  | { ok: true; state: RulesState; pass: Pass }
  | { ok: false; reason: "not-vaulted" | "pause-required" | "budget-exhausted" };

export type RequestPassResult = { ok: true; state: RulesState; request: PassWait } | { ok: false; reason: "not-vaulted" | "budget-exhausted" };

export type ClaimPassResult =
  | { ok: true; state: RulesState; pass: Pass }
  | { ok: false; reason: "no-request" | "too-early" | "expired" | "not-vaulted" | "budget-exhausted" };

export function isActive(pass: Pass, now: number): boolean {
  return pass.endedAt === undefined && pass.endsAt > now;
}

export function activePass(state: RulesState, channelId: string, now: number): Pass | undefined {
  return state.passes.find((p) => p.channelId === channelId && isActive(p, now));
}

export function activePasses(state: RulesState, now: number): Pass[] {
  return state.passes.filter((p) => isActive(p, now));
}

export function manualPassesUsedToday(state: RulesState, now: number): number {
  const dayStart = startOfLocalDay(now);
  return state.passes.filter((p) => p.kind === "manual" && p.startedAt >= dayStart).length;
}

export function manualPassesLeft(state: RulesState, now: number): number {
  return Math.max(0, state.config.manualPassesPerDay - manualPassesUsedToday(state, now));
}

/**
 * Open a pass into a vaulted server's channel. Mention and event passes are free and instant;
 * manual passes go through requestPass → claimPass (a pause, then a second ask).
 * Re-opening a channel that already has an active pass returns that pass.
 */
export function openPass(state: RulesState, req: PassRequest, now: number, id: string): OpenPassResult {
  if (req.kind === "manual") return { ok: false, reason: "pause-required" };
  return createPass(state, req, now, id);
}

/** How long the next manual pass makes you wait: the base pause, doubled for each manual pass already opened today. */
export function passPause(state: RulesState, now: number): number {
  const factor = state.config.passPauseDoubles ? 2 ** manualPassesUsedToday(state, now) : 1;
  return Math.min(MAX_PAUSE_MS, state.config.passPauseSeconds * 1000 * factor);
}

/** Start the pause before a manual pass. Asking again replaces the previous request. */
export function requestPass(state: RulesState, req: { guildId: string; channelId: string }, now: number, id: string): RequestPassResult {
  if (modeOf(state.config, req.guildId) !== "vault") return { ok: false, reason: "not-vaulted" };
  if (manualPassesLeft(state, now) <= 0) return { ok: false, reason: "budget-exhausted" };
  const request: PassWait = { id, guildId: req.guildId, channelId: req.channelId, requestedAt: now, readyAt: now + passPause(state, now) };
  return { ok: true, state: { ...state, passRequest: request }, request };
}

export function cancelPassRequest(state: RulesState): RulesState {
  if (!state.passRequest) return state;
  const { passRequest: _dropped, ...rest } = state;
  return rest;
}

/** After the pause, open the manual pass. It counts against the daily budget only once claimed. */
export function claimPass(state: RulesState, now: number, id: string): ClaimPassResult {
  const req = state.passRequest;
  if (!req) return { ok: false, reason: "no-request" };
  if (now < req.readyAt) return { ok: false, reason: "too-early" };
  if (now > req.readyAt + PASS_CLAIM_WINDOW_MS) return { ok: false, reason: "expired" };
  return createPass(cancelPassRequest(state), { guildId: req.guildId, channelId: req.channelId, kind: "manual" }, now, id);
}

/** Drop a paused request nobody claimed in time. Returns the same object if nothing lapsed. */
export function expirePassRequest(state: RulesState, now: number): RulesState {
  const req = state.passRequest;
  return req && now > req.readyAt + PASS_CLAIM_WINDOW_MS ? cancelPassRequest(state) : state;
}

function createPass(
  state: RulesState,
  req: PassRequest,
  now: number,
  id: string,
): { ok: true; state: RulesState; pass: Pass } | { ok: false; reason: "not-vaulted" | "budget-exhausted" } {
  if (modeOf(state.config, req.guildId) !== "vault") return { ok: false, reason: "not-vaulted" };
  const existing = activePass(state, req.channelId, now);
  if (existing) return { ok: true, state, pass: existing };
  if (req.kind === "manual" && manualPassesLeft(state, now) <= 0) return { ok: false, reason: "budget-exhausted" };
  const pass: Pass = {
    id,
    guildId: req.guildId,
    channelId: req.channelId,
    kind: req.kind,
    ...(req.reason?.trim() ? { reason: req.reason.trim() } : {}),
    ...(req.anchorMessageId ? { anchorMessageId: req.anchorMessageId } : {}),
    startedAt: now,
    endsAt: now + state.config.passMinutes * 60_000,
    extended: false,
    messagesSent: 0,
  };
  return { ok: true, state: { ...state, passes: [...state.passes, pass].slice(-HISTORY_LIMIT) }, pass };
}

function updatePass(state: RulesState, id: string, fn: (p: Pass) => Pass): RulesState {
  return { ...state, passes: state.passes.map((p) => (p.id === id ? fn(p) : p)) };
}

/** One extension per pass. */
export function extendPass(state: RulesState, id: string, now: number): RulesState {
  return updatePass(state, id, (p) =>
    isActive(p, now) && !p.extended
      ? { ...p, extended: true, endsAt: p.endsAt + state.config.passExtensionMinutes * 60_000 }
      : p,
  );
}

export function endPass(state: RulesState, id: string, now: number): RulesState {
  return updatePass(state, id, (p) => (p.endedAt === undefined ? { ...p, endedAt: Math.min(now, p.endsAt) } : p));
}

export function recordPassMessage(state: RulesState, id: string): RulesState {
  return updatePass(state, id, (p) => ({ ...p, messagesSent: p.messagesSent + 1 }));
}

/** Stamp `endedAt` on passes whose time ran out. Returns the same object if nothing expired. */
export function expirePasses(state: RulesState, now: number): RulesState {
  if (!state.passes.some((p) => p.endedAt === undefined && p.endsAt <= now)) return state;
  return {
    ...state,
    passes: state.passes.map((p) => (p.endedAt === undefined && p.endsAt <= now ? { ...p, endedAt: p.endsAt } : p)),
  };
}

/** Can the user see this channel right now? Threads are covered by a pass (or event channel) on their parent. */
export function canViewChannel(
  state: RulesState,
  guildId: string,
  channelId: string,
  now: number,
  parentId?: string | null,
): boolean {
  if (modeOf(state.config, guildId) === "open") return true;
  if (isEventChannel(state.config, channelId, parentId)) return true;
  return !!activePass(state, channelId, now) || (!!parentId && !!activePass(state, parentId, now));
}
