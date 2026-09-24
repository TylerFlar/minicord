import { contextProperties } from "../properties.ts";
import type { Channel, CommandIndex, Emoji, Message, ScheduledEvent, UserGuildSettings, UserProfile } from "../types.ts";
import { DISCORD_EPOCH, makeNonce } from "../util/snowflake.ts";
import type { Query, RequestOptions } from "./client.ts";

/** Anything that can perform an authenticated request: RestClient.request, or a bridge to it. */
export type RequestFn = <T>(method: string, path: string, opts?: RequestOptions) => Promise<T>;

export interface UploadedAttachment {
  id: string;
  filename: string;
  uploaded_filename: string;
}

export interface SendMessageInput {
  content: string;
  nonce?: string;
  replyTo?: { messageId: string; channelId: string; guildId?: string; ping?: boolean };
  silent?: boolean;
  attachments?: UploadedAttachment[];
  stickerIds?: string[];
}

/** A GIF from Discord's Tenor proxy. `url` is what gets sent; `src` plays (mp4); `preview` is a still. */
export interface GifResult {
  id: string;
  title?: string;
  url: string;
  src: string;
  gif_src?: string;
  preview?: string;
  width: number;
  height: number;
}

export interface GifCategory {
  name: string;
  src: string;
}

export type NewEventInput = { name: string; description?: string; start: number; end?: number } & ({ location: string } | { channelId: string });

export interface ForumPostInput {
  name: string;
  content: string;
  appliedTags?: string[];
  attachments?: UploadedAttachment[];
  autoArchiveMinutes?: number;
}

export interface ThreadSearchResult {
  threads: Channel[];
  first_messages?: Message[];
  has_more?: boolean;
  total_results?: number;
}

export interface RecentMentionsQuery {
  limit?: number;
  before?: string;
  guildId?: string;
  roles?: boolean;
  everyone?: boolean;
}

const CHAT_INPUT_CONTEXT = contextProperties({ location: "chat_input" });

export function encodeEmoji(emoji: Emoji): string {
  return encodeURIComponent(emoji.id ? `${emoji.name}:${emoji.id}` : (emoji.name ?? ""));
}

/** Days since the Discord epoch, as sent in ack `last_viewed`. */
export function lastViewedDays(now = Date.now()): number {
  return Math.floor((now - Number(DISCORD_EPOCH)) / 86_400_000);
}

/** Typed wrappers for the user-API endpoints minicord uses. */
export class DiscordApi {
  readonly #request: RequestFn;

  constructor(request: RequestFn) {
    this.#request = request;
  }

