import { classifyMention, type MentionContext } from "../mentions.ts";
import { channelPermissions, has, Permission } from "../permissions.ts";
import {
  ChannelType,
  RelationshipType,
  type Channel,
  type GatewayDispatch,
  type Guild,
  type Member,
  type Message,
  type Presence,
  type ReadState,
  type Relationship,
  type Role,
  type ScheduledEvent,
  type User,
  type UserGuildSettings,
  type VoiceState,
} from "../types.ts";
import { decodeUserSettings, type GuildFolder, type StatusSetting } from "../util/proto.ts";
import { applyMemberListOps, memberListId, type MemberList, type MemberListOp } from "./member-list.ts";
import { compareSnowflakes, isNewer } from "../util/snowflake.ts";
import { channelReadStates, entriesOf, normalizeGuild, settingsKey, type RawGuild } from "./normalize.ts";

export interface MessageList {
  /** Oldest first. */
  messages: Message[];
  hasMoreBefore: boolean;
  /** True when showing a window around an older message that doesn't reach the present. */
  hasMoreAfter: boolean;
}

export interface CallState {
  channelId: string;
  messageId?: string;
  ringing: string[];
}

export interface ChannelGroup {
  category: Channel | null;
  channels: Channel[];
}

const MAX_MESSAGES_PER_CHANNEL = 300;
const TYPING_MS = 10_000;
const TEXT_LIKE = new Set<number>([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
  ChannelType.GuildDirectory,
]);
const VOICE_LIKE = new Set<number>([ChannelType.GuildVoice, ChannelType.GuildStageVoice]);
const THREAD_TYPES = new Set<number>([
  ChannelType.AnnouncementThread,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
]);

export function isThread(c: Channel | undefined): boolean {
  return !!c && THREAD_TYPES.has(c.type);
}

export function isPrivate(c: Channel | undefined): boolean {
  return !!c && (c.type === ChannelType.DM || c.type === ChannelType.GroupDM);
}

export function isVoice(c: Channel | undefined): boolean {
  return !!c && VOICE_LIKE.has(c.type);
}

type AnyRecord = Record<string, any>;

/**
 * Normalized client state, built from READY and kept current by gateway dispatches.
 * UI code subscribes to string keys ("guilds", "dms", "messages:<id>", ...) and reads
 * the maps directly; notifications are batched per microtask.
 */
export class Store {
  me: User | null = null;
  ready = false;
  readonly users = new Map<string, User>();
  readonly guilds = new Map<string, Guild>();
  readonly channels = new Map<string, Channel>();
  readonly guildChannelIds = new Map<string, Set<string>>();
  readonly privateChannelIds = new Set<string>();
  readonly myMembers = new Map<string, Member>();
  readonly readStates = new Map<string, ReadState>();
  readonly guildSettings = new Map<string, UserGuildSettings>();
  readonly relationships = new Map<string, Relationship>();
  readonly events = new Map<string, ScheduledEvent>();
  readonly myRsvps = new Set<string>();
  readonly messages = new Map<string, MessageList>();
  readonly calls = new Map<string, CallState>();
  readonly typing = new Map<string, Map<string, number>>();
  /** Other people's server profiles (nickname, roles) as far as we've seen them. */
  readonly memberCache = new Map<string, Map<string, Member>>();
  /** channelId -> userId -> voice state, for guild voice channels. */
  readonly voiceStates = new Map<string, Map<string, VoiceState>>();
  /** The user's server folders from Discord's settings (gives the server order). */
  guildFolders: GuildFolder[] = [];
  /** Your own status and custom status, from Discord's settings. */
  ownStatus: StatusSetting = {};
  /** The gateway session (interactions need it). */
  sessionId: string | null = null;
  /** Friends' presences, plus anyone seen in a member list. */
  readonly presences = new Map<string, Presence>();
  /** `${guildId}:${listId}` -> member sidebar. */
  readonly memberLists = new Map<string, MemberList>();
  #voiceChannelOf = new Map<string, string>();
  #listForChannel = new Map<string, string>();
  #awaitingList = new Map<string, string>();

  #versions = new Map<string, number>();
  #listeners = new Map<string, Set<() => void>>();
  #dirty = new Set<string>();
  #flushScheduled = false;

  // ---- subscriptions -------------------------------------------------------

