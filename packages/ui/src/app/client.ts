import {
  ChannelType,
  classifyMention,
  decodeFavoriteGifs,
  DiscordApi,
  DiscordApiError,
  encodeStatusSettings,
  eventStart,
  GatewayOp,
  isUpcomingOrLive,
  makeNonce,
  rules as R,
  snowflakeToMs,
  Store,
  type Activity,
  type ApplicationCommand,
  type ButtonComponent,
  type Channel,
  type CommandApplication,
  type Component,
  type Emoji,
  type FavoriteGif,
  type InteractionModal,
  type GatewayDispatch,
  type GatewayStatus,
  type Mention,
  type MentionKind,
  type Message,
  type Platform,
  type ScheduledEvent,
  type SelectComponent,
  type UpdateStatus,
  type UserProfile,
} from "@minicord/core";
import { messagePreview } from "../lib/preview.ts";
import type { Overlay } from "./overlay.ts";
import type { Route } from "./route.ts";
import { Signals } from "./signals.ts";

export interface InboxItem {
  id: string;
  message: Message;
  channelId: string;
  guildId?: string;
  kind: MentionKind;
  pings: boolean;
  at: number;
}

export interface Toast {
  id: string;
  text: string;
  tone: "info" | "warn" | "error";
  action?: { label: string; run: () => void };
}

export type ClientStatus = GatewayStatus | "starting" | "loggedOut";

export type OwnStatus = "online" | "idle" | "dnd" | "invisible";

/** A slash command as the composer offers it (subcommands flattened into their own entries). */
export interface CommandEntry {
  command: ApplicationCommand;
  app?: CommandApplication;
  /** "sub" or "group sub" when this entry is a subcommand. */
  path: string[];
  /** Options of the (sub)command itself. */
  options: ApplicationCommand["options"];
  description: string;
}

/** One option value as typed in the command form. */
export type OptionValue = string | number | boolean;

interface QueuedNotice {
  title: string;
  body: string;
  route: Route;
}

const RULES_KEY = "rules";
const RECENT_EMOJI_KEY = "emoji-recent";
const MEMBER_REQUEST_GAP_MS = 30_000;
const MESSAGE_LINK = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(@me|\d+)\/(\d+)(?:\/(\d+))?/;
const DISMISSED_KEY = "inbox-dismissed";
const REMINDED_KEY = "event-reminders";
const PAGE = 50;
const LARGE_GUILD = 75_000;
const PASS_GRACE_MS = 60_000;
const DAY = 86_400_000;

/**
 * The UI-side brain: owns the replica Store, the rules state, the inbox and the
 * notification policy, and exposes the actions screens call. Screens subscribe
 * to `store` keys (Discord data) and `signals` keys (app state).
 */
export class MinicordClient {
  readonly store = new Store();
  readonly signals = new Signals();
  readonly api: DiscordApi;
  readonly platform: Platform;

  status: ClientStatus = "starting";
  rules: R.RulesState = R.initialRulesState();
  route: Route = { view: "inbox" };
  inbox: InboxItem[] = [];
  toasts: Toast[] = [];
  incomingCall: { channelId: string } | null = null;
  focused = typeof document === "undefined" ? true : document.hasFocus();
  viewingChannelId: string | null = null;
  /** Unsent composer text per channel. */
  readonly drafts = new Map<string, string>();
  overlay: Overlay | null = null;
  recentEmoji: string[] = [];
  /** Message being edited inline (Up arrow in the composer, or "Edit"). */
  editingId: string | null = null;
  appVersion: string | null = null;
  update: UpdateStatus = { state: "idle" };
  /** Where the "New" divider goes per channel: the read position when you opened it. */
  readonly unreadMarker = new Map<string, string>();

  #dismissed = new Map<string, number>();
  #reminded = new Set<string>();
  #digest: QueuedNotice[] = [];
  #digestAt: number | null = null;
  #held: (QueuedNotice & { until: number })[] = [];
  #subscribedGuilds = new Set<string>();
  #countsFetched = new Map<string, number>();
  #ackTimers = new Map<string, ReturnType<typeof setTimeout>>();
  #lastTyping = new Map<string, number>();
  #loading = new Map<string, Promise<void>>();
  #lastChannelInGuild = new Map<string, string>();
  #replaying = false;
  #started = false;
  #memberRequests = new Map<string, { pending: Set<string>; asked: Set<string>; timer?: ReturnType<typeof setTimeout>; lastAt: number }>();
  #manualUnread = new Set<string>();
  #memberSearch = new Map<string, { timer?: ReturnType<typeof setTimeout>; lastAt: number }>();
  #profiles = new Map<string, Promise<UserProfile | null>>();
  #collapsed = new Map<string, boolean>();
  #commandIndexes = new Map<string, { at: number; value: Promise<CommandEntry[]> }>();
  #autocomplete = new Map<string, (choices: { name: string; value: string | number }[]) => void>();
  /** Interactions still waiting for the app: nonce -> what to call it, and the button/menu it came from. */
  #interactions = new Map<string, { label: string; key?: string }>();
  /** `${messageId}:${customId}` for components with an interaction in flight. */
  readonly pendingComponents = new Set<string>();
  #lastMemberSub = "";
  #favoriteGifs: Promise<FavoriteGif[]> | null = null;

  constructor(platform: Platform) {
    this.platform = platform;
    this.api = new DiscordApi((method, path, opts) => platform.session.request(method, path, opts));
  }

  // ---- lifecycle -------------------------------------------------------------

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    const [rules, dismissed, reminded, recent] = await Promise.all([
      this.platform.storage.load<R.RulesState>(RULES_KEY),
      this.platform.storage.load<Record<string, number>>(DISMISSED_KEY),
      this.platform.storage.load<string[]>(REMINDED_KEY),
      this.platform.storage.load<string[]>(RECENT_EMOJI_KEY),
    ]);
    this.recentEmoji = recent ?? [];
    if (rules?.version === 1) this.rules = { ...R.initialRulesState(), ...rules, config: { ...R.DEFAULT_CONFIG, ...rules.config } };
    const cutoff = Date.now() - 14 * DAY;
    for (const [id, at] of Object.entries(dismissed ?? {})) if (at > cutoff) this.#dismissed.set(id, at);
    for (const id of reminded ?? []) this.#reminded.add(id);

    this.platform.shell.onFocusChange((focused) => {
      this.focused = focused;
      this.platform.session.setFocused(focused);
      this.signals.touch("focus");
      if (focused && this.viewingChannelId) this.markViewed(this.viewingChannelId);
    });
    this.platform.shell.onNotificationClick((route) => {
      if (route) this.navigate(route as Route);
    });
    setInterval(() => this.#tick(), 15_000);
    void this.#initUpdates();

    const { loggedIn } = await this.platform.auth.status();
    if (!loggedIn) return this.#setStatus("loggedOut");
    await this.#attach();
  }

  async login(withToken?: string): Promise<boolean> {
    const ok = withToken ? await this.platform.auth.loginWithToken(withToken) : await this.platform.auth.loginWithDiscord();
    if (ok) await this.#attach();
    return ok;
  }

  async logout(): Promise<void> {
    await this.platform.auth.logout();
    location.reload();
  }

