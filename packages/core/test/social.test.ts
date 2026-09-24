import { describe, expect, it } from "vitest";
import { forwardToUi, SessionHost } from "../src/host/session-host.ts";
import type { GatewayClient } from "../src/gateway/client.ts";
import { multipartBody } from "../src/rest/client.ts";
import { applyMemberListOps, memberListId, murmurhash3, type MemberList } from "../src/store/member-list.ts";
import { Store } from "../src/store/store.ts";
import type { GatewayDispatch } from "../src/types.ts";
import { Emitter } from "../src/util/emitter.ts";
import { decodeFavoriteGifs, decodeUserSettings, encodeStatusSettings } from "../src/util/proto.ts";

const dispatch = (t: string, d: unknown): GatewayDispatch => ({ t, s: null, d });
const VIEW = String(1n << 10n);

function readyWith(extra: Record<string, unknown> = {}) {
  return {
    session_id: "sess-1",
    user: { id: "me", username: "me" },
    users: [{ id: "sam", username: "sam" }],
    guilds: [
      {
        id: "g1",
        properties: { name: "Hikes" },
        roles: [{ id: "g1", name: "@everyone", permissions: VIEW, position: 0 }],
        channels: [
          { id: "general", type: 0, name: "general", position: 0 },
          { id: "mods", type: 0, name: "mods", position: 1, permission_overwrites: [{ id: "g1", type: 0, allow: "0", deny: VIEW }, { id: "modrole", type: 0, allow: VIEW, deny: "0" }] },
        ],
      },
    ],
    merged_members: [[{ user_id: "me", roles: [] }]],
    private_channels: [],
    relationships: [{ id: "sam", type: 1, user_id: "sam" }],
    ...extra,
  };
}

describe("member lists", () => {
  it("hashes like MurmurHash3 x86_32", () => {
    expect(murmurhash3("")).toBe(0);
    expect(murmurhash3("hello")).toBe(613153351);
    expect(murmurhash3("The quick brown fox jumps over the lazy dog")).toBe(0x2e4ff723);
  });

  it("names a channel's list 'everyone' or by its VIEW_CHANNEL overwrites", () => {
    expect(memberListId({ id: "c", type: 0 })).toBe("everyone");
    expect(memberListId({ id: "c", type: 0, permission_overwrites: [{ id: "r", type: 0, allow: "2048", deny: "0" }] })).toBe("everyone");
    const mods = { id: "c", type: 0, permission_overwrites: [{ id: "g1", type: 0 as const, allow: "0", deny: VIEW }, { id: "modrole", type: 0 as const, allow: VIEW, deny: "0" }] };
    expect(memberListId(mods)).toBe(String(murmurhash3("allow:modrole,deny:g1")));
  });

  it("applies SYNC, INSERT, UPDATE, DELETE and INVALIDATE", () => {
    const list: MemberList = { id: "everyone", guildId: "g", items: [], groups: [], memberCount: 0, onlineCount: 0 };
    const m = (id: string) => ({ member: { user: { id, username: id }, roles: [] } });
    applyMemberListOps(list, [{ op: "SYNC", range: [0, 99], items: [{ group: { id: "online", count: 2 } }, m("a"), m("b")] }]);
    expect(list.items).toHaveLength(3);
    applyMemberListOps(list, [{ op: "INSERT", index: 1, item: m("c") }]);
    applyMemberListOps(list, [{ op: "UPDATE", index: 3, item: m("d") }]);
    applyMemberListOps(list, [{ op: "DELETE", index: 2 }]);
    expect(list.items.map((i) => (i && "member" in i ? i.member.user?.id : i && "group" in i ? i.group.id : null))).toEqual(["online", "c", "d"]);
    applyMemberListOps(list, [{ op: "INVALIDATE", range: [0, 99] }]);
    expect(list.items).toHaveLength(0);
  });

  it("matches the list to the channel that asked, and remembers members and presences", () => {
    const store = new Store();
    store.hydrate(readyWith());
    const mods = store.channels.get("mods")!;
    store.expectMemberList("g1", "mods");
    store.apply(
      dispatch("GUILD_MEMBER_LIST_UPDATE", {
        guild_id: "g1",
        id: "some-list",
        member_count: 3,
        online_count: 1,
        groups: [{ id: "online", count: 1 }],
        ops: [
          {
            op: "SYNC",
            range: [0, 99],
            items: [
              { group: { id: "online", count: 1 } },
              { member: { user: { id: "kai", username: "kai" }, roles: [], nick: "Kai!", presence: { user: { id: "kai" }, status: "idle", activities: [] } } },
            ],
          },
        ],
      }),
    );
    expect(store.memberListFor(mods)?.items).toHaveLength(2);
    expect(store.memberListFor(store.channels.get("general")!)).toBeUndefined(); // different list
    expect(store.presenceOf("kai")?.status).toBe("idle");
    expect(store.displayName("kai", "g1")).toBe("Kai!");
  });
});

