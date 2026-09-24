import { describe, expect, it } from "vitest";
import * as rules from "../src/rules/index.ts";
import type { Mention } from "../src/mentions.ts";

const HOUR = 3_600_000;
const T0 = new Date(2026, 8, 23, 14, 0).getTime(); // local 14:00, outside default quiet hours

function onboarded(patch: Partial<rules.RulesConfig> = {}): rules.RulesState {
  const s = rules.initialRulesState();
  return { ...s, onboarded: true, config: { ...s.config, ...patch } };
}

describe("commitment device", () => {
  it("applies everything immediately before onboarding finishes", () => {
    const s = rules.initialRulesState();
    const r = rules.requestChange(s, { kind: "guildMode", guildId: "g1", mode: "open" }, T0, "c1");
    expect(r.outcome).toBe("applied");
    expect(rules.modeOf(r.state.config, "g1")).toBe("open");
  });

  it("treats sorting a new server as an initial decision", () => {
    const r = rules.requestChange(onboarded(), { kind: "guildMode", guildId: "new", mode: "open" }, T0, "c1");
    expect(r.outcome).toBe("applied");
  });

  it("delays vault → open by the cooldown, applies tightening instantly", () => {
    let s = onboarded({ guildModes: { g1: "vault", g2: "open" } });
    const loosen = rules.requestChange(s, { kind: "guildMode", guildId: "g1", mode: "open" }, T0, "c1");
    expect(loosen.outcome).toBe("pending");
    s = loosen.state;
    expect(rules.modeOf(s.config, "g1")).toBe("vault");

    const tighten = rules.requestChange(s, { kind: "guildMode", guildId: "g2", mode: "vault" }, T0, "c2");
    expect(tighten.outcome).toBe("applied");
    s = tighten.state;

    expect(rules.modeOf(rules.applyDue(s, T0 + 23 * HOUR).config, "g1")).toBe("vault");
    const later = rules.applyDue(s, T0 + 24 * HOUR);
    expect(rules.modeOf(later.config, "g1")).toBe("open");
    expect(later.pending).toHaveLength(0);
  });

  it("re-vaulting cancels a pending unvault", () => {
    let s = onboarded({ guildModes: { g1: "vault" } });
    s = rules.requestChange(s, { kind: "guildMode", guildId: "g1", mode: "open" }, T0, "c1").state;
    s = rules.requestChange(s, { kind: "guildMode", guildId: "g1", mode: "vault" }, T0 + HOUR, "c2").state;
    expect(s.pending).toHaveLength(0);
    expect(rules.modeOf(rules.applyDue(s, T0 + 48 * HOUR).config, "g1")).toBe("vault");
  });

  it("shortening the cooldown is itself delayed by the current cooldown", () => {
    const r = rules.requestChange(onboarded(), { kind: "cooldownHours", value: 1 }, T0, "c1");
    expect(r.outcome).toBe("pending");
    if (r.outcome === "pending") expect(r.pending.effectiveAt).toBe(T0 + 24 * HOUR);
  });

  it("lowering the pass budget applies now, raising it waits", () => {
    expect(rules.requestChange(onboarded(), { kind: "manualPassesPerDay", value: 1 }, T0, "a").outcome).toBe("applied");
    expect(rules.requestChange(onboarded(), { kind: "manualPassesPerDay", value: 9 }, T0, "b").outcome).toBe("pending");
  });
});