  async #attach(): Promise<void> {
    this.#setStatus("connecting");
    const snapshot = await this.platform.session.attach({
      onEvent: (e) => this.#onEvent(e),
      onStatus: (s) => this.#setStatus(s),
      onFatal: (f) => {
        this.#setStatus("loggedOut");
        this.toast(f.code === 4004 ? "Discord rejected the saved session. Please sign in again." : `Disconnected (${f.code})`, "error");
      },
    });
    if (!snapshot) return this.#setStatus("loggedOut");
    this.#setStatus(snapshot.status);
    if (snapshot.ready) {
      this.#replaying = true;
      this.store.hydrate(snapshot.ready.d as Record<string, unknown>, snapshot.supplemental?.d as Record<string, unknown> | undefined);
      for (const event of snapshot.backlog) this.#onEvent(event);
      this.#replaying = false;
      this.#afterReady();
    }
  }

  #afterReady(): void {
    this.#subscribedGuilds.clear();
    this.#lastMemberSub = "";
    if (!this.rules.onboarded) this.route = { view: "onboarding" };
    this.signals.touch("route", "status", "ready");
    void this.#refreshMentions();
    void this.#refreshRsvps();
    this.#updateBadge();
  }

  #setStatus(status: ClientStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.signals.touch("status");
  }

  // ---- gateway events -------------------------------------------------------

  #onEvent(event: GatewayDispatch): void {
    this.store.apply(event);
    const d = event.d as Record<string, any>;
    switch (event.t) {
      case "READY":
        this.#afterReady();
        return;
      case "MESSAGE_CREATE":
        this.#onMessage(d as Message);
        break;
      case "CALL_CREATE":
      case "CALL_UPDATE":
        if (!this.#replaying) this.#onCall(d.channel_id);
        break;
      case "CALL_DELETE":
        if (this.incomingCall?.channelId === d.channel_id) {
          this.incomingCall = null;
          this.signals.touch("call");
        }
        break;
      case "RECENT_MENTION_DELETE":
        this.#removeInbox(d.message_id);
        break;
      case "INTERACTION_SUCCESS":
      case "INTERACTION_FAILURE":
        this.#finishInteraction(d.nonce, event.t === "INTERACTION_FAILURE");
        break;
      case "INTERACTION_MODAL_CREATE":
        this.#finishInteraction(d.nonce, false);
        if (!this.#replaying) this.openOverlay({ kind: "modal", modal: d as InteractionModal });
        break;
      case "APPLICATION_COMMAND_AUTOCOMPLETE_RESPONSE":
        this.#autocomplete.get(d.nonce)?.(d.choices ?? []);
        this.#autocomplete.delete(d.nonce);
        break;
      case "MESSAGE_DELETE":
        this.#removeInbox(d.id);
        break;
    }
    if (event.t === "MESSAGE_CREATE" || event.t === "MESSAGE_ACK" || event.t === "CHANNEL_CREATE") this.#updateBadge();
  }

  #onMessage(msg: Message): void {
    const channel = this.store.channels.get(msg.channel_id);
    const guildId = msg.guild_id ?? channel?.guild_id;
    const isDM = !guildId;
    const mention = isDM ? null : classifyMention({ ...msg, guild_id: guildId }, this.store.mentionContext());
    if (mention) this.#addInbox(msg, mention);
    // On Android the background service decides notifications (it runs when the UI doesn't).
    if (this.#replaying || !this.store.me || this.platform.nativeNotifications) return;

    const decision = R.decideNotification({
      config: this.rules.config,
      meId: this.store.me.id,
      authorId: msg.author?.id ?? "",
      isDM,
      ...(guildId ? { guildId } : {}),
      mention,
      mutedByDiscord: channel ? this.store.mutedByDiscord(channel) : false,
      ...(channel ? { discordLevel: this.store.notificationLevel(channel) } : {}),
      authorBlocked: this.store.isBlocked(msg.author?.id ?? ""),
      viewingChannel: this.focused && this.viewingChannelId === msg.channel_id,
      now: Date.now(),
    });
    if (decision.action === "none") return;

    const author = this.store.authorName(msg);
    const notice: QueuedNotice = isDM
      ? {
          title: channel?.type === ChannelType.GroupDM ? `${author} · ${this.store.channelName(channel)}` : author,
          body: messagePreview(msg, this.store),
          route: { view: "dms", channelId: msg.channel_id },
        }
      : {
          title: `${author} in #${channel?.name ?? "channel"} · ${this.store.guilds.get(guildId!)?.name ?? ""}`,
          body: messagePreview(msg, this.store),
          route:
            R.modeOf(this.rules.config, guildId!) === "vault"
              ? { view: "vault", guildId: guildId! }
              : { view: "server", guildId: guildId!, channelId: msg.channel_id, anchor: msg.id },
        };

    if (decision.action === "notify") {
      this.platform.shell.notify({ id: msg.id, title: notice.title, body: notice.body, route: notice.route });
    } else if (decision.action === "digest") {
      this.#digest.push(notice);
      this.#digestAt ??= R.nextDigestTime(this.rules.config.digestTimes, Date.now());
    } else {
      this.#held.push({ ...notice, until: decision.until });
    }
  }

  #onCall(channelId: string): void {
    const me = this.store.me?.id;
    const ringing = !!me && !!this.store.calls.get(channelId)?.ringing.includes(me);
    if (ringing && this.incomingCall?.channelId !== channelId) {
      this.incomingCall = { channelId };
      this.signals.touch("call");
      if (this.platform.nativeNotifications) return;
      const name = this.store.channelName(this.store.channels.get(channelId));
      this.platform.shell.notify({
        id: `call-${channelId}`,
        title: `${name} is calling`,
        body: "Open minicord to join the call.",
        route: { view: "dms", channelId },
        urgent: true,
      });
    } else if (!ringing && this.incomingCall?.channelId === channelId) {
      this.incomingCall = null;
      this.signals.touch("call");
    }
  }

  #tick(): void {
    const now = Date.now();
    const next = R.expirePassRequest(R.applyDue(R.expirePasses(this.rules, now), now), now);
    if (next !== this.rules) this.#setRules(next);

    if (this.#digestAt !== null && now >= this.#digestAt && this.#digest.length) {
      this.#deliverSummary(this.#digest, "while you were away");
      this.#digest = [];
      this.#digestAt = null;
    }
    const due = this.#held.filter((h) => h.until <= now);
    if (due.length) {
      this.#held = this.#held.filter((h) => h.until > now);
      this.#deliverSummary(due, "during quiet hours");
    }
    this.#remindEvents(now);
  }

  #deliverSummary(items: QueuedNotice[], when: string): void {
    if (items.length === 1) {
      const [only] = items;
      this.platform.shell.notify({ id: `summary-${Date.now()}`, title: only!.title, body: only!.body, route: only!.route });
      return;
    }
    this.platform.shell.notify({
      id: `summary-${Date.now()}`,
      title: `${items.length} messages ${when}`,
      body: items
        .slice(0, 3)
        .map((i) => i.title.split(" · ")[0])
        .join(", "),
      route: { view: "inbox" },
    });
  }

  #remindEvents(now: number): void {
    let changed = false;
    for (const id of this.store.myRsvps) {
      const e = this.store.events.get(id);
      if (!e || this.#reminded.has(id) || !isUpcomingOrLive(e, now)) continue;
      const start = eventStart(e);
      if (start - now <= 60 * 60_000 && start > now) {
        this.#reminded.add(id);
        changed = true;
        const guild = this.store.guilds.get(e.guild_id);
        this.platform.shell.notify({
          id: `event-${id}`,
          title: `Starting soon: ${e.name}`,
          body: [new Date(start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), e.entity_metadata?.location, guild?.name]
            .filter(Boolean)
            .join(" · "),
          route: { view: "events" },
        });
      }
    }
    if (changed) void this.platform.storage.save(REMINDED_KEY, [...this.#reminded].slice(-200));
  }

  #updateBadge(): void {
    this.platform.shell.setBadge(this.store.unreadDms().length);
  }

  // ---- inbox ----------------------------------------------------------------

  async #refreshMentions(): Promise<void> {
    try {
      const messages = await this.api.recentMentions({ limit: 25 });
      for (const m of messages) {
        const guildId = m.guild_id ?? this.store.channels.get(m.channel_id)?.guild_id;
        const withGuild = guildId ? { ...m, guild_id: guildId } : m;
        this.#addInbox(withGuild, classifyMention(withGuild, this.store.mentionContext()) ?? { kind: "user", pings: true });
      }
    } catch (err) {
      this.#reportError(err, "Couldn't load mentions");
    }
  }

  #addInbox(msg: Message, mention: Mention): void {
    if (this.#dismissed.has(msg.id) || this.inbox.some((i) => i.id === msg.id)) return;
    const guildId = msg.guild_id ?? this.store.channels.get(msg.channel_id)?.guild_id;
    this.inbox = [
      ...this.inbox,
      { id: msg.id, message: msg, channelId: msg.channel_id, ...(guildId ? { guildId } : {}), kind: mention.kind, pings: mention.pings, at: snowflakeToMs(msg.id) },
    ]
      .sort((a, b) => b.at - a.at)
      .slice(0, 100);
    this.signals.touch("inbox");
  }

  #removeInbox(id: string): void {
    if (!this.inbox.some((i) => i.id === id)) return;
    this.inbox = this.inbox.filter((i) => i.id !== id);
    this.signals.touch("inbox");
  }

  /** Inbox as shown: @everyone pings from vaulted servers are hidden when the vault ignores them. */
  visibleInbox(): InboxItem[] {
    const { config } = this.rules;
    if (!config.vaultIgnoreEveryone) return this.inbox;
    return this.inbox.filter((i) => !(i.kind === "everyone" && i.guildId && R.modeOf(config, i.guildId) === "vault"));
  }

  dismiss(item: InboxItem): void {
    this.#dismissed.set(item.id, Date.now());
    this.#removeInbox(item.id);
    void this.platform.storage.save(DISMISSED_KEY, Object.fromEntries(this.#dismissed));
    if (item.pings) this.api.dismissMention(item.id).catch(() => {});
  }

  dismissAll(items: InboxItem[]): void {
    for (const item of items) this.dismiss(item);
  }

  // ---- navigation -----------------------------------------------------------

  navigate(route: Route): void {
    if (route.view === "server") {
      const mode = R.modeOf(this.rules.config, route.guildId);
      if (mode === "vault") {
        const channel = route.channelId ? this.store.channels.get(route.channelId) : undefined;
        const allowed =
          !!route.channelId && R.canViewChannel(this.rules, route.guildId, route.channelId, Date.now(), channel?.parent_id);
        if (!allowed) route = { view: "vault", guildId: route.guildId };
      } else if (!route.channelId && !route.list) {
        const channelId = this.#lastChannelInGuild.get(route.guildId) ?? this.#firstTextChannel(route.guildId);
        route = channelId ? { ...route, channelId } : route;
      }
      if (route.view === "server") {
        this.#subscribeGuild(route.guildId);
        if (route.channelId) this.#lastChannelInGuild.set(route.guildId, route.channelId);
      }
    }
    this.route = route;
    this.signals.touch("route");
  }

  /** Back navigation for the phone layout (Android back button). Returns false at the root. */
  back(): boolean {
    if (this.overlay) {
      this.closeOverlay();
      return true;
    }
    const r = this.route;
    switch (r.view) {
      case "inbox":
        return false;
      case "dms":
        this.navigate(r.channelId ? { view: "dms" } : { view: "inbox" });
        return true;
      case "friends":
        this.navigate({ view: "dms" });
        return true;
      case "server":
        if (r.channelId && !r.list) {
          const vaulted = R.modeOf(this.rules.config, r.guildId) === "vault";
          this.navigate(vaulted ? { view: "vault", guildId: r.guildId } : { view: "server", guildId: r.guildId, list: true });
        } else {
          this.navigate({ view: "servers" });
        }
        return true;
      case "vault":
        this.navigate({ view: "servers" });
        return true;
      default:
        this.navigate({ view: "inbox" });
        return true;
    }
  }

  #firstTextChannel(guildId: string): string | undefined {
    for (const group of this.store.guildChannelGroups(guildId)) {
      const text = group.channels.find((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement);
      if (text) return text.id;
    }
    return undefined;
  }

  /** Large guilds aren't auto-subscribed; subscribe when the user actually opens one, like the web client. */
  #subscribeGuild(guildId: string): void {
    if (this.#subscribedGuilds.has(guildId)) return;
    this.#subscribedGuilds.add(guildId);
    if ((this.store.guilds.get(guildId)?.member_count ?? 0) < LARGE_GUILD) return;
    this.platform.session.send(GatewayOp.GuildSubscriptionsBulk, {
      subscriptions: {
        [guildId]: { typing: true, threads: false, activities: true, member_updates: false, members: [], thread_member_lists: [], channels: {} },
      },
    });
  }

  // ---- messages -------------------------------------------------------------

  /** Make sure a channel has the right window of messages loaded (latest, or around an anchor). */
  openChannel(channelId: string, anchor?: string): Promise<void> {
    const list = this.store.messagesOf(channelId);
    const channel = this.store.channels.get(channelId);
    if (anchor) {
      if (list?.messages.some((m) => m.id === anchor)) return Promise.resolve();
      return this.#load(channelId, "around", anchor);
    }
    if (list && !list.hasMoreAfter && (list.messages.at(-1)?.id === channel?.last_message_id || !channel?.last_message_id)) {
      return Promise.resolve();
    }
    return this.#load(channelId, "latest");
  }

  loadOlder(channelId: string): Promise<void> {
    const first = this.store.messagesOf(channelId)?.messages.find((m) => !m.id.startsWith("pending-"));
    return first ? this.#load(channelId, "before", first.id) : Promise.resolve();
  }

  jumpToPresent(channelId: string): Promise<void> {
    return this.#load(channelId, "latest");
  }

  #load(channelId: string, mode: "latest" | "before" | "around", id?: string): Promise<void> {
    const key = `${channelId}:${mode}:${id ?? ""}`;
    const existing = this.#loading.get(key);
    if (existing) return existing;
    const run = this.api
      .getMessages(channelId, { limit: PAGE, ...(mode === "before" ? { before: id } : mode === "around" ? { around: id } : {}) })
      .then((page) => this.store.setMessagePage(channelId, page, mode, PAGE))
      .catch((err) => this.#reportError(err, "Couldn't load messages"))
      .finally(() => this.#loading.delete(key));
    this.#loading.set(key, run);
    return run;
  }

  canSendIn(channel: Channel): boolean {
    if (!channel.guild_id) return true;
    if (!this.store.canSend(channel)) return false;
    return this.accessOf(channel).allowed;
  }

  /** Vault gate for a guild channel, including the short grace period after a pass ends. */
  accessOf(channel: Channel): { allowed: boolean; pass?: R.Pass; grace?: boolean } {
    if (!channel.guild_id || R.modeOf(this.rules.config, channel.guild_id) === "open") return { allowed: true };
    const now = Date.now();
    const pass =
      R.activePass(this.rules, channel.id, now) ?? (channel.parent_id ? R.activePass(this.rules, channel.parent_id, now) : undefined);
    if (pass) return { allowed: true, pass };
    const recent = this.rules.passes.find(
      (p) => (p.channelId === channel.id || p.channelId === channel.parent_id) && p.endedAt !== undefined && now - p.endedAt < PASS_GRACE_MS,
    );
    return recent ? { allowed: true, pass: recent, grace: true } : { allowed: false };
  }

  async send(
    channelId: string,
    content: string,
    replyTo?: Message,
    opts: { ping?: boolean; files?: File[]; stickers?: { id: string; name: string; format_type: number }[] } = {},
  ): Promise<boolean> {
    const text = content.trim();
    const files = opts.files ?? [];
    const stickers = opts.stickers ?? [];
    const channel = this.store.channels.get(channelId);
    const me = this.store.me;
    if ((!text && !files.length && !stickers.length) || !channel || !me) return false;
    const access = this.accessOf(channel);
    if (!access.allowed) {
      this.toast("Your pass has ended.", "warn");
      return false;
    }
    const nonce = makeNonce();
    this.store.addPendingMessage({
      id: `pending-${nonce}`,
      nonce,
      channel_id: channelId,
      author: me,
      content: text,
      timestamp: new Date().toISOString(),
      mention_everyone: false,
      mentions: [],
      mention_roles: [],
      attachments: files.map((f, i) => ({ id: `pending-${i}`, filename: f.name, size: f.size, url: "", proxy_url: "" })),
      embeds: [],
      type: replyTo ? 19 : 0,
      ...(replyTo ? { referenced_message: replyTo } : {}),
      ...(stickers.length ? { sticker_items: stickers } : {}),
    });
    try {
      const attachments = files.length ? await this.#upload(channelId, files) : undefined;
      await this.api.sendMessage(channelId, {
        content: text,
        nonce,
        ...(attachments ? { attachments } : {}),
        ...(stickers.length ? { stickerIds: stickers.map((s) => s.id) } : {}),
        ...(replyTo
          ? { replyTo: { messageId: replyTo.id, channelId, ping: opts.ping ?? true, ...(channel.guild_id ? { guildId: channel.guild_id } : {}) } }
          : {}),
      });
      if (access.pass) this.#setRules(R.recordPassMessage(this.rules, access.pass.id));
      return true;
    } catch (err) {
      this.store.removePendingMessage(channelId, nonce);
      this.#reportError(err, "Message not sent");
      return false;
    }
  }

  /** Discord's cloud upload: signed URLs from Discord, bytes PUT by the platform shell, then referenced by the message. */
  async #upload(channelId: string, files: File[]) {
    const upload = this.platform.session.upload;
    if (!upload) throw new Error("Attachments aren't supported on this platform");
    const { attachments } = await this.api.requestUploads(channelId, files.map((f) => ({ filename: f.name, size: f.size })));
    return Promise.all(
      attachments.map(async (a, i) => {
        const file = files[i]!;
        const status = await upload(a.upload_url, new Uint8Array(await file.arrayBuffer()));
        if (!status || status >= 400) throw new Error(`Upload of ${file.name} failed (${status || "network"})`);
        return { id: String(a.id), filename: file.name, uploaded_filename: a.upload_filename };
      }),
    );
  }

  typing(channelId: string): void {
    const now = Date.now();
    if (now - (this.#lastTyping.get(channelId) ?? 0) < 8000) return;
    this.#lastTyping.set(channelId, now);
    this.api.typing(channelId).catch(() => {});
  }

  async editMessage(msg: Message, content: string): Promise<void> {
    try {
      await this.api.editMessage(msg.channel_id, msg.id, content);
    } catch (err) {
      this.#reportError(err, "Couldn't edit");
    }
  }

  async deleteMessage(msg: Message): Promise<void> {
    try {
      await this.api.deleteMessage(msg.channel_id, msg.id);
    } catch (err) {
      this.#reportError(err, "Couldn't delete");
    }
  }

  async toggleReaction(msg: Message, emoji: Emoji): Promise<void> {
    const existing = msg.reactions?.find((r) => (emoji.id ? r.emoji.id === emoji.id : r.emoji.name === emoji.name));
    try {
      if (existing?.me) await this.api.removeReaction(msg.channel_id, msg.id, emoji);
      else await this.api.addReaction(msg.channel_id, msg.id, emoji);
    } catch (err) {
      this.#reportError(err, "Couldn't react");
    }
  }

  /** Called while a channel is on screen with its newest messages visible. */
  markViewed(channelId: string): void {
    clearTimeout(this.#ackTimers.get(channelId));
    this.#ackTimers.set(
      channelId,
      setTimeout(() => {
        const channel = this.store.channels.get(channelId);
        const last = channel?.last_message_id;
        if (!this.focused || !last || !this.store.isUnread(channelId) || this.viewingChannelId !== channelId) return;
        if (this.#manualUnread.has(channelId)) return;
        this.store.markRead(channelId, last);
        this.#updateBadge();
        this.api.ack(channelId, last).catch(() => {});
      }, 750),
    );
  }

  setViewing(channelId: string | null): void {
    const previous = this.viewingChannelId;
    if (previous && previous !== channelId) {
      this.#manualUnread.delete(previous);
      this.unreadMarker.delete(previous);
      this.signals.touch(`marker:${previous}`);
    }
    if (channelId && channelId !== previous) {
      const read = this.store.readStates.get(channelId)?.last_message_id;
      if (read && this.store.isUnread(channelId)) this.unreadMarker.set(channelId, String(read));
      else this.unreadMarker.delete(channelId);
      this.signals.touch(`marker:${channelId}`);
    }
    this.viewingChannelId = channelId;
    this.platform.session.setViewing?.(channelId);
  }

  async togglePin(msg: Message): Promise<void> {
    try {
      await this.api.setPinned(msg.channel_id, msg.id, !msg.pinned);
      this.toast(msg.pinned ? "Unpinned" : "Pinned", "info");
    } catch (err) {
      this.#reportError(err, "Couldn't change pin");
    }
  }

  /** Mark unread from this message on; stays unread until you leave the conversation. */
  async markUnreadFrom(msg: Message): Promise<void> {
    const list = this.store.messagesOf(msg.channel_id)?.messages ?? [];
    const idx = list.findIndex((m) => m.id === msg.id);
    const before = idx > 0 ? list[idx - 1]!.id : String(BigInt(msg.id) - 1n);
    this.#manualUnread.add(msg.channel_id);
    this.unreadMarker.set(msg.channel_id, before);
    this.signals.touch(`marker:${msg.channel_id}`);
    this.store.markRead(msg.channel_id, before);
    this.#updateBadge();
    try {
      await this.api.markUnread(msg.channel_id, before);
    } catch (err) {
      this.#reportError(err, "Couldn't mark unread");
    }
  }

  markChannelRead(channelId: string): void {
    const last = this.store.channels.get(channelId)?.last_message_id;
    this.#manualUnread.delete(channelId);
    if (!last || !this.store.isUnread(channelId)) return;
    this.store.markRead(channelId, last);
    this.#updateBadge();
    this.api.ack(channelId, last).catch(() => {});
  }

  async markGuildRead(guildId: string): Promise<void> {
    const entries = [...(this.store.guildChannelIds.get(guildId) ?? [])]
      .map((id) => this.store.channels.get(id))
      .filter((c): c is Channel => !!c?.last_message_id && this.store.isUnread(c.id))
      .map((c) => ({ channelId: c.id, messageId: c.last_message_id! }));
    for (const e of entries) this.store.markRead(e.channelId, e.messageId);
    try {
      for (let i = 0; i < entries.length; i += 100) await this.api.ackBulk(entries.slice(i, i + 100));
    } catch (err) {
      this.#reportError(err, "Couldn't mark read");
    }
  }

  /** Mute in Discord's own settings (syncs to your other devices). */
  async setMuted(target: { guildId: string } | { channel: Channel }, muted: boolean): Promise<void> {
    try {
      if ("guildId" in target) {
        await this.api.updateGuildSettings(target.guildId, { muted, mute_config: null });
      } else {
        const c = target.channel;
        await this.api.updateGuildSettings(c.guild_id ?? "@me", { channel_overrides: { [c.id]: { muted, mute_config: null } } });
      }
    } catch (err) {
      this.#reportError(err, "Couldn't change mute");
    }
  }

  isMuted(target: { guildId: string } | { channel: Channel }): boolean {
    if ("guildId" in target) return !!this.store.guildSettings.get(target.guildId)?.muted;
    const settings = this.store.guildSettings.get(target.channel.guild_id ?? "@me");
    return !!settings?.channel_overrides.find((o) => o.channel_id === target.channel.id)?.muted;
  }

  async respondToFriend(userId: string, accept: boolean): Promise<void> {
    try {
      if (accept) await this.api.acceptFriend(userId);
      else await this.api.removeRelationship(userId);
    } catch (err) {
      this.#reportError(err, accept ? "Couldn't accept" : "Couldn't remove");
    }
  }

  async forward(msg: Message, targetId: string): Promise<void> {
    const target = this.store.channels.get(targetId);
    if (!target || !this.canSendIn(target)) {
      this.toast("You can't send there.", "warn");
      return;
    }
    const guildId = msg.guild_id ?? this.store.channels.get(msg.channel_id)?.guild_id;
    try {
      await this.api.forwardMessage(targetId, { messageId: msg.id, channelId: msg.channel_id, ...(guildId ? { guildId } : {}) });
      this.toast(`Forwarded to ${target.guild_id ? "#" : ""}${this.store.channelName(target)}`, "info");
    } catch (err) {
      this.#reportError(err, "Couldn't forward");
    }
  }

  /** Alt+Up/Down: previous/next channel in the list you're looking at (Alt+Shift: unread only). */
  stepChannel(dir: 1 | -1, unreadOnly = false): void {
    const r = this.route;
    let list: { id: string; route: Route }[];
    if (r.view === "server") {
      list = this.store
        .guildChannelGroups(r.guildId)
        .flatMap((g) => g.channels)
        .filter((c) => c.type !== ChannelType.GuildVoice && c.type !== ChannelType.GuildStageVoice)
        .map((c) => ({ id: c.id, route: { view: "server", guildId: r.guildId, channelId: c.id } }));
    } else if (r.view === "dms") {
      list = this.store.dmChannels().map((c) => ({ id: c.id, route: { view: "dms", channelId: c.id } }));
    } else {
      return;
    }
    if (!list.length) return;
    const at = list.findIndex((x) => x.id === r.channelId);
    for (let i = 1; i <= list.length; i++) {
      const next = list[(((at < 0 && dir > 0 ? -1 : at) + dir * i) % list.length + list.length) % list.length]!;
      if (!unreadOnly || (this.store.isUnread(next.id) && next.id !== r.channelId)) {
        this.navigate(next.route);
        return;
      }
    }
  }

  async votePoll(msg: Message, answerIds: number[]): Promise<void> {
    try {
      await this.api.votePoll(msg.channel_id, msg.id, answerIds);
    } catch (err) {
      this.#reportError(err, "Couldn't vote");
    }
  }

  async openDmWith(userId: string): Promise<void> {
    const existing = this.store.dmChannels().find((c) => c.type === ChannelType.DM && c.recipient_ids?.[0] === userId);
    if (existing) return this.navigate({ view: "dms", channelId: existing.id });
    try {
      const channel = await this.api.openDm(userId);
      this.store.apply({ t: "CHANNEL_CREATE", s: null, d: channel });
      this.navigate({ view: "dms", channelId: channel.id });
    } catch (err) {
      this.#reportError(err, "Couldn't open DM");
    }
  }

  /** Discord message links open in minicord (the vault gate still applies). */
  openLink(url: string): void {
    const match = MESSAGE_LINK.exec(url);
    if (!match) return this.platform.shell.openExternal(url);
    const [, guild, channelId, messageId] = match;
    if (guild === "@me") this.navigate({ view: "dms", channelId: channelId!, ...(messageId ? { anchor: messageId } : {}) });
    else this.navigate({ view: "server", guildId: guild!, channelId: channelId!, ...(messageId ? { anchor: messageId } : {}) });
  }

  messageLink(msg: Message): string {
    const guildId = msg.guild_id ?? this.store.channels.get(msg.channel_id)?.guild_id ?? "@me";
    return `https://discord.com/channels/${guildId}/${msg.channel_id}/${msg.id}`;
  }

  /** Server nicknames and role colours need member info; ask for missing authors (op 8, throttled per server). */
  requestMembers(guildId: string, userIds: Iterable<string>): void {
    let q = this.#memberRequests.get(guildId);
    if (!q) this.#memberRequests.set(guildId, (q = { pending: new Set(), asked: new Set(), lastAt: 0 }));
    // Ask once per person per session: people who left the server never come back in a chunk.
    for (const id of userIds) if (!q.asked.has(id) && !this.store.memberOf(guildId, id)) q.pending.add(id);
    if (!q.pending.size || q.timer) return;
    const entry = q;
    entry.timer = setTimeout(() => {
      const ids = [...entry.pending].slice(0, 100);
      entry.pending.clear();
      for (const id of ids) entry.asked.add(id);
      entry.timer = undefined;
      entry.lastAt = Date.now();
      this.platform.session.send(GatewayOp.RequestGuildMembers, { guild_id: [guildId], user_ids: ids, presences: false });
    }, Math.max(0, entry.lastAt + MEMBER_REQUEST_GAP_MS - Date.now()));
  }

  /** Mention autocomplete: ask Discord for matching members (debounced, like the web client). */
  searchMembers(guildId: string, query: string): void {
    let entry = this.#memberSearch.get(guildId);
    if (!entry) this.#memberSearch.set(guildId, (entry = { lastAt: 0 }));
    const e = entry;
    clearTimeout(e.timer);
    e.timer = setTimeout(() => {
      e.lastAt = Date.now();
      this.platform.session.send(GatewayOp.RequestGuildMembers, { guild_id: [guildId], query, limit: 10, presences: false });
    }, Math.max(350, e.lastAt + 1500 - Date.now()));
  }

  fetchProfile(userId: string, guildId?: string): Promise<UserProfile | null> {
    const key = `${userId}:${guildId ?? ""}`;
    let profile = this.#profiles.get(key);
    if (!profile) {
      profile = this.api
        .profile(userId, guildId)
        .then((p) => {
          if (guildId && p.guild_member) this.store.rememberMembers(guildId, [{ ...p.guild_member, user: p.guild_member.user ?? p.user }]);
          return p;
        })
        .catch(() => null);
      this.#profiles.set(key, profile);
    }
    return profile;
  }

  /** Collapsed categories live in Discord's own settings, so they match your other devices. */
  isCollapsed(guildId: string, categoryId: string): boolean {
    const local = this.#collapsed.get(categoryId);
    if (local !== undefined) return local;
    return !!this.store.guildSettings.get(guildId)?.channel_overrides.find((o) => o.channel_id === categoryId)?.collapsed;
  }

  setCollapsed(guildId: string, categoryId: string, collapsed: boolean): void {
    this.#collapsed.set(categoryId, collapsed);
    this.signals.touch("collapsed");
    this.api.updateGuildSettings(guildId, { channel_overrides: { [categoryId]: { collapsed } } }).catch(() => {});
  }

  startEdit(messageId: string): void {
    this.editingId = messageId;
    this.signals.touch("editing");
  }

  stopEdit(): void {
    if (!this.editingId) return;
    this.editingId = null;
    this.signals.touch("editing");
  }

  /** Largest upload for this account (Discord's per-plan limits). */
  uploadLimit(): number {
    const tier = this.store.me?.premium_type ?? 0;
    return tier === 2 ? 500 * 1024 ** 2 : tier ? 50 * 1024 ** 2 : 10 * 1024 ** 2;
  }

  copy(text: string, what = "Copied"): void {
    navigator.clipboard.writeText(text).then(
      () => this.toast(what, "info"),
      () => this.toast("Couldn't copy", "error"),
    );
  }

  confirm(opts: { title: string; body?: string; action: string; danger?: boolean; run: () => void }): void {
    this.openOverlay({ kind: "confirm", ...opts });
  }

  useEmoji(text: string): void {
    this.recentEmoji = [text, ...this.recentEmoji.filter((e) => e !== text)].slice(0, 24);
    void this.platform.storage.save(RECENT_EMOJI_KEY, this.recentEmoji);
  }

  openOverlay(overlay: Overlay): void {
    this.overlay = overlay;
    this.signals.touch("overlay");
  }

  closeOverlay(): void {
    if (!this.overlay) return;
    this.overlay = null;
    this.signals.touch("overlay");
  }

  // ---- app updates -------------------------------------------------------------

  async #initUpdates(): Promise<void> {
    const shell = this.platform.shell;
    this.appVersion = (await this.platform.appInfo?.().catch(() => null))?.version ?? null;
    this.signals.touch("update");
    if (shell.onUpdateStatus) {
      shell.onUpdateStatus((s) => this.#onUpdate(s, true));
    } else if (shell.checkForUpdates) {
      // Shells that can't push status (Android) get asked now and then.
      setTimeout(() => void this.checkForUpdates(true), 20_000);
      setInterval(() => void this.checkForUpdates(true), 24 * 3_600_000);
    }
  }

  async checkForUpdates(quiet = false): Promise<void> {
    const check = this.platform.shell.checkForUpdates;
    if (!check) return;
    if (!quiet) this.#onUpdate({ state: "checking" }, true);
    this.#onUpdate(await check().catch((err): UpdateStatus => ({ state: "error", message: String(err) })), quiet);
  }

  #onUpdate(status: UpdateStatus, quiet: boolean): void {
    const was = this.update;
    this.update = status;
    this.signals.touch("update");
    const fresh = was.state !== status.state || was.version !== status.version;
    if (fresh && status.state === "ready") this.toast(`minicord ${status.version} is ready`, "info", { label: "Restart", run: () => this.installUpdate() }, true);
    else if (fresh && status.state === "available") this.toast(`minicord ${status.version} is out`, "info", { label: "Download", run: () => this.installUpdate() }, true);
    else if (!quiet && status.state === "none") this.toast("You're on the latest version.", "info");
    else if (!quiet && status.state === "error") this.toast("Couldn't check for updates.", "warn");
  }

  installUpdate(): void {
    this.platform.shell.installUpdate?.(this.update);
  }

  // ---- presence ---------------------------------------------------------------

  ownStatus(): OwnStatus {
    const s = this.store.ownStatus.status;
    return s === "idle" || s === "dnd" || s === "invisible" ? s : "online";
  }

  /** Change your status: saved in Discord's settings (all your devices), and applied to this session right away. */
  async setStatus(status: OwnStatus): Promise<void> {
    const previous = this.store.ownStatus;
    this.store.ownStatus = { ...previous, status };
    this.store.touch("me", "presences");
    this.platform.session.send(GatewayOp.PresenceUpdate, { status, since: 0, activities: this.#customStatusActivity(), afk: false });
    try {
      await this.api.updateSettingsProto(1, encodeStatusSettings(status));
    } catch (err) {
      this.store.ownStatus = previous;
      this.store.touch("me", "presences");
      this.#reportError(err, "Couldn't change status");
    }
  }

  #customStatusActivity(): Activity[] {
    const custom = this.store.ownStatus.customStatus;
    if (!custom || (!custom.text && !custom.emojiName) || (custom.expiresAtMs && custom.expiresAtMs < Date.now())) return [];
    return [
      {
        type: 4,
        name: "Custom Status",
        ...(custom.text ? { state: custom.text } : {}),
        ...(custom.emojiName ? { emoji: { name: custom.emojiName, ...(custom.emojiId ? { id: custom.emojiId } : {}) } } : {}),
      },
    ];
  }

  // ---- member list -------------------------------------------------------------

  /** Ask for a channel's member sidebar (op 37), as far down as `through` (Discord pages it in 100s). */
  subscribeMemberList(channel: Channel, through = 99): void {
    const guildId = channel.guild_id;
    if (!guildId) return;
    const top = Math.floor(through / 100) * 100;
    const ranges: [number, number][] = [[0, 99]];
    if (top >= 200) ranges.push([top - 100, top - 1]);
    if (top >= 100) ranges.push([top, top + 99]);
    const key = `${channel.id}:${JSON.stringify(ranges)}`;
    if (key === this.#lastMemberSub) return;
    this.#lastMemberSub = key;
    this.#subscribedGuilds.add(guildId);
    this.store.expectMemberList(guildId, channel.id);
    this.platform.session.send(GatewayOp.GuildSubscriptionsBulk, {
      subscriptions: {
        [guildId]: { typing: true, threads: false, activities: true, member_updates: false, members: [], thread_member_lists: [], channels: { [channel.id]: ranges } },
      },
    });
  }

  // ---- slash commands & bot interactions ---------------------------------------

  /** Chat-input commands available in a channel: the server's (or DM's) plus your user-installed apps. */
  commandsFor(channel: Channel): Promise<CommandEntry[]> {
    const scopes: ({ guildId: string } | { channelId: string } | "user")[] = [channel.guild_id ? { guildId: channel.guild_id } : { channelId: channel.id }, "user"];
    return Promise.all(scopes.map((s) => this.#commandIndex(s))).then((lists) => {
      const seen = new Set<string>();
      return lists.flat().filter((e) => {
        const key = `${e.command.id}:${e.path.join(" ")}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    });
  }

  #commandIndex(scope: { guildId: string } | { channelId: string } | "user"): Promise<CommandEntry[]> {
    const key = scope === "user" ? "user" : "guildId" in scope ? `g:${scope.guildId}` : `c:${scope.channelId}`;
    const cached = this.#commandIndexes.get(key);
    if (cached && Date.now() - cached.at < 5 * 60_000) return cached.value;
    const value = this.api
      .commandIndex(scope)
      .then((index) => {
        const apps = new Map(index.applications.map((a) => [a.id, a]));
        const out: CommandEntry[] = [];
        for (const command of index.application_commands) {
          if (command.type !== 1) continue;
          const app = apps.get(command.application_id);
          const subs = (command.options ?? []).filter((o) => o.type === 1 || o.type === 2);
          if (!subs.length) {
            out.push({ command, ...(app ? { app } : {}), path: [], options: command.options, description: command.description });
            continue;
          }
          for (const sub of subs) {
            if (sub.type === 1) out.push({ command, ...(app ? { app } : {}), path: [sub.name], options: sub.options, description: sub.description ?? "" });
            else for (const leaf of sub.options ?? []) out.push({ command, ...(app ? { app } : {}), path: [sub.name, leaf.name], options: leaf.options, description: leaf.description ?? "" });
          }
        }
        return out;
      })
      .catch(() => [] as CommandEntry[]);
    this.#commandIndexes.set(key, { at: Date.now(), value });
    return value;
  }

  /** The nested `options` Discord expects for a (sub)command. */
  #commandOptions(entry: CommandEntry, values: Record<string, OptionValue>, focused?: string) {
    const leaf = (entry.options ?? [])
      .filter((o) => values[o.name] !== undefined && values[o.name] !== "")
      .map((o) => ({ type: o.type, name: o.name, value: values[o.name], ...(o.name === focused ? { focused: true } : {}) }));
    if (!entry.path.length) return leaf;
    if (entry.path.length === 1) return [{ type: 1, name: entry.path[0], options: leaf }];
    return [{ type: 2, name: entry.path[0], options: [{ type: 1, name: entry.path[1], options: leaf }] }];
  }

  #interactionBase(channel: Channel, applicationId: string) {
    return {
      application_id: applicationId,
      ...(channel.guild_id ? { guild_id: channel.guild_id } : {}),
      channel_id: channel.id,
      session_id: this.store.sessionId,
      nonce: makeNonce(),
    };
  }

  async runCommand(channel: Channel, entry: CommandEntry, values: Record<string, OptionValue>, files: Record<string, File> = {}): Promise<boolean> {
    const names = Object.keys(files);
    let attachments: { id: string; filename: string; uploaded_filename: string }[] = [];
    try {
      if (names.length) attachments = await this.#upload(channel.id, names.map((n) => files[n]!));
    } catch (err) {
      this.#reportError(err, "Upload failed");
      return false;
    }
    // Attachment options carry the index of their upload.
    const withFiles = { ...values };
    names.forEach((n, i) => (withFiles[n] = String(i)));
    const base = this.#interactionBase(channel, entry.command.application_id);
    const payload = {
      type: 2,
      ...base,
      data: {
        version: entry.command.version,
        id: entry.command.id,
        name: entry.command.name,
        type: 1,
        options: this.#commandOptions(entry, withFiles),
        application_command: entry.command,
        attachments: attachments.map((a, i) => ({ ...a, id: String(i) })),
      },
      analytics_location: "slash_ui",
    };
    return this.#interact(payload, base.nonce, `/${[entry.command.name, ...entry.path].join(" ")}`);
  }

  /** Suggestions for an autocomplete option (the app answers over the gateway). */
  autocomplete(channel: Channel, entry: CommandEntry, values: Record<string, OptionValue>, focused: string): Promise<{ name: string; value: string | number }[]> {
    const base = this.#interactionBase(channel, entry.command.application_id);
    const payload = {
      type: 4,
      ...base,
      data: {
        version: entry.command.version,
        id: entry.command.id,
        name: entry.command.name,
        type: 1,
        options: this.#commandOptions(entry, { ...values, [focused]: values[focused] ?? "" }, focused),
        application_command: entry.command,
        attachments: [],
      },
    };
    return new Promise((resolve) => {
      this.#autocomplete.set(base.nonce, resolve);
      setTimeout(() => {
        if (this.#autocomplete.delete(base.nonce)) resolve([]);
      }, 4000);
      this.api.interact(payload).catch(() => {
        this.#autocomplete.delete(base.nonce);
        resolve([]);
      });
    });
  }

  pressButton(msg: Message, button: ButtonComponent): void {
    if (button.style === 5 && button.url) return this.openLink(button.url);
    if (!button.custom_id) return;
    void this.#component(msg, { component_type: 2, custom_id: button.custom_id }, button.custom_id);
  }

  chooseOptions(msg: Message, select: SelectComponent, values: string[]): void {
    void this.#component(msg, { component_type: select.type, custom_id: select.custom_id, type: select.type, values }, select.custom_id);
  }

  async #component(msg: Message, data: Record<string, unknown>, customId: string): Promise<boolean> {
    const channel = this.store.channels.get(msg.channel_id);
    if (!channel) return false;
    const base = this.#interactionBase(channel, msg.application_id ?? msg.author.id);
    const key = `${msg.id}:${customId}`;
    this.pendingComponents.add(key);
    this.signals.touch("interactions");
    const payload = { type: 3, ...base, message_flags: msg.flags ?? 0, message_id: msg.id, data };
    return this.#interact(payload, base.nonce, msg.author.global_name ?? msg.author.username, key);
  }

  submitModal(modal: InteractionModal, values: Record<string, string | string[]>): void {
    const channel = this.store.channels.get(modal.channel_id);
    if (!channel) return;
    const base = this.#interactionBase(channel, modal.application.id);
    const answer = (c: Component): Component | Record<string, unknown> | null => {
      if (c.type === 1) return { type: 1, components: c.components.map(answer).filter(Boolean) };
      if (c.type === 18) return { type: 18, component: answer(c.component) };
      if (c.type === 4) return { type: 4, custom_id: c.custom_id, value: String(values[c.custom_id] ?? "") };
      if (c.type === 3 || c.type === 5 || c.type === 6 || c.type === 7 || c.type === 8) {
        const v = values[c.custom_id];
        return { type: c.type, custom_id: c.custom_id, values: Array.isArray(v) ? v : v ? [v] : [] };
      }
      return null;
    };
    const payload = {
      type: 5,
      ...base,
      data: { id: modal.id, custom_id: modal.custom_id, components: modal.components.map(answer).filter(Boolean) },
    };
    void this.#interact(payload, base.nonce, modal.application.name);
  }

  async #interact(payload: Record<string, unknown>, nonce: string, label: string, key?: string): Promise<boolean> {
    if (!this.store.sessionId) {
      this.toast("Not connected yet.", "warn");
      return false;
    }
    this.#interactions.set(nonce, { label, ...(key ? { key } : {}) });
    try {
      await this.api.interact(payload);
      // The gateway reports success/failure; give up waiting after a while.
      setTimeout(() => this.#finishInteraction(nonce, false), 15_000);
      return true;
    } catch (err) {
      this.#finishInteraction(nonce, false);
      this.#reportError(err, `${label} failed`);
      return false;
    }
  }

  #finishInteraction(nonce: string | undefined, failed: boolean): void {
    if (!nonce) return;
    const pending = this.#interactions.get(nonce);
    if (!pending) return;
    this.#interactions.delete(nonce);
    if (pending.key && this.pendingComponents.delete(pending.key)) this.signals.touch("interactions");
    if (failed) this.toast(`${pending.label} didn't respond.`, "warn");
  }

  dismissEphemeral(msg: Message): void {
    this.store.dismissMessage(msg.channel_id, msg.id);
  }

  // ---- GIFs, stickers, forum posts ------------------------------------------------

  /** Favorite GIFs from Discord's settings (read-only here). */
  favoriteGifs(): Promise<FavoriteGif[]> {
    this.#favoriteGifs ??= this.api
      .settingsProto(2)
      .then((r) => decodeFavoriteGifs(r.settings))
      .catch(() => []);
    return this.#favoriteGifs;
  }

  async createForumPost(forum: Channel, input: { title: string; content: string; tags: string[]; files: File[] }): Promise<boolean> {
    if (!forum.guild_id || !this.canSendIn(forum)) {
      this.toast("You can't post here.", "warn");
      return false;
    }
    try {
      const attachments = input.files.length ? await this.#upload(forum.id, input.files) : undefined;
      const thread = await this.api.createForumPost(forum.id, {
        name: input.title.trim(),
        content: input.content.trim(),
        appliedTags: input.tags,
        ...(attachments ? { attachments } : {}),
      });
      this.store.upsertChannels([{ ...thread, guild_id: forum.guild_id }]);
      const pass = this.accessOf(forum).pass;
      if (pass) this.#setRules(R.recordPassMessage(this.rules, pass.id));
      this.navigate({ view: "server", guildId: forum.guild_id, channelId: thread.id });
      return true;
    } catch (err) {
      this.#reportError(err, "Couldn't post");
      return false;
    }
  }

  // ---- calls ----------------------------------------------------------------

  joinCall(channelId: string): void {
    const channel = this.store.channels.get(channelId);
    this.platform.shell.openDiscord(channel?.guild_id ? `/channels/${channel.guild_id}/${channelId}` : `/channels/@me/${channelId}`);
    if (this.incomingCall?.channelId === channelId) {
      this.incomingCall = null;
      this.signals.touch("call");
    }
  }

  dismissCall(): void {
    this.incomingCall = null;
    this.signals.touch("call");
  }

  // ---- events ---------------------------------------------------------------

  async #refreshRsvps(): Promise<void> {
    const now = Date.now();
    const guildIds = [...new Set([...this.store.events.values()].filter((e) => isUpcomingOrLive(e, now)).map((e) => e.guild_id))];
    const ids: string[] = [];
    for (const guildId of guildIds) {
      try {
        const mine = await this.api.myScheduledEvents(guildId);
        for (const r of mine ?? []) ids.push(r.guild_scheduled_event_id);
      } catch {
        // counts and RSVPs are nice-to-have
      }
    }
    this.store.setRsvps(ids);
  }

  /** Refresh attendee counts for servers with upcoming events (at most every 10 minutes per server). */
  async refreshEventCounts(): Promise<void> {
    const now = Date.now();
    const guildIds = [...new Set([...this.store.events.values()].filter((e) => isUpcomingOrLive(e, now)).map((e) => e.guild_id))];
    for (const guildId of guildIds) {
      if (now - (this.#countsFetched.get(guildId) ?? 0) < 10 * 60_000) continue;
      this.#countsFetched.set(guildId, now);
      try {
        this.store.upsertEvents(await this.api.scheduledEvents(guildId));
      } catch {
        // ignore
      }
    }
  }

  async setInterested(event: ScheduledEvent, interested: boolean): Promise<void> {
    if (interested) this.store.myRsvps.add(event.id);
    else this.store.myRsvps.delete(event.id);
    this.store.touch("events");
    try {
      await this.api.setEventInterest(event.guild_id, event.id, interested);
    } catch (err) {
      if (interested) this.store.myRsvps.delete(event.id);
      else this.store.myRsvps.add(event.id);
      this.store.touch("events");
      this.#reportError(err, "Couldn't update RSVP");
    }
  }

  // ---- rules ----------------------------------------------------------------

  #setRules(next: R.RulesState): void {
    this.rules = next;
    void this.platform.storage.save(RULES_KEY, next);
    this.signals.touch("rules");
  }

  requestChange(change: R.Change): void {
    const result = R.requestChange(this.rules, change, Date.now(), crypto.randomUUID());
    this.#setRules(result.state);
    if (result.outcome === "pending") {
      this.toast(`Saved. It takes effect in ${this.rules.config.cooldownHours}h — you can cancel it until then.`, "info");
    }
  }

  cancelPending(id: string): void {
    this.#setRules(R.cancelPending(this.rules, id));
  }

  finishOnboarding(): void {
    this.#setRules({ ...this.rules, onboarded: true });
    this.navigate({ view: "inbox" });
  }

  /** Mention and event passes: free and instant. */
  openPass(req: R.PassRequest): boolean {
    const result = R.openPass(this.rules, req, Date.now(), crypto.randomUUID());
    if (!result.ok) {
      if (result.reason === "pause-required") return this.requestPass(req.guildId, req.channelId);
      this.toast(result.reason === "not-vaulted" ? "That server isn't vaulted." : "No passes left today.", "warn");
      return false;
    }
    this.#setRules(result.state);
    this.navigate({ view: "server", guildId: req.guildId, channelId: req.channelId, ...(req.anchorMessageId ? { anchor: req.anchorMessageId } : {}) });
    return true;
  }

  /** A manual pass starts with a pause; the vault card shows it and asks again when it's over. */
  requestPass(guildId: string, channelId: string): boolean {
    const result = R.requestPass(this.rules, { guildId, channelId }, Date.now(), crypto.randomUUID());
    if (!result.ok) {
      this.toast(result.reason === "not-vaulted" ? "That server isn't vaulted." : "No passes left today.", "warn");
      return false;
    }
    this.#setRules(result.state);
    if (this.route.view !== "vault" || this.route.guildId !== guildId) this.navigate({ view: "vault", guildId });
    return true;
  }

  cancelPassRequest(): void {
    this.#setRules(R.cancelPassRequest(this.rules));
  }

  claimPass(): boolean {
    const req = this.rules.passRequest;
    const result = R.claimPass(this.rules, Date.now(), crypto.randomUUID());
    if (!result.ok) {
      if (result.reason === "expired") this.#setRules(R.cancelPassRequest(this.rules));
      return false;
    }
    this.#setRules(result.state);
    if (req) this.navigate({ view: "server", guildId: req.guildId, channelId: req.channelId });
    return true;
  }

  extendPass(id: string): void {
    this.#setRules(R.extendPass(this.rules, id, Date.now()));
  }

  endPass(id: string): void {
    const pass = this.rules.passes.find((p) => p.id === id);
    this.#setRules(R.endPass(this.rules, id, Date.now()));
    if (pass) this.navigate({ view: "vault", guildId: pass.guildId });
  }

  // ---- misc -----------------------------------------------------------------

  /** Toasts fade after 7s; sticky ones (updates) wait to be dismissed. */
  toast(text: string, tone: Toast["tone"] = "info", action?: Toast["action"], sticky = false): void {
    const toast: Toast = { id: crypto.randomUUID(), text, tone, ...(action ? { action } : {}) };
    this.toasts = [...this.toasts, toast].slice(-3);
    this.signals.touch("toasts");
    if (!sticky) setTimeout(() => this.dismissToast(toast.id), 7000);
  }

  dismissToast(id: string): void {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.signals.touch("toasts");
  }

  #reportError(err: unknown, prefix: string): void {
    if (err instanceof DiscordApiError && err.captcha) {
      this.toast(`${prefix}: Discord wants a captcha for this. Do it in Discord's own window.`, "warn", {
        label: "Open Discord",
        run: () => this.platform.shell.openDiscord("/channels/@me"),
      });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    this.toast(`${prefix}. ${message}`, "error");
    console.warn(prefix, err);
  }

  /** "Done for now": mark visible stuff read and get out of the way. */
  done(): void {
    for (const c of this.store.unreadDms()) {
      if (c.last_message_id) {
        this.store.markRead(c.id, c.last_message_id);
        this.api.ack(c.id, c.last_message_id).catch(() => {});
      }
    }
    this.#updateBadge();
    this.navigate({ view: "inbox" });
    this.platform.shell.hide();
  }
}
