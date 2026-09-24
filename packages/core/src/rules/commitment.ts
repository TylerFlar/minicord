import type { Change, GuildMode, PendingChange, RulesConfig, RulesState } from "./types.ts";

export function modeOf(config: RulesConfig, guildId: string): GuildMode {
  return config.guildModes[guildId] ?? config.defaultMode;
}

export function isSorted(config: RulesConfig, guildId: string): boolean {
  return guildId in config.guildModes;
}

/**
 * Loosening changes are delayed by the cooldown; tightening applies instantly.
 * Sorting a server for the first time counts as an initial decision, not loosening.
 */
export function isLoosening(config: RulesConfig, change: Change): boolean {
  switch (change.kind) {
    case "guildMode":
      return isSorted(config, change.guildId) && modeOf(config, change.guildId) === "vault" && change.mode === "open";
    case "defaultMode":
      return config.defaultMode === "vault" && change.mode === "open";
    case "passMinutes":
      return change.value > config.passMinutes;
    case "passExtensionMinutes":
      return change.value > config.passExtensionMinutes;
    case "manualPassesPerDay":
      return change.value > config.manualPassesPerDay;
    case "passPauseSeconds":
      return change.value < config.passPauseSeconds;
    case "passPauseDoubles":
      return config.passPauseDoubles && !change.value;
    case "cooldownHours":
      return change.value < config.cooldownHours;
    case "settings":
      return false;
  }
}

export function applyChange(config: RulesConfig, change: Change): RulesConfig {
  switch (change.kind) {
    case "guildMode":
      return { ...config, guildModes: { ...config.guildModes, [change.guildId]: change.mode } };
    case "defaultMode":
      return { ...config, defaultMode: change.mode };
    case "passMinutes":
      return { ...config, passMinutes: change.value };
    case "passExtensionMinutes":
      return { ...config, passExtensionMinutes: change.value };
    case "manualPassesPerDay":
      return { ...config, manualPassesPerDay: change.value };
    case "passPauseSeconds":
      return { ...config, passPauseSeconds: change.value };
    case "passPauseDoubles":
      return { ...config, passPauseDoubles: change.value };
    case "cooldownHours":
      return { ...config, cooldownHours: change.value };
    case "settings":
      return { ...config, ...change.patch };
  }
}

function sameTarget(a: Change, b: Change): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "guildMode" && b.kind === "guildMode") return a.guildId === b.guildId;
  return a.kind !== "settings";
}

export type ChangeOutcome =
  | { state: RulesState; outcome: "applied" }
  | { state: RulesState; outcome: "pending"; pending: PendingChange };

export function requestChange(state: RulesState, change: Change, now: number, id: string): ChangeOutcome {
  // A new request replaces any pending request for the same setting.
  const pending = state.pending.filter((p) => !sameTarget(p.change, change));
  if (!state.onboarded || !isLoosening(state.config, change)) {
    return { state: { ...state, pending, config: applyChange(state.config, change) }, outcome: "applied" };
  }
  const entry: PendingChange = {
    id,
    change,
    requestedAt: now,
    effectiveAt: now + state.config.cooldownHours * 3_600_000,
  };
  return { state: { ...state, pending: [...pending, entry] }, outcome: "pending", pending: entry };
}

export function cancelPending(state: RulesState, id: string): RulesState {
  return { ...state, pending: state.pending.filter((p) => p.id !== id) };
}

/** Apply every pending change whose cooldown has elapsed. Returns the same object if nothing changed. */
export function applyDue(state: RulesState, now: number): RulesState {
  const due = state.pending.filter((p) => p.effectiveAt <= now).sort((a, b) => a.effectiveAt - b.effectiveAt);
  if (due.length === 0) return state;
  let config = state.config;
  for (const p of due) config = applyChange(config, p.change);
  return { ...state, config, pending: state.pending.filter((p) => p.effectiveAt > now) };
}

export function pendingFor(state: RulesState, guildId: string): PendingChange | undefined {
  return state.pending.find((p) => p.change.kind === "guildMode" && p.change.guildId === guildId);
}
