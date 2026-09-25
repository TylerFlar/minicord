import { describe, expect, it } from "vitest";
import { GatewayClient } from "../src/gateway/client.ts";
import type { SocketFactory } from "../src/gateway/socket.ts";
import { SessionHost } from "../src/host/session-host.ts";
import { DiscordApi } from "../src/rest/api.ts";
import type { RequestOptions } from "../src/rest/client.ts";
import { reactionCounts, Store } from "../src/store/store.ts";
import { Permission } from "../src/permissions.ts";
import { decodeGuildFolders } from "../src/util/proto.ts";
import type { GatewayDispatch, Message } from "../src/types.ts";

const VIEW_SEND = String(Permission.ViewChannel | Permission.SendMessages | Permission.ReadMessageHistory);

/** A READY shaped like the web capability set produces: dehydrated users, CLIENT_STATE_V2 guild properties, versioned states. */
function readyPayload() {
  return {
    v: 9,
    session_id: "sess",
    resume_gateway_url: "wss://resume.example",
    user: { id: "me", username: "tyler" },
    users: [
      { id: "sam", username: "sam", global_name: "Sam" },
      { id: "alex", username: "alex" },
    ],
    guilds: [
      {
        id: "g1",
        data_mode: "full",
        properties: { name: "r/sandiego", icon: null, owner_id: "someone" },
        roles: [
          { id: "g1", name: "@everyone", permissions: VIEW_SEND, position: 0 },
          { id: "meetup", name: "meetups", permissions: "0", position: 1 },
        ],
        channels: [
          { id: "cat", type: 4, name: "Community", position: 1 },
          { id: "general", type: 0, name: "general", position: 0, parent_id: "cat", last_message_id: "500" },
          { id: "events", type: 0, name: "events", position: 1, parent_id: "cat" },
          { id: "voice", type: 2, name: "Hangout", position: 0, parent_id: "cat" },
          {
            id: "mods",
            type: 0,
            name: "mods",
            position: 2,
            parent_id: "cat",
            permission_overwrites: [{ id: "g1", type: 0, allow: "0", deny: String(Permission.ViewChannel) }],
          },
          { id: "rules", type: 0, name: "rules", position: 0 },
        ],
        threads: [],
        guild_scheduled_events: [
          {
            id: "ev1",
            name: "Beach cleanup",
            scheduled_start_time: "2099-01-01T16:00:00Z",
            status: 1,
            entity_type: 3,
            entity_metadata: { location: "OB Pier" },
          },
        ],
      },
      { id: "g2", unavailable: true },
    ],
    merged_members: [[{ user_id: "me", roles: ["meetup"] }], []],
    private_channels: [
      { id: "dm-sam", type: 1, recipient_ids: ["sam"], last_message_id: "900" },
      { id: "group", type: 3, recipient_ids: ["sam", "alex"], last_message_id: "800", name: null },
    ],
    relationships: [{ id: "sam", type: 1, user_id: "sam", nickname: null }],
    read_state: {
      version: 1,
      partial: false,
      entries: [
        { id: "dm-sam", last_message_id: "850", mention_count: 1 },
        { id: "group", last_message_id: "800", mention_count: 0 },
        { id: "notif", read_state_type: 2, last_acked_id: "1" },
      ],
    },
    user_guild_settings: {
      version: 1,
      partial: false,
      entries: [
        { guild_id: "g1", muted: false, message_notifications: 1, suppress_everyone: true, suppress_roles: false, channel_overrides: [] },
        {
          guild_id: null,
          muted: false,
          message_notifications: 0,
          suppress_everyone: false,
          suppress_roles: false,
          channel_overrides: [{ channel_id: "group", muted: true, message_notifications: 3 }],
        },
      ],
    },
  };
}

const dispatch = (t: string, d: unknown): GatewayDispatch => ({ t, s: null, d });