  subscribe(keys: string | string[], fn: () => void): () => void {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) {
      let set = this.#listeners.get(key);
      if (!set) this.#listeners.set(key, (set = new Set()));
      set.add(fn);
    }
    return () => {
      for (const key of list) this.#listeners.get(key)?.delete(fn);
    };
  }

  version(key: string): number {
    return this.#versions.get(key) ?? 0;
  }

  touch(...keys: string[]): void {
    for (const key of keys) {
      this.#versions.set(key, (this.#versions.get(key) ?? 0) + 1);
      this.#dirty.add(key);
    }
    this.#versions.set("*", (this.#versions.get("*") ?? 0) + 1);
    this.#dirty.add("*");
    if (!this.#flushScheduled) {
      this.#flushScheduled = true;
      queueMicrotask(() => this.#flush());
    }
  }

  #flush(): void {
    this.#flushScheduled = false;
    const keys = [...this.#dirty];
    this.#dirty.clear();
    const called = new Set<() => void>();
    for (const key of keys) {
      for (const fn of this.#listeners.get(key) ?? []) {
        if (!called.has(fn)) {
          called.add(fn);
          fn();
        }
      }
    }
  }

  // ---- hydration -----------------------------------------------------------

  hydrate(ready: AnyRecord, supplemental?: AnyRecord): void {
    this.users.clear();
    this.guilds.clear();
    this.channels.clear();
    this.guildChannelIds.clear();
    this.privateChannelIds.clear();
    this.myMembers.clear();
    this.readStates.clear();
    this.guildSettings.clear();
    this.relationships.clear();
    this.events.clear();
    this.calls.clear();
    this.typing.clear();
    this.memberCache.clear();
    this.voiceStates.clear();
    this.#voiceChannelOf.clear();
    this.presences.clear();
    this.memberLists.clear();
    this.#listForChannel.clear();
    this.#awaitingList.clear();

    this.me = ready.user as User;
    this.sessionId = typeof ready.session_id === "string" ? ready.session_id : null;
    this.users.set(this.me.id, this.me);
    for (const u of (ready.users ?? []) as User[]) this.users.set(u.id, u);

    const rawGuilds = (ready.guilds ?? []) as RawGuild[];
    const merged = (ready.merged_members ?? []) as Member[][];
    rawGuilds.forEach((raw, i) => {
      if (raw.unavailable) return;
      this.#addGuild(raw);
      for (const m of merged[i] ?? []) this.#rememberMember(raw.id, m);
      const mine = merged[i]?.find((m) => (m.user_id ?? m.user?.id) === this.me!.id);
      if (mine) this.myMembers.set(raw.id, mine);
      for (const vs of (raw as { voice_states?: VoiceState[] }).voice_states ?? []) this.#setVoiceState({ ...vs, guild_id: raw.id });
    });

    for (const pc of (ready.private_channels ?? []) as Channel[]) this.#addPrivateChannel(pc);
    for (const rs of channelReadStates(ready.read_state)) this.readStates.set(rs.id, rs);
    for (const s of entriesOf<UserGuildSettings>(ready.user_guild_settings)) {
      this.guildSettings.set(settingsKey(s.guild_id), s);
    }
    for (const r of (ready.relationships ?? []) as Relationship[]) this.#addRelationship(r);
    const settings = typeof ready.user_settings_proto === "string" ? decodeUserSettings(ready.user_settings_proto) : null;
    this.guildFolders = settings?.guildFolders ?? [];
    this.ownStatus = settings?.status ?? {};
    this.#applyPresences(ready.merged_presences, ready.presences);

    if (supplemental) this.applySupplemental(supplemental);
    this.ready = true;
    this.touch("me", "guilds", "dms", "channels", "readstates", "settings", "relationships", "events", "calls");
  }

  applySupplemental(supplemental: AnyRecord): void {
    for (const pc of (supplemental.lazy_private_channels ?? []) as Channel[]) this.#addPrivateChannel(pc);
    const guilds = (supplemental.guilds ?? []) as { id: string; voice_states?: VoiceState[] }[];
    const merged = (supplemental.merged_members ?? []) as Member[][];
    guilds.forEach((g, i) => {
      for (const m of merged[i] ?? []) this.#rememberMember(g.id, m);
      for (const vs of g.voice_states ?? []) this.#setVoiceState({ ...vs, guild_id: g.id });
    });
    this.#applyPresences(supplemental.merged_presences);
    this.touch("dms", "voice", "presences");
  }

  #applyPresences(merged: unknown, flat?: unknown): void {
    const m = (merged ?? {}) as { friends?: AnyRecord[]; guilds?: AnyRecord[][] };
    for (const p of m.friends ?? []) this.#setPresence(p);
    for (const list of m.guilds ?? []) for (const p of list ?? []) this.#setPresence(p);
    if (Array.isArray(flat)) for (const p of flat as AnyRecord[]) this.#setPresence(p);
  }

  #setPresence(p: AnyRecord | undefined): void {
    const userId = p?.user?.id ?? p?.user_id;
    if (!userId || !p?.status) return;
    this.presences.set(userId, { status: p.status, activities: p.activities ?? [], ...(p.client_status ? { client_status: p.client_status } : {}) });
  }

  #onMemberList(d: AnyRecord): void {
    const guildId = d.guild_id as string;
    const key = `${guildId}:${d.id}`;
    let list = this.memberLists.get(key);
    if (!list) this.memberLists.set(key, (list = { id: String(d.id), guildId, items: [], groups: [], memberCount: 0, onlineCount: 0 }));
    const ops = (d.ops ?? []) as MemberListOp[];
    applyMemberListOps(list, ops);
    list.groups = d.groups ?? list.groups;
    list.memberCount = d.member_count ?? list.memberCount;
    list.onlineCount = d.online_count ?? list.onlineCount;
    for (const op of ops) {
      for (const item of op.items ?? (op.item ? [op.item] : [])) {
        if (!("member" in item)) continue;
        this.#rememberMember(guildId, item.member);
        if (item.member.presence) this.#setPresence({ ...item.member.presence, user_id: item.member.user?.id ?? item.member.user_id });
      }
    }
    // The first SYNC after asking for a channel's list tells us which list that channel uses.
    const waiting = this.#awaitingList.get(guildId);
    if (waiting && ops.some((o) => o.op === "SYNC")) {
      this.#listForChannel.set(waiting, list.id);
      this.#awaitingList.delete(guildId);
    }
    this.touch(`memberlist:${guildId}`, "presences");
  }

  #rememberMember(guildId: string, member: Member): void {
    const userId = member.user_id ?? member.user?.id;
    if (!userId || !guildId) return;
    if (member.user) this.users.set(userId, { ...this.users.get(userId), ...member.user });
    let map = this.memberCache.get(guildId);
    if (!map) this.memberCache.set(guildId, (map = new Map()));
    map.set(userId, { ...map.get(userId), ...member, user_id: userId });
  }

  #setVoiceState(vs: VoiceState): void {
    if (!vs.guild_id || !vs.user_id) return;
    const key = `${vs.guild_id}:${vs.user_id}`;
    const previous = this.#voiceChannelOf.get(key);
    if (previous) this.voiceStates.get(previous)?.delete(vs.user_id);
    if (vs.member) this.#rememberMember(vs.guild_id, vs.member);
    if (vs.channel_id) {
      let map = this.voiceStates.get(vs.channel_id);
      if (!map) this.voiceStates.set(vs.channel_id, (map = new Map()));
      map.set(vs.user_id, vs);
      this.#voiceChannelOf.set(key, vs.channel_id);
    } else {
      this.#voiceChannelOf.delete(key);
    }
  }

  #addGuild(raw: RawGuild): void {
    const { guild, channels, threads, events } = normalizeGuild(raw);
    this.guilds.set(guild.id, guild);
    const ids = new Set<string>();
    for (const c of [...channels, ...threads]) {
      this.channels.set(c.id, c);
      ids.add(c.id);
    }
    this.guildChannelIds.set(guild.id, ids);
    for (const e of events) this.events.set(e.id, e);
    const mine = raw.members?.find((m) => (m.user_id ?? m.user?.id) === this.me?.id);
    if (mine) this.myMembers.set(guild.id, mine);
  }

  #removeGuild(guildId: string): void {
    for (const id of this.guildChannelIds.get(guildId) ?? []) {
      this.channels.delete(id);
      this.messages.delete(id);
    }
    this.guildChannelIds.delete(guildId);
    this.guilds.delete(guildId);
    this.myMembers.delete(guildId);
    for (const [id, e] of this.events) if (e.guild_id === guildId) this.events.delete(id);
  }

  #addPrivateChannel(raw: Channel): void {
    const channel: Channel = { ...raw };
    if (raw.recipients) {
      for (const u of raw.recipients) this.users.set(u.id, u);
      channel.recipient_ids = raw.recipients.map((u) => u.id);
      delete channel.recipients;
    }
    this.channels.set(channel.id, channel);
    this.privateChannelIds.add(channel.id);
  }

  #addRelationship(raw: Relationship): void {
    if (raw.user) this.users.set(raw.user.id, raw.user);
    this.relationships.set(raw.id, { ...raw, user_id: raw.user_id ?? raw.user?.id ?? raw.id });
  }

  #upsertChannel(raw: Channel): void {
    if (isPrivate(raw)) {
      this.#addPrivateChannel(raw);
      this.touch("dms", `channel:${raw.id}`);
      return;
    }
    const existing = this.channels.get(raw.id);
    const channel = { ...existing, ...raw };
    this.channels.set(channel.id, channel);
    if (channel.guild_id) {
      let ids = this.guildChannelIds.get(channel.guild_id);
      if (!ids) this.guildChannelIds.set(channel.guild_id, (ids = new Set()));
      ids.add(channel.id);
      this.touch(`channels:${channel.guild_id}`);
    }
    this.touch(`channel:${channel.id}`, "channels");
  }

  #deleteChannel(raw: Channel): void {
    this.channels.delete(raw.id);
    this.messages.delete(raw.id);
    this.privateChannelIds.delete(raw.id);
    if (raw.guild_id) {
      this.guildChannelIds.get(raw.guild_id)?.delete(raw.id);
      this.touch(`channels:${raw.guild_id}`);
    }
    this.touch("dms", "channels", `channel:${raw.id}`);
  }

  // ---- dispatch ------------------------------------------------------------

  apply(event: GatewayDispatch): void {
    const d = event.d as AnyRecord;
    switch (event.t) {
      case "READY":
        this.hydrate(d);
        break;
      case "READY_SUPPLEMENTAL":
        this.applySupplemental(d);
        break;
      case "USER_UPDATE":
        if (this.me && d.id === this.me.id) {
          this.me = { ...this.me, ...(d as User) };
          this.users.set(this.me.id, this.me);
          this.touch("me");
        }
        break;

      case "GUILD_CREATE":
        if (!d.unavailable) {
          this.#addGuild(d as RawGuild);
          this.touch("guilds", `guild:${d.id}`, `channels:${d.id}`, "events");
        }
        break;
      case "GUILD_UPDATE": {
        const existing = this.guilds.get(d.id);
        if (existing) {
          const { guild } = normalizeGuild({ ...existing, ...d } as RawGuild);
          this.guilds.set(d.id, { ...guild, roles: d.roles ?? existing.roles });
          this.touch("guilds", `guild:${d.id}`);
        }
        break;
      }
      case "GUILD_DELETE":
        if (!d.unavailable) {
          this.#removeGuild(d.id);
          this.touch("guilds", `guild:${d.id}`, "events");
        }
        break;
      case "GUILD_ROLE_CREATE":
      case "GUILD_ROLE_UPDATE": {
        const guild = this.guilds.get(d.guild_id);
        if (guild) {
          const role = d.role as Role;
          guild.roles = [...guild.roles.filter((r) => r.id !== role.id), role];
          this.touch(`guild:${guild.id}`, `channels:${guild.id}`);
        }
        break;
      }
      case "GUILD_ROLE_DELETE": {
        const guild = this.guilds.get(d.guild_id);
        if (guild) {
          guild.roles = guild.roles.filter((r) => r.id !== d.role_id);
          this.touch(`guild:${guild.id}`, `channels:${guild.id}`);
        }
        break;
      }
      case "GUILD_MEMBERS_CHUNK":
        for (const m of (d.members ?? []) as Member[]) this.#rememberMember(d.guild_id, m);
        this.touch(`members:${d.guild_id}`, "members");
        break;
      case "VOICE_STATE_UPDATE":
        this.#setVoiceState(d as VoiceState);
        this.touch("voice");
        break;
      case "MESSAGE_POLL_VOTE_ADD":
      case "MESSAGE_POLL_VOTE_REMOVE":
        this.#onPollVote(d, event.t === "MESSAGE_POLL_VOTE_ADD" ? 1 : -1);
        break;
      case "CHANNEL_PINS_UPDATE": {
        const pinned = this.channels.get(d.channel_id);
        if (pinned) pinned.last_pin_timestamp = d.last_pin_timestamp ?? null;
        this.touch(`pins:${d.channel_id}`);
        break;
      }
      case "GUILD_MEMBER_UPDATE":
        this.#rememberMember(d.guild_id, d as Member);
        this.touch(`members:${d.guild_id}`, "members");
        if (this.me && (d.user?.id ?? d.user_id) === this.me.id) {
          this.myMembers.set(d.guild_id, { ...this.myMembers.get(d.guild_id), ...(d as Member) });
          this.touch(`guild:${d.guild_id}`, `channels:${d.guild_id}`);
        }
        break;

      case "CHANNEL_CREATE":
      case "CHANNEL_UPDATE":
      case "THREAD_CREATE":
      case "THREAD_UPDATE":
        this.#upsertChannel(d as Channel);
        break;
      case "CHANNEL_DELETE":
      case "THREAD_DELETE":
        this.#deleteChannel(d as Channel);
        break;
      case "THREAD_LIST_SYNC":
        for (const t of (d.threads ?? []) as Channel[]) this.#upsertChannel({ ...t, guild_id: d.guild_id });
        break;
      case "CHANNEL_UNREAD_UPDATE":
        for (const u of (d.channel_unread_updates ?? []) as AnyRecord[]) this.#bumpLastMessage(u.id, u.last_message_id);
        break;
      case "PASSIVE_UPDATE_V1":
      case "PASSIVE_UPDATE_V2":
        for (const u of (d.channels ?? d.updated_channels ?? []) as AnyRecord[]) {
          this.#bumpLastMessage(u.id, u.last_message_id);
        }
        for (const m of (d.updated_members ?? d.members ?? []) as Member[]) this.#rememberMember(d.guild_id, m);
        for (const vs of (d.updated_voice_states ?? d.voice_states ?? []) as VoiceState[]) this.#setVoiceState({ ...vs, guild_id: d.guild_id });
        for (const userId of (d.removed_voice_states ?? []) as string[]) this.#setVoiceState({ user_id: userId, channel_id: null, guild_id: d.guild_id });
        this.touch("voice");
        break;
      case "MINICORD_CHANNEL_LAST_MESSAGES":
        for (const [channelId, messageId] of Object.entries(d as Record<string, string>)) {
          this.#bumpLastMessage(channelId, messageId);
        }
        break;

      case "MESSAGE_CREATE":
        this.#onMessageCreate(d as Message);
        break;
      case "MESSAGE_UPDATE":
        this.#patchMessage(d.channel_id, d.id, (m) => ({ ...m, ...(d as Partial<Message>) }));
        break;
      case "MESSAGE_DELETE":
        this.#removeMessages(d.channel_id, [d.id]);
        break;
      case "MESSAGE_DELETE_BULK":
        this.#removeMessages(d.channel_id, d.ids ?? []);
        break;
      case "MESSAGE_REACTION_ADD":
      case "MESSAGE_REACTION_REMOVE":
        this.#onReaction(d, event.t === "MESSAGE_REACTION_ADD" ? 1 : -1);
        break;
      case "MESSAGE_REACTION_REMOVE_ALL":
        this.#patchMessage(d.channel_id, d.message_id, (m) => ({ ...m, reactions: [] }));
        break;
      case "MESSAGE_REACTION_REMOVE_EMOJI":
        this.#patchMessage(d.channel_id, d.message_id, (m) => ({
          ...m,
          reactions: (m.reactions ?? []).filter((r) => !sameEmoji(r.emoji, d.emoji)),
        }));
        break;
      case "MESSAGE_ACK":
        this.readStates.set(d.channel_id, {
          ...this.readStates.get(d.channel_id),
          id: d.channel_id,
          last_message_id: d.message_id,
          mention_count: d.mention_count ?? 0,
        });
        this.touch("readstates", `channel:${d.channel_id}`);
        break;

      case "USER_SETTINGS_PROTO_UPDATE": {
        if (d.settings?.type !== 1 || typeof d.settings.proto !== "string") break;
        const settings = decodeUserSettings(d.settings.proto);
        if (settings.guildFolders) {
          this.guildFolders = settings.guildFolders;
          this.touch("guilds");
        }
        if (settings.status) {
          this.ownStatus = { ...this.ownStatus, ...settings.status };
          this.touch("me", "presences");
        }
        break;
      }
      case "PRESENCE_UPDATE":
        this.#setPresence(d);
        this.touch("presences");
        break;
      case "GUILD_MEMBER_LIST_UPDATE":
        this.#onMemberList(d);
        break;

      case "USER_GUILD_SETTINGS_UPDATE":
        this.guildSettings.set(settingsKey(d.guild_id), d as UserGuildSettings);
        this.touch("settings");
        break;

      case "RELATIONSHIP_ADD":
      case "RELATIONSHIP_UPDATE":
        this.#addRelationship({ ...this.relationships.get(d.id), ...(d as Relationship) });
        this.touch("relationships");
        break;
      case "RELATIONSHIP_REMOVE":
        this.relationships.delete(d.id);
        this.touch("relationships");
        break;

      case "GUILD_SCHEDULED_EVENT_CREATE":
      case "GUILD_SCHEDULED_EVENT_UPDATE":
        this.events.set(d.id, { ...this.events.get(d.id), ...(d as ScheduledEvent) });
        this.touch("events");
        break;
      case "GUILD_SCHEDULED_EVENT_DELETE":
        this.events.delete(d.id);
        this.myRsvps.delete(d.id);
        this.touch("events");
        break;
      case "GUILD_SCHEDULED_EVENT_USER_ADD":
      case "GUILD_SCHEDULED_EVENT_USER_REMOVE": {
        const delta = event.t === "GUILD_SCHEDULED_EVENT_USER_ADD" ? 1 : -1;
        const e = this.events.get(d.guild_scheduled_event_id);
        if (e && typeof e.user_count === "number") e.user_count = Math.max(0, e.user_count + delta);
        if (d.user_id === this.me?.id) {
          if (delta > 0) this.myRsvps.add(d.guild_scheduled_event_id);
          else this.myRsvps.delete(d.guild_scheduled_event_id);
        }
        this.touch("events");
        break;
      }

      case "CALL_CREATE":
      case "CALL_UPDATE": {
        // Userdoccers documents `ringing: string[]`; the live client reads `ongoing_rings` (keyed by user id).
        const ringing: string[] = Array.isArray(d.ringing)
          ? d.ringing
          : d.ongoing_rings
            ? Object.keys(d.ongoing_rings)
            : [];
        this.calls.set(d.channel_id, { channelId: d.channel_id, messageId: d.message_id, ringing });
        this.touch("calls");
        break;
      }
      case "CALL_DELETE":
        this.calls.delete(d.channel_id);
        this.touch("calls");
        break;

      case "TYPING_START": {
        if (d.guild_id || d.user_id === this.me?.id) break; // typing is only shown in DMs
        let map = this.typing.get(d.channel_id);
        if (!map) this.typing.set(d.channel_id, (map = new Map()));
        map.set(d.user_id, Date.now() + TYPING_MS);
        this.touch(`typing:${d.channel_id}`);
        break;
      }
    }
  }

  #bumpLastMessage(channelId: string, messageId: string | null | undefined): void {
    const channel = this.channels.get(channelId);
    if (!channel || !messageId || !isNewer(messageId, channel.last_message_id)) return;
    channel.last_message_id = messageId;
    this.touch(`channel:${channelId}`, channel.guild_id ? `channels:${channel.guild_id}` : "dms");
  }

  #onMessageCreate(msg: Message): void {
    if (msg.author) this.users.set(msg.author.id, { ...this.users.get(msg.author.id), ...msg.author });
    if (msg.member && msg.guild_id && msg.author) this.#rememberMember(msg.guild_id, { ...msg.member, user: msg.author });
    this.#bumpLastMessage(msg.channel_id, msg.id);
    this.typing.get(msg.channel_id)?.delete(msg.author?.id);

    if (msg.author?.id === this.me?.id) {
      // Sending a message marks the channel read up to it.
      this.readStates.set(msg.channel_id, { id: msg.channel_id, last_message_id: msg.id, mention_count: 0 });
      this.touch("readstates");
    } else if (this.me && classifyMention(msg, this.mentionContext())?.pings) {
      const rs = this.readStates.get(msg.channel_id) ?? { id: msg.channel_id, mention_count: 0 };
      this.readStates.set(msg.channel_id, { ...rs, mention_count: (rs.mention_count ?? 0) + 1 });
      this.touch("readstates");
    }

    const list = this.messages.get(msg.channel_id);
    if (list && !list.hasMoreAfter) {
      const pendingIdx = msg.nonce ? list.messages.findIndex((m) => m.nonce === msg.nonce && m.id.startsWith("pending-")) : -1;
      if (pendingIdx >= 0) list.messages.splice(pendingIdx, 1, msg);
      else if (!list.messages.some((m) => m.id === msg.id)) list.messages.push(msg);
      if (list.messages.length > MAX_MESSAGES_PER_CHANNEL) {
        list.messages.splice(0, list.messages.length - MAX_MESSAGES_PER_CHANNEL);
        list.hasMoreBefore = true;
      }
      this.touch(`messages:${msg.channel_id}`);
    }
    this.touch(`typing:${msg.channel_id}`);
  }

  #patchMessage(channelId: string, messageId: string, fn: (m: Message) => Message): void {
    const list = this.messages.get(channelId);
    const idx = list?.messages.findIndex((m) => m.id === messageId) ?? -1;
    if (!list || idx < 0) return;
    list.messages[idx] = fn(list.messages[idx]!);
    this.touch(`messages:${channelId}`);
  }

  #removeMessages(channelId: string, ids: string[]): void {
    const list = this.messages.get(channelId);
    if (!list) return;
    const drop = new Set(ids);
    list.messages = list.messages.filter((m) => !drop.has(m.id));
    this.touch(`messages:${channelId}`);
  }

  #onPollVote(d: AnyRecord, delta: 1 | -1): void {
    const mine = d.user_id === this.me?.id;
    this.#patchMessage(d.channel_id, d.message_id, (m) => {
      if (!m.poll) return m;
      const counts = [...(m.poll.results?.answer_counts ?? [])];
      const idx = counts.findIndex((c) => c.id === d.answer_id);
      if (idx < 0) {
        if (delta > 0) counts.push({ id: d.answer_id, count: 1, me_voted: mine });
      } else {
        const c = counts[idx]!;
        counts[idx] = { ...c, count: Math.max(0, c.count + delta), me_voted: mine ? delta > 0 : c.me_voted };
      }
      return { ...m, poll: { ...m.poll, results: { is_finalized: m.poll.results?.is_finalized ?? false, answer_counts: counts } } };
    });
  }

  #onReaction(d: AnyRecord, delta: 1 | -1): void {
    const mine = d.user_id === this.me?.id;
    this.#patchMessage(d.channel_id, d.message_id, (m) => {
      const reactions = [...(m.reactions ?? [])];
      const idx = reactions.findIndex((r) => sameEmoji(r.emoji, d.emoji));
      if (idx < 0) {
        if (delta > 0) reactions.push({ emoji: d.emoji, count: 1, me: mine });
      } else {
        const r = reactions[idx]!;
        const count = r.count + delta;
        if (count <= 0) reactions.splice(idx, 1);
        else reactions[idx] = { ...r, count, me: mine ? delta > 0 : r.me };
      }
      return { ...m, reactions };
    });
  }

  // ---- REST-fed data -------------------------------------------------------

  /** Store a page from GET /channels/{id}/messages (API returns newest first). */
  setMessagePage(channelId: string, page: Message[], mode: "latest" | "before" | "around", limit: number): void {
    const asc = [...page].sort((a, b) => compareSnowflakes(a.id, b.id));
    const existing = this.messages.get(channelId);
    if (mode === "before" && existing) {
      const known = new Set(existing.messages.map((m) => m.id));
      existing.messages = [...asc.filter((m) => !known.has(m.id)), ...existing.messages];
      existing.hasMoreBefore = page.length >= limit;
    } else {
      const channel = this.channels.get(channelId);
      const reachesPresent =
        mode === "latest" || asc.some((m) => m.id === channel?.last_message_id) || !channel?.last_message_id;
      this.messages.set(channelId, {
        messages: asc,
        hasMoreBefore: mode === "around" ? true : page.length >= limit,
        hasMoreAfter: !reachesPresent,
      });
    }
    for (const m of asc) if (m.author) this.users.set(m.author.id, { ...this.users.get(m.author.id), ...m.author });
    this.touch(`messages:${channelId}`);
  }

  addPendingMessage(msg: Message): void {
    const list = this.messages.get(msg.channel_id);
    if (!list) return;
    list.messages.push(msg);
    this.touch(`messages:${msg.channel_id}`);
  }

  removePendingMessage(channelId: string, nonce: string): void {
    const list = this.messages.get(channelId);
    if (!list) return;
    list.messages = list.messages.filter((m) => !(m.nonce === nonce && m.id.startsWith("pending-")));
    this.touch(`messages:${channelId}`);
  }

  /** Threads/posts fetched over REST (forum browsing) join the channel map. */
  upsertChannels(channels: Channel[]): void {
    for (const c of channels) {
      this.channels.set(c.id, { ...this.channels.get(c.id), ...c });
      if (c.guild_id) {
        let ids = this.guildChannelIds.get(c.guild_id);
        if (!ids) this.guildChannelIds.set(c.guild_id, (ids = new Set()));
        ids.add(c.id);
      }
    }
    this.touch("channels");
  }

  /** Called when the UI asks for a channel's member list, so the answering SYNC can be matched to it. */
  expectMemberList(guildId: string, channelId: string): void {
    this.#awaitingList.set(guildId, channelId);
  }

  memberListFor(channel: Channel): MemberList | undefined {
    if (!channel.guild_id) return undefined;
    const id = this.#listForChannel.get(channel.id) ?? memberListId(channel);
    return this.memberLists.get(`${channel.guild_id}:${id}`);
  }

  presenceOf(userId: string): Presence | undefined {
    return this.presences.get(userId);
  }

  /** Remove a message locally (dismissing an ephemeral bot reply). */
  dismissMessage(channelId: string, messageId: string): void {
    this.#removeMessages(channelId, [messageId]);
  }

  rememberMembers(guildId: string, members: Member[]): void {
    for (const m of members) this.#rememberMember(guildId, m);
    this.touch(`members:${guildId}`, "members");
  }

  setRsvps(eventIds: Iterable<string>): void {
    this.myRsvps.clear();
    for (const id of eventIds) this.myRsvps.add(id);
    this.touch("events");
  }

  upsertEvents(events: ScheduledEvent[]): void {
    for (const e of events) this.events.set(e.id, { ...this.events.get(e.id), ...e });
    this.touch("events");
  }

  markRead(channelId: string, messageId: string): void {
    this.readStates.set(channelId, { ...this.readStates.get(channelId), id: channelId, last_message_id: messageId, mention_count: 0 });
    this.touch("readstates", `channel:${channelId}`);
  }

  // ---- queries -------------------------------------------------------------

  mentionContext(): MentionContext {
    const meId = this.me?.id ?? "";
    return {
      meId,
      myRoleIds: (guildId) => this.myMembers.get(guildId)?.roles ?? [],
      guildSettings: (guildId) => this.guildSettings.get(guildId),
    };
  }

  /** Servers in the user's Discord order (folders flattened); servers missing from it come first, like Discord. */
  sortedGuilds(): Guild[] {
    const order = new Map<string, number>();
    for (const folder of this.guildFolders) for (const id of folder.guildIds) if (!order.has(id)) order.set(id, order.size);
    return [...this.guilds.values()].sort((a, b) => {
      const x = order.get(a.id);
      const y = order.get(b.id);
      if (x !== undefined && y !== undefined) return x - y;
      if (x !== undefined) return 1;
      if (y !== undefined) return -1;
      return a.name.localeCompare(b.name);
    });
  }

  permissionsFor(channel: Channel): bigint {
    if (!channel.guild_id || !this.me) return (1n << 64n) - 1n;
    const guild = this.guilds.get(channel.guild_id);
    if (!guild) return 0n;
    const source = isThread(channel) && channel.parent_id ? (this.channels.get(channel.parent_id) ?? channel) : channel;
    return channelPermissions(guild, source, this.myMembers.get(guild.id), this.me.id);
  }

  canView(channel: Channel): boolean {
    return has(this.permissionsFor(channel), Permission.ViewChannel);
  }

  can(channel: Channel, permission: bigint): boolean {
    return has(this.permissionsFor(channel), permission);
  }

  canSend(channel: Channel): boolean {
    const perms = this.permissionsFor(channel);
    return has(perms, isThread(channel) ? Permission.SendMessagesInThreads : Permission.SendMessages);
  }

  /** Visible channels of a guild, grouped under categories in Discord's order. Threads excluded. */
  guildChannelGroups(guildId: string): ChannelGroup[] {
    const all = [...(this.guildChannelIds.get(guildId) ?? [])]
      .map((id) => this.channels.get(id)!)
      .filter((c) => c && !isThread(c));
    const byPosition = (a: Channel, b: Channel) =>
      (a.position ?? 0) - (b.position ?? 0) || compareSnowflakes(a.id, b.id);
    const order = (a: Channel, b: Channel) =>
      Number(VOICE_LIKE.has(a.type)) - Number(VOICE_LIKE.has(b.type)) || byPosition(a, b);
    const visible = all.filter(
      (c) => c.type !== ChannelType.GuildCategory && (TEXT_LIKE.has(c.type) || VOICE_LIKE.has(c.type)) && this.canView(c),
    );
    const categories = all.filter((c) => c.type === ChannelType.GuildCategory).sort(byPosition);
    const groups: ChannelGroup[] = [{ category: null, channels: visible.filter((c) => !c.parent_id).sort(order) }];
    for (const category of categories) {
      const channels = visible.filter((c) => c.parent_id === category.id).sort(order);
      if (channels.length) groups.push({ category, channels });
    }
    return groups.filter((g) => g.channels.length > 0);
  }

  /** Active threads the user can see under a channel. */
  threadsOf(channelId: string): Channel[] {
    const parent = this.channels.get(channelId);
    if (!parent?.guild_id) return [];
    return [...(this.guildChannelIds.get(parent.guild_id) ?? [])]
      .map((id) => this.channels.get(id)!)
      .filter((c) => c && c.parent_id === channelId && isThread(c) && !c.thread_metadata?.archived)
      .sort((a, b) => compareSnowflakes(b.last_message_id ?? b.id, a.last_message_id ?? a.id));
  }

  dmChannels(): Channel[] {
    return [...this.privateChannelIds]
      .map((id) => this.channels.get(id)!)
      .filter(Boolean)
      .sort((a, b) => compareSnowflakes(b.last_message_id ?? b.id, a.last_message_id ?? a.id));
  }

  recipients(channel: Channel): User[] {
    return (channel.recipient_ids ?? []).map((id) => this.users.get(id)).filter((u): u is User => !!u);
  }

  userName(user: User | undefined): string {
    if (!user) return "Unknown";
    const rel = this.relationships.get(user.id);
    return rel?.nickname || user.global_name || user.username;
  }

  memberOf(guildId: string | undefined, userId: string): Member | undefined {
    return guildId ? this.memberCache.get(guildId)?.get(userId) : undefined;
  }

  /** Server nickname, then friend nickname, then global name, then username (like Discord). */
  displayName(userId: string, guildId?: string): string {
    const nick = this.memberOf(guildId, userId)?.nick;
    return nick || this.userName(this.users.get(userId));
  }

  authorName(msg: Message): string {
    const guildId = msg.guild_id ?? this.channels.get(msg.channel_id)?.guild_id;
    return msg.member?.nick || this.memberOf(guildId, msg.author.id)?.nick || this.userName(this.users.get(msg.author.id) ?? msg.author);
  }

  /** The member's highest coloured role as a CSS colour (Discord's name colour). */
  roleColor(guildId: string | undefined, userId: string, member?: Member): string | undefined {
    const guild = guildId ? this.guilds.get(guildId) : undefined;
    const roles = (member ?? this.memberOf(guildId, userId))?.roles;
    if (!guild || !roles?.length) return undefined;
    let best: Role | undefined;
    for (const role of guild.roles) {
      const color = role.colors?.primary_color ?? role.color ?? 0;
      if (color && roles.includes(role.id) && (!best || role.position > best.position)) best = role;
    }
    const color = best ? (best.colors?.primary_color ?? best.color ?? 0) : 0;
    return color ? `#${color.toString(16).padStart(6, "0")}` : undefined;
  }

  voiceIn(channelId: string): VoiceState[] {
    return [...(this.voiceStates.get(channelId)?.values() ?? [])];
  }

  channelName(channel: Channel | undefined): string {
    if (!channel) return "unknown";
    if (channel.type === ChannelType.DM) return this.userName(this.recipients(channel)[0]);
    if (channel.type === ChannelType.GroupDM) {
      return channel.name || this.recipients(channel).map((u) => this.userName(u)).join(", ") || "Group";
    }
    return channel.name ?? "unknown";
  }

  isUnread(channelId: string): boolean {
    const channel = this.channels.get(channelId);
    if (!channel?.last_message_id) return false;
    const rs = this.readStates.get(channelId);
    return !rs?.last_message_id || isNewer(channel.last_message_id, String(rs.last_message_id));
  }

  mentionCount(channelId: string): number {
    return this.readStates.get(channelId)?.mention_count ?? 0;
  }

  /** Discord's server indicators: any unmuted unread text channel, and total mention count. */
  guildUnread(guildId: string): { unread: boolean; mentions: number } {
    let unread = false;
    let mentions = 0;
    for (const id of this.guildChannelIds.get(guildId) ?? []) {
      const c = this.channels.get(id);
      if (!c || !TEXT_LIKE.has(c.type) || isThread(c)) continue;
      const count = this.mentionCount(id);
      const maybeUnread = !unread && this.isUnread(id);
      if ((!count && !maybeUnread) || !this.canView(c)) continue;
      mentions += count;
      if (maybeUnread && !this.mutedByDiscord(c)) unread = true;
    }
    return { unread, mentions };
  }

  unreadDms(): Channel[] {
    return this.dmChannels().filter((c) => this.isUnread(c.id) && !this.mutedByDiscord(c));
  }

  isBlocked(userId: string): boolean {
    return this.relationships.get(userId)?.type === RelationshipType.Blocked;
  }

  friends(): User[] {
    return [...this.relationships.values()]
      .filter((r) => r.type === RelationshipType.Friend)
      .map((r) => this.users.get(r.user_id ?? r.id))
      .filter((u): u is User => !!u)
      .sort((a, b) => this.userName(a).localeCompare(this.userName(b)));
  }

  /** Muted in Discord's own settings (guild, category, channel, or DM). */
  mutedByDiscord(channel: Channel): boolean {
    const settings = this.guildSettings.get(settingsKey(channel.guild_id ?? null));
    if (!settings) return false;
    const now = Date.now();
    const active = (muted: boolean, config?: { end_time: string | null } | null) =>
      muted && (!config?.end_time || Date.parse(config.end_time) > now);
    if (channel.guild_id && active(settings.muted, settings.mute_config)) return true;
    const ids = [channel.id, channel.parent_id, channel.parent_id ? this.channels.get(channel.parent_id)?.parent_id : null];
    return settings.channel_overrides.some((o) => ids.includes(o.channel_id) && active(o.muted, o.mute_config));
  }

  /** Discord's effective notification level for a channel (channel override → category → guild). */
  notificationLevel(channel: Channel): number {
    const settings = this.guildSettings.get(settingsKey(channel.guild_id ?? null));
    const overrides = settings?.channel_overrides ?? [];
    for (const id of [channel.id, channel.parent_id]) {
      const o = overrides.find((x) => x.channel_id === id);
      if (o && o.message_notifications !== 3) return o.message_notifications;
    }
    return settings?.message_notifications ?? 1;
  }

  messagesOf(channelId: string): MessageList | undefined {
    return this.messages.get(channelId);
  }

  typingIn(channelId: string, now = Date.now()): User[] {
    const map = this.typing.get(channelId);
    if (!map) return [];
    return [...map.entries()]
      .filter(([, until]) => until > now)
      .map(([id]) => this.users.get(id))
      .filter((u): u is User => !!u);
  }
}

function sameEmoji(a: { id?: string | null; name?: string | null }, b: { id?: string | null; name?: string | null }): boolean {
  return a.id ? a.id === b.id : a.name === b.name;
}
