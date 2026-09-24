import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { ZlibStreamInflater } from "../src/gateway/inflate.ts";
import { classifyMention } from "../src/mentions.ts";
import { basePermissions, channelPermissions, has, Permission } from "../src/permissions.ts";
import { launchSignature, ClientProperties, webIdentity } from "../src/properties.ts";
import { agendaBucket, googleCalendarUrl, isInPerson, toICS } from "../src/events.ts";
import type { Channel, Guild, Message, ScheduledEvent } from "../src/types.ts";

async function deflateFrames(payloads: unknown[]): Promise<Uint8Array[]> {
  const def = zlib.createDeflate();
  const frames: Uint8Array[] = [];
  for (const p of payloads) {
    def.write(JSON.stringify(p));
    frames.push(
      await new Promise<Uint8Array>((resolve) => {
        const parts: Buffer[] = [];
        const onData = (c: Buffer) => parts.push(c);
        def.on("data", onData);
        def.flush(zlib.constants.Z_SYNC_FLUSH, () => {
          def.off("data", onData);
          resolve(new Uint8Array(Buffer.concat(parts)));
        });
      }),
    );
  }
  return frames;
}

describe("zlib-stream inflater", () => {
  it("decodes consecutive payloads sharing one zlib context", async () => {
    const payloads = [{ op: 10, d: { heartbeat_interval: 41250 } }, { op: 11 }, { op: 0, t: "X", d: { text: "héllo 👋" } }];
    const inflater = new ZlibStreamInflater();
    const out = (await deflateFrames(payloads)).map((f) => inflater.push(f));
    expect(out.map((t) => JSON.parse(t!))).toEqual(payloads);
  });

  it("buffers a payload split across frames, even through the flush marker", async () => {
    const [frame] = await deflateFrames([{ op: 0, t: "READY", d: { big: "x".repeat(50_000) } }]);
    const inflater = new ZlibStreamInflater();
    expect(inflater.push(frame!.subarray(0, 10))).toBeNull();
    expect(inflater.push(frame!.subarray(10, frame!.length - 2))).toBeNull();
    const text = inflater.push(frame!.subarray(frame!.length - 2));
    expect(JSON.parse(text!).t).toBe("READY");
  });
});

describe("permissions", () => {
  const guild: Guild = {
    id: "g",
    name: "G",
    owner_id: "owner",
    roles: [
      { id: "g", name: "@everyone", permissions: String(Permission.ViewChannel | Permission.SendMessages), position: 0 },
      { id: "mod", name: "mod", permissions: String(Permission.Administrator), position: 2 },
      { id: "vip", name: "vip", permissions: "0", position: 1 },
    ],
  };
  const secret: Channel = {
    id: "c",
    type: 0,
    guild_id: "g",
    permission_overwrites: [
      { id: "g", type: 0, allow: "0", deny: String(Permission.ViewChannel) },
      { id: "vip", type: 0, allow: String(Permission.ViewChannel), deny: "0" },
    ],
  };

  it("applies @everyone, role and member overwrites in order", () => {
    expect(has(channelPermissions(guild, secret, { roles: [] }, "u"), Permission.ViewChannel)).toBe(false);
    expect(has(channelPermissions(guild, secret, { roles: ["vip"] }, "u"), Permission.ViewChannel)).toBe(true);
    const memberDeny: Channel = {
      ...secret,
      permission_overwrites: [...secret.permission_overwrites!, { id: "u", type: 1, allow: "0", deny: String(Permission.ViewChannel) }],
    };
    expect(has(channelPermissions(guild, memberDeny, { roles: ["vip"] }, "u"), Permission.ViewChannel)).toBe(false);
  });

  it("gives owners and administrators everything", () => {
    expect(has(channelPermissions(guild, secret, undefined, "owner"), Permission.ViewChannel)).toBe(true);
    expect(has(basePermissions(guild, { roles: ["mod"] }, "u"), Permission.ViewChannel)).toBe(true);
    expect(has(channelPermissions(guild, secret, { roles: ["mod"] }, "u"), Permission.ViewChannel)).toBe(true);
  });
});