describe("Store", () => {
  it("hydrates a dehydrated, versioned READY", () => {
    const store = new Store();
    store.hydrate(readyPayload());
    expect(store.me?.id).toBe("me");
    expect(store.guilds.get("g1")?.name).toBe("r/sandiego");
    expect(store.guilds.has("g2")).toBe(false); // unavailable guilds arrive later via GUILD_CREATE
    expect(store.channels.get("general")?.guild_id).toBe("g1");
    expect(store.myMembers.get("g1")?.roles).toEqual(["meetup"]);
    expect(store.channelName(store.channels.get("dm-sam"))).toBe("Sam");
    expect(store.channelName(store.channels.get("group"))).toBe("Sam, alex");
    expect(store.readStates.has("notif")).toBe(false); // non-channel read states are ignored
    expect(store.events.get("ev1")?.guild_id).toBe("g1");
  });

  it("groups visible channels by category with voice last", () => {
    const store = new Store();
    store.hydrate(readyPayload());
    const groups = store.guildChannelGroups("g1");
    expect(groups.map((g) => g.category?.name ?? null)).toEqual([null, "Community"]);
    expect(groups[1]!.channels.map((c) => c.name)).toEqual(["general", "events", "Hangout"]);
    expect(groups.flatMap((g) => g.channels).some((c) => c.id === "mods")).toBe(false);
  });

  it("tracks unread DMs and respects DM mutes", () => {
    const store = new Store();
    store.hydrate(readyPayload());
    expect(store.isUnread("dm-sam")).toBe(true);
    expect(store.isUnread("group")).toBe(false);
    expect(store.mutedByDiscord(store.channels.get("group")!)).toBe(true);
    expect(store.unreadDms().map((c) => c.id)).toEqual(["dm-sam"]);
  });

  it("applies live messages: last id, mention counts, own messages mark read", async () => {
    const store = new Store();
    store.hydrate(readyPayload());
    const base = { channel_id: "general", guild_id: "g1", content: "", timestamp: "", mention_everyone: false, mentions: [], attachments: [], embeds: [], type: 0 };
    store.apply(dispatch("MESSAGE_CREATE", { ...base, id: "600", author: { id: "alex", username: "alex" }, mention_roles: ["meetup"] }));
    expect(store.channels.get("general")?.last_message_id).toBe("600");
    expect(store.mentionCount("general")).toBe(1);
    // suppress_everyone is on for g1, so @everyone doesn't count
    store.apply(dispatch("MESSAGE_CREATE", { ...base, id: "601", author: { id: "alex", username: "alex" }, mention_roles: [], mention_everyone: true }));
    expect(store.mentionCount("general")).toBe(1);
    store.apply(dispatch("MESSAGE_CREATE", { ...base, id: "602", author: { id: "me", username: "tyler" }, mention_roles: [] }));
    expect(store.isUnread("general")).toBe(false);
    expect(store.mentionCount("general")).toBe(0);
  });

  it("keeps message pages ordered and reconciles optimistic sends by nonce", () => {
    const store = new Store();
    store.hydrate(readyPayload());
    const m = (id: string, extra = {}) => ({ id, channel_id: "dm-sam", author: { id: "sam", username: "sam" }, content: id, timestamp: "", mention_everyone: false, mentions: [], mention_roles: [], attachments: [], embeds: [], type: 0, ...extra });
    store.setMessagePage("dm-sam", [m("900"), m("899"), m("898")], "latest", 3);
    expect(store.messagesOf("dm-sam")!.messages.map((x) => x.id)).toEqual(["898", "899", "900"]);
    expect(store.messagesOf("dm-sam")!.hasMoreBefore).toBe(true);
    store.setMessagePage("dm-sam", [m("897")], "before", 50);
    expect(store.messagesOf("dm-sam")!.messages[0]!.id).toBe("897");
    expect(store.messagesOf("dm-sam")!.hasMoreBefore).toBe(false);

    store.addPendingMessage(m("pending-1", { nonce: "n1", author: { id: "me", username: "tyler" } }));
    store.apply(dispatch("MESSAGE_CREATE", m("901", { nonce: "n1", author: { id: "me", username: "tyler" } })));
    const ids = store.messagesOf("dm-sam")!.messages.map((x) => x.id);
    expect(ids).toContain("901");
    expect(ids).not.toContain("pending-1");
  });

  it("handles CALL_CREATE in both documented and live shapes, and RSVPs", () => {
    const store = new Store();
    store.hydrate(readyPayload());
    store.apply(dispatch("CALL_CREATE", { channel_id: "dm-sam", message_id: "1", ongoing_rings: { me: {} } }));
    expect(store.calls.get("dm-sam")?.ringing).toEqual(["me"]);
    store.apply(dispatch("CALL_UPDATE", { channel_id: "dm-sam", ringing: [] }));
    expect(store.calls.get("dm-sam")?.ringing).toEqual([]);
    store.apply(dispatch("CALL_DELETE", { channel_id: "dm-sam" }));
    expect(store.calls.size).toBe(0);

    store.apply(dispatch("GUILD_SCHEDULED_EVENT_USER_ADD", { guild_scheduled_event_id: "ev1", user_id: "me", guild_id: "g1" }));
    expect(store.myRsvps.has("ev1")).toBe(true);
  });

  it("batches change notifications per key", async () => {
    const store = new Store();
    let calls = 0;
    store.subscribe(["dms", "guilds"], () => calls++);
    store.hydrate(readyPayload());
    await Promise.resolve();
    expect(calls).toBe(1);
  });
});