describe("passes", () => {
  const vaulted = () => onboarded({ guildModes: { g1: "vault", g2: "open" } });

  it("only opens passes into vaulted servers", () => {
    const r = rules.openPass(vaulted(), { guildId: "g2", channelId: "c", kind: "mention" }, T0, "p");
    expect(r).toEqual({ ok: false, reason: "not-vaulted" });
  });

  it("makes manual passes wait out a doubling pause, then counts them against the daily budget", () => {
    let s = vaulted();
    const MIN = 60_000;
    // No instant manual passes any more: they go through the pause.
    expect(rules.openPass(s, { guildId: "g1", channelId: "c0", kind: "manual" }, T0, "p0")).toEqual({ ok: false, reason: "pause-required" });
    expect(rules.requestPass(s, { guildId: "g2", channelId: "c" }, T0, "r")).toEqual({ ok: false, reason: "not-vaulted" });

    let t = T0;
    for (let i = 0; i < 3; i++) {
      const req = rules.requestPass(s, { guildId: "g1", channelId: `c${i}` }, t, `r${i}`);
      if (!req.ok) throw new Error("expected request");
      expect(req.request.readyAt - t).toBe(MIN * 2 ** i); // 1, 2, 4 minutes
      s = req.state;
      expect(rules.claimPass(s, req.request.readyAt - 1, `p${i}`)).toEqual({ ok: false, reason: "too-early" });
      t = req.request.readyAt;
      const claimed = rules.claimPass(s, t, `p${i}`);
      if (!claimed.ok) throw new Error("expected pass");
      expect(claimed.pass.kind).toBe("manual");
      s = claimed.state;
      expect(s.passRequest).toBeUndefined();
    }
    expect(rules.manualPassesLeft(s, t)).toBe(0);
    expect(rules.requestPass(s, { guildId: "g1", channelId: "c9" }, t, "r9")).toEqual({ ok: false, reason: "budget-exhausted" });
    // mention passes stay free and instant even when the manual budget is spent
    expect(rules.openPass(s, { guildId: "g1", channelId: "c9", kind: "mention" }, t, "pm").ok).toBe(true);
    // budget and pause reset the next local day
    expect(rules.manualPassesLeft(s, T0 + 24 * HOUR)).toBe(3);
    expect(rules.passPause(s, T0 + 24 * HOUR)).toBe(MIN);
  });

  it("lets a paused request be cancelled, and lapses it when nobody claims it", () => {
    const req = rules.requestPass(vaulted(), { guildId: "g1", channelId: "c1" }, T0, "r1");
    if (!req.ok) throw new Error("expected request");
    expect(rules.cancelPassRequest(req.state).passRequest).toBeUndefined();
    const late = req.request.readyAt + rules.PASS_CLAIM_WINDOW_MS + 1;
    expect(rules.claimPass(req.state, late, "p1")).toEqual({ ok: false, reason: "expired" });
    expect(rules.expirePassRequest(req.state, req.request.readyAt).passRequest).toBeDefined();
    expect(rules.expirePassRequest(req.state, late).passRequest).toBeUndefined();
    // Nothing was spent.
    expect(rules.manualPassesLeft(rules.expirePassRequest(req.state, late), late)).toBe(3);
  });

  it("treats a shorter pause or turning off doubling as loosening", () => {
    const s = onboarded();
    expect(rules.requestChange(s, { kind: "passPauseSeconds", value: 30 }, T0, "a").outcome).toBe("pending");
    expect(rules.requestChange(s, { kind: "passPauseSeconds", value: 300 }, T0, "b").outcome).toBe("applied");
    expect(rules.requestChange(s, { kind: "passPauseDoubles", value: false }, T0, "c").outcome).toBe("pending");
    const fixed = onboarded({ passPauseDoubles: false });
    expect(rules.requestChange(fixed, { kind: "passPauseDoubles", value: true }, T0, "d").outcome).toBe("applied");
    expect(rules.passPause(fixed, T0)).toBe(60_000);
  });

  it("lasts passMinutes, extends once, and expires", () => {
    const opened = rules.openPass(vaulted(), { guildId: "g1", channelId: "c1", kind: "mention" }, T0, "p1");
    if (!opened.ok) throw new Error("expected pass");
    let s = opened.state;
    expect(rules.canViewChannel(s, "g1", "c1", T0 + 9 * 60_000)).toBe(true);
    s = rules.extendPass(s, "p1", T0 + 9 * 60_000);
    s = rules.extendPass(s, "p1", T0 + 9 * 60_000); // second extension is ignored
    expect(s.passes[0]!.endsAt).toBe(T0 + 15 * 60_000);
    expect(rules.canViewChannel(s, "g1", "c1", T0 + 16 * 60_000)).toBe(false);
    s = rules.expirePasses(s, T0 + 16 * 60_000);
    expect(s.passes[0]!.endedAt).toBe(T0 + 15 * 60_000);
  });

  it("covers threads under the passed channel", () => {
    const opened = rules.openPass(vaulted(), { guildId: "g1", channelId: "parent", kind: "event" }, T0, "p1");
    if (!opened.ok) throw new Error("expected pass");
    expect(rules.canViewChannel(opened.state, "g1", "thread", T0, "parent")).toBe(true);
    expect(rules.canViewChannel(opened.state, "g1", "other", T0, "elsewhere")).toBe(false);
  });

  it("ending early records the end time", () => {
    const opened = rules.openPass(vaulted(), { guildId: "g1", channelId: "c1", kind: "mention" }, T0, "p1");
    if (!opened.ok) throw new Error("expected pass");
    const s = rules.endPass(opened.state, "p1", T0 + 60_000);
    expect(rules.activePass(s, "c1", T0 + 61_000)).toBeUndefined();
    expect(s.passes[0]!.endedAt).toBe(T0 + 60_000);
  });
});

