import { describe, expect, it } from "vitest";
import { Permission } from "../src/permissions.ts";
import { DiscordApi } from "../src/rest/api.ts";
import type { RequestOptions } from "../src/rest/client.ts";
import { Store } from "../src/store/store.ts";
import type { GatewayDispatch } from "../src/types.ts";
import { msToSnowflake } from "../src/util/snowflake.ts";

const dispatch = (t: string, d: unknown): GatewayDispatch => ({ t, s: null, d });
const VIEW = 1n << 10n;
const JOINED = Date.UTC(2026, 8, 20, 12);

const thread = (id: string, lastMessageAt: number, member?: Record<string, unknown>) => ({
  id,
  type: 11,
  name: id,
  parent_id: "jobs",
  last_message_id: msToSnowflake(lastMessageAt),
  thread_metadata: { archived: false },
  ...(member ? { member } : {}),
});

function storeWith(threads: unknown[], everyone = VIEW, owner = "someone") {
  const store = new Store();
  store.hydrate({
    session_id: "s",
    user: { id: "me", username: "me" },
    users: [],
    guilds: [
      {
        id: "g1",
        properties: { name: "Home", owner_id: owner },
        roles: [{ id: "g1", name: "@everyone", permissions: String(everyone), position: 0 }],
        channels: [{ id: "jobs", type: 0, name: "jobs", position: 0 }],
        threads,
      },
    ],
    merged_members: [[{ user_id: "me", roles: [] }]],
    private_channels: [],
    relationships: [],
  });
  return store;
}

describe("threads", () => {
  it("treats a joined thread you never opened as read up to when you joined", () => {
    const joined = { join_timestamp: new Date(JOINED).toISOString(), flags: 1 };
    const store = storeWith([
      thread("quiet", JOINED - 60_000, joined),
      thread("active", JOINED + 60_000, joined),
      thread("stranger", JOINED - 60_000),
    ]);
    expect(store.isUnread("quiet")).toBe(false);
    expect(store.isUnread("active")).toBe(true);
    expect(store.isUnread("stranger")).toBe(true);
    expect(store.threadsOf("jobs").filter((t) => t.member).map((t) => t.id).sort()).toEqual(["active", "quiet"]);
  });

  it("follows joining and leaving", () => {
    const store = storeWith([thread("t1", JOINED), thread("t2", JOINED)]);
    store.apply(dispatch("THREAD_MEMBER_UPDATE", { id: "t1", guild_id: "g1", user_id: "me", join_timestamp: new Date(JOINED).toISOString(), flags: 1 }));
    expect(store.channels.get("t1")?.member?.join_timestamp).toBe(new Date(JOINED).toISOString());

    store.apply(dispatch("THREAD_MEMBERS_UPDATE", { id: "t1", guild_id: "g1", member_count: 3, removed_member_ids: ["me"] }));
    expect(store.channels.get("t1")?.member).toBeUndefined();
    expect(store.channels.get("t1")?.member_count).toBe(3);

    store.apply(dispatch("THREAD_MEMBERS_UPDATE", { id: "t2", guild_id: "g1", member_count: 2, added_members: [{ id: "t2", user_id: "me", join_timestamp: new Date(JOINED).toISOString() }] }));
    expect(store.channels.get("t2")?.member).toBeDefined();

    // Someone else's membership isn't ours.
    store.apply(dispatch("THREAD_MEMBER_UPDATE", { id: "t1", guild_id: "g1", user_id: "sam", join_timestamp: new Date(JOINED).toISOString() }));
    expect(store.channels.get("t1")?.member).toBeUndefined();
  });

  it("keeps membership when a thread is updated", () => {
    const store = storeWith([thread("t1", JOINED, { join_timestamp: new Date(JOINED).toISOString() })]);
    store.apply(dispatch("THREAD_UPDATE", { id: "t1", guild_id: "g1", type: 11, name: "renamed", parent_id: "jobs" }));
    expect(store.channels.get("t1")?.name).toBe("renamed");
    expect(store.channels.get("t1")?.member).toBeDefined();
  });
});

describe("events", () => {
  it("knows where you may create events", () => {
    expect(storeWith([]).canInGuild("g1", Permission.CreateEvents)).toBe(false);
    expect(storeWith([], VIEW | Permission.CreateEvents).canInGuild("g1", Permission.CreateEvents)).toBe(true);
    expect(storeWith([], VIEW, "me").canInGuild("g1", Permission.ManageEvents)).toBe(true);
  });

  it("creates events somewhere else or in a voice channel", async () => {
    const calls: { method: string; path: string; body: Record<string, unknown> }[] = [];
    const api = new DiscordApi(<T,>(method: string, path: string, opts?: RequestOptions): Promise<T> => {
      calls.push({ method, path, body: (opts?.json ?? {}) as Record<string, unknown> });
      return Promise.resolve({ id: "e1" } as T);
    });
    const start = Date.UTC(2026, 9, 3, 1);
    await api.createScheduledEvent("g1", { name: "Picnic", start, end: start + 7_200_000, location: "The park" });
    await api.createScheduledEvent("g1", { name: "Movie", start, channelId: "voice1" });
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/guilds/g1/scheduled-events",
      body: {
        name: "Picnic",
        privacy_level: 2,
        entity_type: 3,
        entity_metadata: { location: "The park" },
        scheduled_start_time: new Date(start).toISOString(),
        scheduled_end_time: new Date(start + 7_200_000).toISOString(),
      },
    });
    expect(calls[1]!.body).toMatchObject({ entity_type: 2, channel_id: "voice1", scheduled_end_time: null });
  });
});