// Minimal protobuf writer for building PreloadedUserSettings fixtures.
const varint = (n: bigint): number[] => {
  const out: number[] = [];
  do {
    let b = Number(n & 0x7fn);
    n >>= 7n;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
};
const field = (no: number, wire: number, payload: number[]) => [...varint(BigInt((no << 3) | wire)), ...(wire === 2 ? varint(BigInt(payload.length)) : []), ...payload];
const fixed64 = (id: string) => {
  let v = BigInt(id);
  return Array.from({ length: 8 }, () => {
    const b = Number(v & 0xffn);
    v >>= 8n;
    return b;
  });
};
const base64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));

describe("Guild folders", () => {
  const folderA = [
    ...field(1, 2, [...fixed64("1100000000000000123"), ...fixed64("22")]), // packed ids
    ...field(2, 2, field(1, 0, varint(7n))),
    ...field(3, 2, field(1, 2, [...new TextEncoder().encode("Friends")])),
  ];
  const folderB = field(1, 1, fixed64("33")); // unpacked id
  const proto = [...field(1, 2, field(1, 0, varint(5n))), ...field(14, 2, [...field(1, 2, folderA), ...field(1, 2, folderB)])];

  it("decodes folders from PreloadedUserSettings", () => {
    expect(decodeGuildFolders(base64(proto))).toEqual([
      { id: "7", name: "Friends", guildIds: ["1100000000000000123", "22"] },
      { guildIds: ["33"] },
    ]);
    expect(decodeGuildFolders(base64(field(1, 2, field(1, 0, varint(5n)))))).toBeNull(); // partial update without folders
    expect(decodeGuildFolders("not base64!")).toBeNull();
  });

  it("orders servers like Discord: unlisted first, then folder order", () => {
    const store = new Store();
    const ready = readyPayload();
    const guild = (id: string, name: string) => ({ ...ready.guilds[0], id, properties: { name }, channels: [], guild_scheduled_events: [] });
    store.hydrate({
      ...ready,
      guilds: [guild("33", "Alpha"), guild("22", "Beta"), guild("44", "Zulu"), guild("1100000000000000123", "Gamma")],
      merged_members: [],
      user_settings_proto: base64(proto),
    });
    expect(store.sortedGuilds().map((g) => g.id)).toEqual(["44", "1100000000000000123", "22", "33"]);
  });
});