  #get<T>(path: string, query?: Query): Promise<T> {
    return this.#request<T>("GET", path, query ? { query } : {});
  }

  getMessages(channelId: string, opts: { limit?: number; before?: string; after?: string; around?: string } = {}) {
    return this.#get<Message[]>(`/channels/${channelId}/messages`, { limit: opts.limit ?? 50, ...opts });
  }

  sendMessage(channelId: string, input: SendMessageInput): Promise<Message> {
    const body: Record<string, unknown> = {
      content: input.content,
      nonce: input.nonce ?? makeNonce(),
      tts: false,
      flags: input.silent ? 1 << 12 : 0,
    };
    if (input.attachments?.length) body.attachments = input.attachments;
    if (input.stickerIds?.length) body.sticker_ids = input.stickerIds;
    if (input.replyTo) {
      body.message_reference = {
        message_id: input.replyTo.messageId,
        channel_id: input.replyTo.channelId,
        ...(input.replyTo.guildId ? { guild_id: input.replyTo.guildId } : {}),
        fail_if_not_exists: false,
      };
      body.allowed_mentions = { parse: ["users", "roles", "everyone"], replied_user: input.replyTo.ping ?? true };
    }
    return this.#request<Message>("POST", `/channels/${channelId}/messages`, {
      json: body,
      headers: { "X-Context-Properties": CHAT_INPUT_CONTEXT },
    });
  }

  /** Discord's "Forward": a message whose reference has type 1 and no content of its own. */
  forwardMessage(targetChannelId: string, source: { messageId: string; channelId: string; guildId?: string }): Promise<Message> {
    return this.#request<Message>("POST", `/channels/${targetChannelId}/messages`, {
      json: {
        content: "",
        nonce: makeNonce(),
        tts: false,
        flags: 0,
        message_reference: {
          type: 1,
          message_id: source.messageId,
          channel_id: source.channelId,
          ...(source.guildId ? { guild_id: source.guildId } : {}),
        },
      },
    });
  }

  /**
   * Message search, as Discord's search bar does it: a whole server, or one DM/channel.
   * While Discord is still indexing it answers 202 without `messages`.
   */
  searchMessages(scope: { guildId: string } | { channelId: string }, q: { content: string; channelId?: string; offset?: number }) {
    const path = "guildId" in scope ? `/guilds/${scope.guildId}/messages/search` : `/channels/${scope.channelId}/messages/search`;
    return this.#get<{ messages?: (Message & { hit?: boolean })[][]; total_results?: number }>(path, {
      content: q.content,
      ...(q.channelId ? { channel_id: q.channelId } : {}),
      ...(q.offset ? { offset: q.offset } : {}),
    });
  }

  editMessage(channelId: string, messageId: string, content: string): Promise<Message> {
    return this.#request<Message>("PATCH", `/channels/${channelId}/messages/${messageId}`, { json: { content } });
  }

  deleteMessage(channelId: string, messageId: string): Promise<void> {
    return this.#request<void>("DELETE", `/channels/${channelId}/messages/${messageId}`);
  }

  addReaction(channelId: string, messageId: string, emoji: Emoji): Promise<void> {
    return this.#request<void>("PUT", `/channels/${channelId}/messages/${messageId}/reactions/${encodeEmoji(emoji)}/@me`, {
      query: { location: "Message", type: 0 },
    });
  }

  removeReaction(channelId: string, messageId: string, emoji: Emoji): Promise<void> {
    return this.#request<void>("DELETE", `/channels/${channelId}/messages/${messageId}/reactions/${encodeEmoji(emoji)}/0/@me`, {
      query: { location: "Message", burst: false },
    });
  }

  typing(channelId: string): Promise<void> {
    return this.#request<void>("POST", `/channels/${channelId}/typing`);
  }

  /** Mark a channel read up to `messageId`. */
  ack(channelId: string, messageId: string, token: string | null = null): Promise<{ token: string | null }> {
    return this.#request("POST", `/channels/${channelId}/messages/${messageId}/ack`, {
      json: { token, last_viewed: lastViewedDays() },
    });
  }

  recentMentions(q: RecentMentionsQuery = {}): Promise<Message[]> {
    return this.#get<Message[]>("/users/@me/mentions", {
      limit: q.limit ?? 25,
      before: q.before,
      guild_id: q.guildId,
      roles: q.roles ?? true,
      everyone: q.everyone ?? true,
    });
  }

  dismissMention(messageId: string): Promise<void> {
    return this.#request<void>("DELETE", `/users/@me/mentions/${messageId}`);
  }

  scheduledEvents(guildId: string): Promise<ScheduledEvent[]> {
    return this.#get<ScheduledEvent[]>(`/guilds/${guildId}/scheduled-events`, { with_user_count: true });
  }

  /** Events the current user marked Interested in the given guild. */
  myScheduledEvents(guildId: string): Promise<{ guild_scheduled_event_id: string; user_id: string }[]> {
    return this.#get(`/users/@me/scheduled-events`, { guild_ids: guildId });
  }

  /** Somewhere else (a location), or one of the server's voice channels. */
  createScheduledEvent(guildId: string, input: NewEventInput): Promise<ScheduledEvent> {
    const where =
      "location" in input
        ? { entity_type: 3, channel_id: null, entity_metadata: { location: input.location } }
        : { entity_type: 2, channel_id: input.channelId, entity_metadata: null };
    return this.#request<ScheduledEvent>("POST", `/guilds/${guildId}/scheduled-events`, {
      json: {
        name: input.name,
        description: input.description || null,
        privacy_level: 2,
        scheduled_start_time: new Date(input.start).toISOString(),
        scheduled_end_time: input.end ? new Date(input.end).toISOString() : null,
        ...where,
      },
    });
  }

  setEventInterest(guildId: string, eventId: string, interested: boolean): Promise<unknown> {
    const path = `/guilds/${guildId}/scheduled-events/${eventId}/users/@me`;
    return this.#request(interested ? "PUT" : "DELETE", path);
  }

  openDm(userId: string): Promise<Channel> {
    return this.#request<Channel>("POST", "/users/@me/channels", {
      json: { recipients: [userId] },
      headers: { "X-Context-Properties": contextProperties({}) },
    });
  }

  /** Step 1 of Discord's cloud upload: get signed upload URLs for files. */
  requestUploads(channelId: string, files: { filename: string; size: number }[]) {
    return this.#request<{ attachments: { id: number | string; upload_url: string; upload_filename: string }[] }>(
      "POST",
      `/channels/${channelId}/attachments`,
      { json: { files: files.map((f, i) => ({ id: String(i), filename: f.filename, file_size: f.size })) } },
    );
  }

  pins(channelId: string): Promise<Message[]> {
    return this.#get<Message[]>(`/channels/${channelId}/pins`);
  }

  setPinned(channelId: string, messageId: string, pinned: boolean): Promise<void> {
    return this.#request<void>(pinned ? "PUT" : "DELETE", `/channels/${channelId}/pins/${messageId}`);
  }

  /** Mark unread from `messageId` on (the ack points at the message before it). */
  markUnread(channelId: string, beforeMessageId: string, mentionCount = 0): Promise<unknown> {
    return this.#request("POST", `/channels/${channelId}/messages/${beforeMessageId}/ack`, {
      json: { manual: true, mention_count: mentionCount },
    });
  }

  ackBulk(entries: { channelId: string; messageId: string }[]): Promise<void> {
    return this.#request<void>("POST", "/read-states/ack-bulk", {
      json: { read_states: entries.map((e) => ({ channel_id: e.channelId, message_id: e.messageId, read_state_type: 0 })) },
    });
  }

  /** Forum/media posts (the user-account way to list threads). */
  searchThreads(channelId: string, opts: { archived?: boolean; offset?: number; limit?: number } = {}): Promise<ThreadSearchResult> {
    return this.#get<ThreadSearchResult>(`/channels/${channelId}/threads/search`, {
      archived: opts.archived ?? false,
      sort_by: "last_message_time",
      sort_order: "desc",
      limit: opts.limit ?? 25,
      offset: opts.offset ?? 0,
    });
  }

  profile(userId: string, guildId?: string): Promise<UserProfile> {
    return this.#get<UserProfile>(`/users/${userId}/profile`, {
      with_mutual_guilds: false,
      with_mutual_friends: false,
      with_mutual_friends_count: false,
      guild_id: guildId,
    });
  }

  /** Discord's own notification settings (mute server/channel); `guildId` "@me" for DMs. */
  updateGuildSettings(guildId: string, patch: Partial<Omit<UserGuildSettings, "channel_overrides">> & { channel_overrides?: Record<string, unknown> }) {
    return this.#request<UserGuildSettings>("PATCH", `/users/@me/guilds/${guildId}/settings`, { json: patch });
  }

  acceptFriend(userId: string): Promise<void> {
    return this.#request<void>("PUT", `/users/@me/relationships/${userId}`, {
      json: {},
      headers: { "X-Context-Properties": contextProperties({ location: "Friends" }) },
    });
  }

  removeRelationship(userId: string): Promise<void> {
    return this.#request<void>("DELETE", `/users/@me/relationships/${userId}`, {
      headers: { "X-Context-Properties": contextProperties({ location: "Friends" }) },
    });
  }

  votePoll(channelId: string, messageId: string, answerIds: number[]): Promise<void> {
    return this.#request<void>("PUT", `/channels/${channelId}/polls/${messageId}/answers/@me`, { json: { answer_ids: answerIds } });
  }

  /** Slash commands you can run here: a server's index, a DM/channel's index, or your user-installed apps. */
  commandIndex(scope: { guildId: string } | { channelId: string } | "user"): Promise<CommandIndex> {
    const path =
      scope === "user"
        ? "/users/@me/application-command-index"
        : "guildId" in scope
          ? `/guilds/${scope.guildId}/application-command-index`
          : `/channels/${scope.channelId}/application-command-index`;
    return this.#get<CommandIndex>(path);
  }

  /** Run a command, press a button, pick from a menu or submit a modal (sent the way the web client does). */
  interact(payload: Record<string, unknown>): Promise<void> {
    return this.#request<void>("POST", "/interactions", { form: { payload_json: JSON.stringify(payload) } });
  }

  gifTrending(locale = "en-US"): Promise<{ categories: GifCategory[]; gifs: GifResult[] }> {
    return this.#get("/gifs/trending", { provider: "tenor", locale, media_format: "mp4" });
  }

  gifSearch(q: string, locale = "en-US"): Promise<GifResult[]> {
    return this.#get("/gifs/search", { q, provider: "tenor", locale, media_format: "mp4", limit: 50 });
  }

  /** Base64 settings protobuf: 1 = preloaded settings, 2 = frecency (favorite GIFs, emoji usage). */
  settingsProto(type: 1 | 2): Promise<{ settings: string }> {
    return this.#get(`/users/@me/settings-proto/${type}`);
  }

  updateSettingsProto(type: 1 | 2, base64: string): Promise<{ settings: string }> {
    return this.#request("PATCH", `/users/@me/settings-proto/${type}`, { json: { settings: base64 } });
  }

  /** New forum or media post: a thread plus its first message. */
  createForumPost(channelId: string, input: ForumPostInput): Promise<Channel & { message?: Message }> {
    return this.#request("POST", `/channels/${channelId}/threads`, {
      query: { use_nested_fields: true },
      json: {
        name: input.name,
        auto_archive_duration: input.autoArchiveMinutes ?? 4320,
        applied_tags: input.appliedTags ?? [],
        message: { content: input.content, ...(input.attachments?.length ? { attachments: input.attachments } : {}) },
      },
    });
  }

  ringCall(channelId: string, recipients: string[] | null = null): Promise<void> {
    return this.#request<void>("POST", `/channels/${channelId}/call/ring`, { json: { recipients } });
  }
}