describe("event channels", () => {
  const on = (guildId: string, channelId: string) => ({ kind: "eventChannel" as const, guildId, channelId, on: true });

  it("opening one in a vaulted server waits out the cooldown; in an open server, or before onboarding, it's instant", () => {
    const vaulted = rules.requestChange(onboarded({ guildModes: { g1: "vault" } }), on("g1", "events"), T0, "c1");
    expect(vaulted.outcome).toBe("pending");
    expect(rules.isEventChannel(vaulted.state.config, "events")).toBe(false);
    expect(rules.pendingEventChannels(vaulted.state, "g1").map((p) => p.change.channelId)).toEqual(["events"]);
    expect(rules.isEventChannel(rules.applyDue(vaulted.state, T0 + 24 * HOUR).config, "events")).toBe(true);

    const open = rules.requestChange(onboarded({ guildModes: { g2: "open" } }), on("g2", "calendar"), T0, "c2");
    expect(open.outcome).toBe("applied");

    const sorting = rules.requestChange(rules.initialRulesState(), on("g1", "events"), T0, "c3");
    expect(sorting.outcome).toBe("applied");
  });

  it("closing one is instant and cancels a pending open", () => {
    let s = rules.requestChange(onboarded({ guildModes: { g1: "vault" } }), on("g1", "events"), T0, "c1").state;
    s = rules.requestChange(s, { kind: "eventChannel", guildId: "g1", channelId: "events", on: false }, T0, "c2").state;
    expect(s.pending).toHaveLength(0);

    s = onboarded({ guildModes: { g1: "vault" }, eventChannels: { events: "g1" } });
    const closed = rules.requestChange(s, { kind: "eventChannel", guildId: "g1", channelId: "events", on: false }, T0, "c3");
    expect(closed.outcome).toBe("applied");
    expect(rules.isEventChannel(closed.state.config, "events")).toBe(false);
  });

  it("stays readable in a vaulted server without a pass, threads included", () => {
    const s = onboarded({ guildModes: { g1: "vault" }, eventChannels: { events: "g1" } });
    expect(rules.canViewChannel(s, "g1", "events", T0)).toBe(true);
    expect(rules.canViewChannel(s, "g1", "thread", T0, "events")).toBe(true);
    expect(rules.canViewChannel(s, "g1", "general", T0)).toBe(false);
  });
});