describe("Server indicators", () => {
  it("counts unread channels and mentions, ignoring muted and hidden channels", () => {
    const store = new Store();
    store.hydrate(readyPayload());
    expect(store.guildUnread("g1")).toEqual({ unread: true, mentions: 0 }); // #general has messages, never read
    store.markRead("general", "500");
    expect(store.guildUnread("g1").unread).toBe(false);
    store.apply(dispatch("MESSAGE_CREATE", { id: "600", channel_id: "general", guild_id: "g1", author: { id: "sam", username: "sam" }, content: "<@me>", mentions: [{ id: "me", username: "tyler" }], mention_roles: [], attachments: [], embeds: [], mention_everyone: false, timestamp: "", type: 0 }));
    expect(store.guildUnread("g1")).toEqual({ unread: true, mentions: 1 });
    store.apply(dispatch("USER_GUILD_SETTINGS_UPDATE", { guild_id: "g1", muted: true, message_notifications: 1, suppress_everyone: false, suppress_roles: false, channel_overrides: [] }));
    expect(store.guildUnread("g1")).toEqual({ unread: false, mentions: 1 }); // muted servers still count mentions
  });
});

describe("SessionHost replay", () => {
  it("replays READY plus a compacted backlog", () => {
    const noSocket: SocketFactory = () => ({ send() {}, close() {} });
    const gateway = new GatewayClient({ identify: () => ({ token: "t", capabilities: 0, properties: {} }), socketFactory: noSocket });
    const host = new SessionHost(gateway);
    const emit = (t: string, d: unknown) => gateway.emit("dispatch", dispatch(t, d));

    emit("READY", readyPayload());
    emit("TYPING_START", { channel_id: "dm-sam", user_id: "sam" });
    emit("MESSAGE_CREATE", { id: "700", channel_id: "general", guild_id: "g1", author: { id: "alex" }, mentions: [] });
    emit("MESSAGE_CREATE", { id: "701", channel_id: "general", guild_id: "g1", author: { id: "alex" }, mentions: [] });
    emit("MESSAGE_CREATE", { id: "702", channel_id: "general", guild_id: "g1", author: { id: "alex" }, mentions: [{ id: "me" }] });
    emit("MESSAGE_REACTION_ADD", { channel_id: "general", guild_id: "g1", message_id: "700", user_id: "alex", emoji: { name: "👍" } });
    emit("MESSAGE_CREATE", { id: "950", channel_id: "dm-sam", author: { id: "sam" }, mentions: [] });

    const snap = host.snapshot();
    expect(snap.ready?.t).toBe("READY");
    expect(snap.backlog.map((e) => e.t)).toEqual(["MESSAGE_CREATE", "MESSAGE_CREATE", "MINICORD_CHANNEL_LAST_MESSAGES"]);
    expect(snap.backlog.at(-1)!.d).toEqual({ general: "701" });

    // A replica store rebuilt from the snapshot matches live state.
    const replica = new Store();
    replica.hydrate(snap.ready!.d as Record<string, unknown>);
    for (const e of snap.backlog) replica.apply(e);
    expect(replica.channels.get("general")?.last_message_id).toBe("702");
    expect(replica.channels.get("dm-sam")?.last_message_id).toBe("950");
  });
});

describe("Typing", () => {
  it("shows people typing in servers under their server nickname", () => {
    const store = new Store();
    store.hydrate(readyPayload());
    // Server typing carries the member (as the gateway sends it once subscribed with typing: true).
    store.apply(dispatch("TYPING_START", { channel_id: "general", guild_id: "g1", user_id: "robin", timestamp: 1, member: { user: { id: "robin", username: "robin" }, roles: [], nick: "Rob" } }));
    expect(store.typingIn("general").map((u) => u.id)).toEqual(["robin"]);
    expect(store.displayName("robin", "g1")).toBe("Rob");
  });

  it("leaves out yourself and people you've blocked, and expires after 10 s", () => {
    const store = new Store();
    store.hydrate(readyPayload());
    store.apply(dispatch("RELATIONSHIP_ADD", { id: "alex", type: 2, user: { id: "alex", username: "alex" } }));
    for (const user_id of ["me", "alex", "sam"]) store.apply(dispatch("TYPING_START", { channel_id: "group", user_id, timestamp: 1 }));
    expect(store.typingIn("group").map((u) => u.id)).toEqual(["sam"]);

    const now = Date.now();
    expect(store.typingUntil("group", now)! - now).toBeGreaterThan(9_000);
    expect(store.typingIn("group", now + 10_001)).toEqual([]);
    expect(store.typingUntil("group", now + 10_001)).toBeUndefined();
  });

  it("stops showing someone once their message arrives", () => {
    const store = new Store();
    store.hydrate(readyPayload());
    store.apply(dispatch("TYPING_START", { channel_id: "dm-sam", user_id: "sam", timestamp: 1 }));
    expect(store.typingIn("dm-sam")).toHaveLength(1);
    store.apply(dispatch("MESSAGE_CREATE", { id: "951", channel_id: "dm-sam", author: { id: "sam", username: "sam" }, content: "hi", timestamp: "", mention_everyone: false, mentions: [], mention_roles: [], attachments: [], embeds: [], type: 0 }));
    expect(store.typingIn("dm-sam")).toEqual([]);
  });
});