describe("mentions", () => {
  const ctx = {
    meId: "me",
    myRoleIds: () => ["r1"],
    guildSettings: () => ({ guild_id: "g", muted: false, message_notifications: 1, suppress_everyone: false, suppress_roles: false, channel_overrides: [] }),
  };
  const msg = (patch: Partial<Message>): Message => ({
    id: "1",
    channel_id: "c",
    guild_id: "g",
    author: { id: "other", username: "o" },
    content: "",
    timestamp: "",
    mention_everyone: false,
    mentions: [],
    mention_roles: [],
    attachments: [],
    embeds: [],
    type: 0,
    ...patch,
  });

  it("classifies direct, reply, role and everyone mentions", () => {
    expect(classifyMention(msg({ content: "hi <@me>", mentions: [{ id: "me", username: "me" }] }), ctx)).toEqual({ kind: "user", pings: true });
    const replied = { referenced_message: msg({ author: { id: "me", username: "me" } }) };
    expect(classifyMention(msg({ ...replied, mentions: [{ id: "me", username: "me" }] }), ctx)).toEqual({ kind: "reply", pings: true });
    expect(classifyMention(msg(replied), ctx)).toEqual({ kind: "reply", pings: false });
    expect(classifyMention(msg({ mention_roles: ["r1"] }), ctx)).toEqual({ kind: "role", pings: true });
    expect(classifyMention(msg({ mention_roles: ["r2"] }), ctx)).toBeNull();
    expect(classifyMention(msg({ mention_everyone: true }), ctx)).toEqual({ kind: "everyone", pings: true });
  });

  it("respects suppress settings and ignores own messages", () => {
    const suppressed = { ...ctx, guildSettings: () => ({ ...ctx.guildSettings(), suppress_everyone: true, suppress_roles: true }) };
    expect(classifyMention(msg({ mention_everyone: true }), suppressed)).toBeNull();
    expect(classifyMention(msg({ mention_roles: ["r1"] }), suppressed)).toBeNull();
    expect(classifyMention(msg({ author: { id: "me", username: "me" }, mention_everyone: true }), ctx)).toBeNull();
  });
});

describe("client properties", () => {
  it("never sets client-mod detection bits in the launch signature", () => {
    const bits = [119, 108, 100, 91, 84, 75, 61, 55, 48, 38, 24, 11];
    for (let i = 0; i < 200; i++) {
      const value = BigInt(`0x${launchSignature().replace(/-/g, "")}`);
      for (const b of bits) expect((value >> BigInt(b)) & 1n).toBe(0n);
      expect((value >> 76n) & 0xfn).toBe(4n); // still a v4 UUID
    }
  });

  it("keeps the super-properties user agent identical to the User-Agent header", () => {
    const props = new ClientProperties(webIdentity({ chromeMajor: 146, buildNumber: 619060, timezone: "America/Los_Angeles" }));
    const headers = props.headers();
    const decoded = JSON.parse(Buffer.from(headers["X-Super-Properties"]!, "base64").toString("utf8"));
    expect(decoded.browser_user_agent).toBe(headers["User-Agent"]);
    expect(decoded.client_build_number).toBe(619060);
    expect(decoded.has_client_mods).toBe(false);
    expect(Object.keys(decoded).slice(0, 3)).toEqual(["os", "browser", "device"]);
  });
});

describe("events", () => {
  const event: ScheduledEvent = {
    id: "e1",
    guild_id: "g1",
    name: "Beach cleanup; bring gloves",
    description: "Meet at the pier, 9am",
    scheduled_start_time: "2026-10-03T16:00:00.000Z",
    scheduled_end_time: null,
    status: 1,
    entity_type: 3,
    entity_metadata: { location: "Ocean Beach Pier" },
  };

  it("recognises in-person events", () => {
    expect(isInPerson(event)).toBe(true);
    expect(isInPerson({ ...event, entity_metadata: { location: "https://zoom.us/x" } })).toBe(false);
    expect(isInPerson({ ...event, entity_metadata: { location: "VRChat (check #virtual-meets)" } })).toBe(false);
    expect(isInPerson({ ...event, entity_metadata: { location: "Balboa Park" } })).toBe(true);
    expect(isInPerson({ ...event, entity_type: 2 })).toBe(false);
  });

  it("builds calendar links and a valid ICS file", () => {
    const url = new URL(googleCalendarUrl(event, "r/sandiego"));
    expect(url.searchParams.get("dates")).toBe("20261003T160000Z/20261003T180000Z");
    expect(url.searchParams.get("location")).toBe("Ocean Beach Pier");
    const ics = toICS(event, "r/sandiego", Date.UTC(2026, 8, 23));
    expect(ics).toContain("SUMMARY:Beach cleanup\\; bring gloves");
    expect(ics).toContain("DESCRIPTION:Meet at the pier\\, 9am\\n\\nFrom r/sandiego on Discord");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("buckets events relative to now", () => {
    const now = new Date(2026, 9, 3, 8, 0).getTime();
    expect(agendaBucket({ ...event, scheduled_start_time: new Date(2026, 9, 3, 18, 0).toISOString() }, now)).toBe("today");
    expect(agendaBucket({ ...event, scheduled_start_time: new Date(2026, 9, 4, 9, 0).toISOString() }, now)).toBe("tomorrow");
    expect(agendaBucket({ ...event, scheduled_start_time: new Date(2026, 9, 20, 9, 0).toISOString() }, now)).toBe("later");
    expect(agendaBucket({ ...event, status: 2 }, now)).toBe("live");
  });
});