describe("notification policy", () => {
  const base = (patch: Partial<rules.NotifyInput> = {}): rules.NotifyInput => ({
    config: { ...rules.DEFAULT_CONFIG, guildModes: { vault: "vault", open: "open" } },
    meId: "me",
    authorId: "friend",
    isDM: false,
    mention: null,
    mutedByDiscord: false,
    authorBlocked: false,
    viewingChannel: false,
    now: T0,
    ...patch,
  });
  const ping = (kind: Mention["kind"]): Mention => ({ kind, pings: true });

  it("notifies for DMs unless muted, blocked, or already viewing", () => {
    expect(rules.decideNotification(base({ isDM: true }))).toEqual({ action: "notify", category: "dm" });
    expect(rules.decideNotification(base({ isDM: true, mutedByDiscord: true })).action).toBe("none");
    expect(rules.decideNotification(base({ isDM: true, authorBlocked: true })).action).toBe("none");
    expect(rules.decideNotification(base({ isDM: true, viewingChannel: true })).action).toBe("none");
    expect(rules.decideNotification(base({ isDM: true, authorId: "me" })).action).toBe("none");
  });

  it("stays quiet for ordinary server chatter", () => {
    expect(rules.decideNotification(base({ guildId: "open" })).action).toBe("none");
    expect(rules.decideNotification(base({ guildId: "vault" })).action).toBe("none");
  });

  it("notifies for pings, can batch vault pings, ignores @everyone in vaults", () => {
    expect(rules.decideNotification(base({ guildId: "vault", mention: ping("user") }))).toEqual({
      action: "notify",
      category: "mention",
    });
    const digestCfg = { ...rules.DEFAULT_CONFIG, guildModes: { vault: "vault" as const }, vaultMentionDelivery: "digest" as const };
    expect(rules.decideNotification(base({ config: digestCfg, guildId: "vault", mention: ping("role") })).action).toBe("digest");
    expect(rules.decideNotification(base({ guildId: "vault", mention: ping("everyone") })).action).toBe("none");
    expect(rules.decideNotification(base({ guildId: "open", mention: ping("everyone") })).action).toBe("notify");
    expect(rules.decideNotification(base({ guildId: "vault", mention: { kind: "reply", pings: false } })).action).toBe("none");
  });

  it("can follow Discord's all-messages setting in open servers", () => {
    const cfg = { ...rules.DEFAULT_CONFIG, guildModes: { open: "open" as const }, openNotify: "discord" as const };
    expect(rules.decideNotification(base({ config: cfg, guildId: "open", discordLevel: 0 })).action).toBe("notify");
    expect(rules.decideNotification(base({ config: cfg, guildId: "open", discordLevel: 1 })).action).toBe("none");
  });

  it("holds during quiet hours", () => {
    const night = new Date(2026, 8, 23, 23, 30).getTime();
    const d = rules.decideNotification(base({ isDM: true, now: night }));
    expect(d.action).toBe("hold");
    if (d.action === "hold") expect(new Date(d.until).getHours()).toBe(8);
  });
});

describe("time helpers", () => {
  it("handles quiet hours spanning midnight", () => {
    const q = { enabled: true, start: "23:00", end: "08:00" };
    expect(rules.quietHoursEnd(q, new Date(2026, 0, 1, 22, 59).getTime())).toBeNull();
    expect(rules.quietHoursEnd(q, new Date(2026, 0, 1, 23, 0).getTime())).toBe(new Date(2026, 0, 2, 8, 0).getTime());
    expect(rules.quietHoursEnd(q, new Date(2026, 0, 2, 3, 0).getTime())).toBe(new Date(2026, 0, 2, 8, 0).getTime());
    expect(rules.quietHoursEnd(q, new Date(2026, 0, 2, 8, 0).getTime())).toBeNull();
  });

  it("finds the next digest slot", () => {
    const now = new Date(2026, 0, 1, 13, 0).getTime();
    expect(rules.nextDigestTime(["12:00", "18:00"], now)).toBe(new Date(2026, 0, 1, 18, 0).getTime());
    expect(rules.nextDigestTime(["12:00"], now)).toBe(new Date(2026, 0, 2, 12, 0).getTime());
  });
});