describe("presence", () => {
  it("reads friends' presences from READY and follows PRESENCE_UPDATE", () => {
    const store = new Store();
    store.hydrate(readyWith({ merged_presences: { friends: [{ user_id: "sam", status: "dnd", activities: [{ type: 4, name: "Custom Status", state: "hiking" }] }], guilds: [[]] } }));
    expect(store.sessionId).toBe("sess-1");
    expect(store.presenceOf("sam")?.status).toBe("dnd");
    store.apply(dispatch("PRESENCE_UPDATE", { user: { id: "sam" }, status: "online", activities: [] }));
    expect(store.presenceOf("sam")?.status).toBe("online");
  });

  it("round-trips your status through the settings protobuf", () => {
    const store = new Store();
    store.hydrate(readyWith({ user_settings_proto: encodeStatusSettings("dnd") }));
    expect(store.ownStatus.status).toBe("dnd");
    store.apply(dispatch("USER_SETTINGS_PROTO_UPDATE", { settings: { type: 1, proto: encodeStatusSettings("invisible") }, partial: true }));
    expect(store.ownStatus.status).toBe("invisible");
    expect(decodeUserSettings(encodeStatusSettings("idle"))).toEqual({ guildFolders: null, status: { status: "idle" } });
  });

  it("decodes favorite GIFs from the frecency settings, newest first", () => {
    const enc = new TextEncoder();
    const varint = (n: number) => {
      const out: number[] = [];
      do {
        let b = n & 0x7f;
        n >>>= 7;
        if (n) b |= 0x80;
        out.push(b);
      } while (n);
      return out;
    };
    const ld = (no: number, payload: number[]) => [...varint((no << 3) | 2), ...varint(payload.length), ...payload];
    const vi = (no: number, v: number) => [...varint(no << 3), ...varint(v)];
    const gif = (url: string, src: string, order: number) =>
      ld(1, [...ld(1, [...enc.encode(url)]), ...ld(2, [...vi(1, 2), ...ld(2, [...enc.encode(src)]), ...vi(3, 220), ...vi(4, 124), ...vi(5, order)])]);
    const proto = ld(2, [...gif("https://tenor.com/a", "https://media.tenor.com/a.mp4", 1), ...gif("https://tenor.com/b", "https://media.tenor.com/b.mp4", 5)]);
    const gifs = decodeFavoriteGifs(btoa(String.fromCharCode(...proto)));
    expect(gifs.map((g) => g.url)).toEqual(["https://tenor.com/b", "https://tenor.com/a"]);
    expect(gifs[0]).toMatchObject({ src: "https://media.tenor.com/b.mp4", width: 220, height: 124, video: true });
  });
});

describe("session host", () => {
  it("forwards friends' presence updates but not guild ones", () => {
    expect(forwardToUi(dispatch("PRESENCE_UPDATE", { user: { id: "sam" }, status: "online" }))).toBe(true);
    expect(forwardToUi(dispatch("PRESENCE_UPDATE", { user: { id: "x" }, guild_id: "g1", status: "online" }))).toBe(false);
    expect(forwardToUi(dispatch("GUILD_MEMBER_LIST_UPDATE", { guild_id: "g1" }))).toBe(true);
    expect(forwardToUi(dispatch("SESSIONS_REPLACE", []))).toBe(false);
  });

  it("replays only the latest presence per friend, and settings changes", () => {
    const gateway = new (class extends Emitter<Record<string, unknown>> {
      status = "ready";
      connect() {}
      close() {}
      resync() {}
    })();
    const host = new SessionHost(gateway as unknown as GatewayClient);
    gateway.emit("dispatch", dispatch("READY", readyWith()));
    gateway.emit("dispatch", dispatch("PRESENCE_UPDATE", { user: { id: "sam" }, status: "idle" }));
    gateway.emit("dispatch", dispatch("PRESENCE_UPDATE", { user: { id: "sam" }, status: "online" }));
    gateway.emit("dispatch", dispatch("PRESENCE_UPDATE", { user: { id: "x" }, guild_id: "g1", status: "online" }));
    gateway.emit("dispatch", dispatch("USER_SETTINGS_PROTO_UPDATE", { settings: { type: 1, proto: encodeStatusSettings("dnd") } }));
    const backlog = host.snapshot().backlog;
    expect(backlog.map((e) => e.t)).toEqual(["USER_SETTINGS_PROTO_UPDATE", "PRESENCE_UPDATE"]);
    expect((backlog[1]!.d as { status: string }).status).toBe("online");
  });
});

describe("multipart bodies", () => {
  it("formats payload_json the way browsers do", () => {
    expect(multipartBody({ payload_json: '{"type":2}' }, "B")).toBe('--B\r\nContent-Disposition: form-data; name="payload_json"\r\n\r\n{"type":2}\r\n--B--\r\n');
  });
});