describe("Reactions", () => {
  const message = (reactions: Message["reactions"]): Message => ({
    id: "700",
    channel_id: "general",
    guild_id: "g1",
    author: { id: "sam", username: "sam" },
    content: "",
    timestamp: "",
    mention_everyone: false,
    mentions: [],
    mention_roles: [],
    attachments: [],
    embeds: [],
    type: 0,
    ...(reactions ? { reactions } : {}),
  });
  const react = (t: string, user_id: string, emoji: { id: string | null; name: string }, burst = false, extra = {}) =>
    dispatch(t, { channel_id: "general", guild_id: "g1", message_id: "700", user_id, emoji, burst, type: burst ? 1 : 0, ...extra });

  it("keeps regular and super reaction counts apart", () => {
    const store = new Store();
    store.hydrate(readyPayload());
    const thumbs = { id: null, name: "👍" };
    store.setMessagePage("general", [message([{ emoji: thumbs, count: 2, me: false, count_details: { normal: 2, burst: 0 } }])], "latest", 50);
    store.apply(react("MESSAGE_REACTION_ADD", "sam", thumbs, true));
    store.apply(react("MESSAGE_REACTION_REMOVE", "alex", thumbs));
    store.apply(react("MESSAGE_REACTION_ADD", "me", { id: "9", name: "party" }));
    const [first, second] = store.messagesOf("general")!.messages[0]!.reactions!;
    expect(first).toMatchObject({ count: 2, count_details: { normal: 1, burst: 1 }, me: false });
    expect(second).toMatchObject({ count: 1, count_details: { normal: 1, burst: 0 }, me: true });
  });

  it("reads counts from older payloads, and remembers who reacted", () => {
    expect(reactionCounts({ emoji: { id: null, name: "👍" }, count: 5, me: false, burst_count: 2 })).toEqual({ normal: 3, burst: 2 });
    expect(reactionCounts({ emoji: { id: null, name: "👍" }, count: 5, me: false })).toEqual({ normal: 5, burst: 0 });

    const store = new Store();
    store.hydrate(readyPayload());
    store.apply(react("MESSAGE_REACTION_ADD", "robin", { id: null, name: "👍" }, false, { member: { user: { id: "robin", username: "robin" }, roles: [], nick: "Rob" } }));
    expect(store.displayName("robin", "g1")).toBe("Rob");
    store.rememberUsers([{ id: "kim", username: "kim", global_name: "Kim" }]);
    expect(store.displayName("kim")).toBe("Kim");
  });

  it("lists who reacted through the reactions endpoint, custom emoji as name:id", async () => {
    const calls: [string, string, RequestOptions | undefined][] = [];
    const api = new DiscordApi(async <T>(method: string, path: string, opts?: RequestOptions) => {
      calls.push([method, path, opts]);
      return [] as T;
    });
    await api.reactions("c1", "m1", { id: "42", name: "party" }, { type: 1, after: "7" });
    await api.reactions("c1", "m1", { id: null, name: "👍" });
    expect(calls[0]).toEqual(["GET", "/channels/c1/messages/m1/reactions/party%3A42", { query: { limit: 100, type: 1, after: "7" } }]);
    expect(calls[1]![1]).toBe(`/channels/c1/messages/m1/reactions/${encodeURIComponent("👍")}`);
    expect(calls[1]![2]).toEqual({ query: { limit: 100, type: 0, after: undefined } });
  });
});
