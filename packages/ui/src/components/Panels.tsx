import { ChannelType, rules as R, snowflakeToMs, type Channel, type Message, type UserProfile } from "@minicord/core";
import { Hash, Lock, MessageCircle, MessagesSquare, Pin, Search, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useClient, useStore } from "../app/context.tsx";
import type { Route } from "../app/route.ts";
import { bannerUrl } from "../lib/cdn.ts";
import { formatStamp } from "../lib/format.ts";
import { activityText, effectiveStatus } from "../lib/presence.ts";
import { isTouch } from "../lib/responsive.ts";
import { Avatar, GuildIcon } from "./Avatar.tsx";
import { Markdown } from "./Markdown.tsx";
import { Button, Empty, Spinner } from "./ui.tsx";

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

export function ProfileCard({ userId, guildId }: { userId: string; guildId?: string }) {
  const client = useClient();
  const store = useStore(["members", "relationships", "presences", guildId ? `members:${guildId}` : "members"]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  useEffect(() => {
    let live = true;
    void client.fetchProfile(userId, guildId).then((p) => live && setProfile(p));
    return () => {
      live = false;
    };
  }, [client, userId, guildId]);

  const user = profile?.user ?? store.users.get(userId);
  if (!user) return null;
  const guild = guildId ? store.guilds.get(guildId) : undefined;
  const member = store.memberOf(guildId, userId) ?? profile?.guild_member;
  const name = member?.nick || store.userName(user);
  const accent = profile?.user_profile?.accent_color ?? profile?.user.accent_color;
  const banner = profile?.user.banner ? bannerUrl(userId, profile.user.banner) : null;
  const bio = profile?.guild_member_profile?.bio || profile?.user_profile?.bio || profile?.user.bio;
  const pronouns = profile?.guild_member_profile?.pronouns || profile?.user_profile?.pronouns;
  const roles = guild && member ? guild.roles.filter((r) => member.roles.includes(r.id)).sort((a, b) => b.position - a.position) : [];
  const isMe = userId === store.me?.id;
  const presence = store.presenceOf(userId);
  const status = isMe ? (client.ownStatus() === "invisible" ? "invisible" : client.ownStatus()) : presence ? effectiveStatus(presence) : undefined;
  const doing = isMe ? store.ownStatus.customStatus?.text : activityText(presence);

  return (
    <div className="w-full overflow-hidden bg-surface sm:w-[320px] sm:rounded-xl sm:border sm:border-line sm:shadow-xl">
      <div className="h-[72px]" style={{ background: banner ? `center / cover no-repeat url(${banner})` : accent ? hex(accent) : "var(--mc-sunken)" }} />
      <div className="px-4 pb-4">
        <div className="-mt-10 mb-2 w-fit rounded-full border-[5px] border-surface bg-surface">
          <Avatar user={user} size={76} {...(status ? { status } : {})} />
        </div>
        <div className="text-[19px] font-semibold leading-tight">{name}</div>
        <div className="text-[13.5px] text-muted">
          {user.username}
          {pronouns ? ` · ${pronouns}` : ""}
          {user.bot && <span className="ml-1.5 rounded bg-accent px-1 py-px text-[10px] font-semibold text-on-accent">APP</span>}
        </div>
        {doing && <div className="mt-2 text-[13.5px]">{doing}</div>}
        {bio && (
          <div className="mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[13.5px]">
            <Markdown content={bio} inline />
          </div>
        )}
        {roles.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {roles.map((r) => {
              const color = r.colors?.primary_color ?? r.color ?? 0;
              return (
                <span key={r.id} className="inline-flex items-center gap-1.5 rounded-md bg-sunken px-1.5 py-0.5 text-[12px]">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: color ? hex(color) : "var(--mc-faint)" }} />
                  {r.name}
                </span>
              );
            })}
          </div>
        )}
        {!isMe && !user.bot && (
          <Button
            tone="accent"
            className="mt-4 w-full justify-center py-2"
            onClick={() => {
              client.closeOverlay();
              void client.openDmWith(userId);
            }}
          >
            <MessageCircle size={15} /> Message
          </Button>
        )}
      </div>
    </div>
  );
}

function routeToMessage(channel: Channel | undefined, messageId: string): Route | null {
  if (!channel) return null;
  return channel.guild_id
    ? { view: "server", guildId: channel.guild_id, channelId: channel.id, anchor: messageId }
    : { view: "dms", channelId: channel.id, anchor: messageId };
}

function CompactMessage({ message, action, label }: { message: Message; action?: ReactNode; label?: string }) {
  const client = useClient();
  const store = client.store;
  const guildId = message.guild_id ?? store.channels.get(message.channel_id)?.guild_id;
  return (
    <div className="group flex gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <Avatar user={store.users.get(message.author.id) ?? message.author} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[14px] font-semibold" style={{ color: store.roleColor(guildId, message.author.id, message.member) }}>
            {store.authorName(message)}
          </span>
          <span className="shrink-0 text-[11px] text-faint">{formatStamp(Date.parse(message.timestamp))}</span>
          {label && <span className="min-w-0 truncate text-[12px] text-muted">{label}</span>}
          <span className="ml-auto shrink-0">{action}</span>
        </div>
        {message.content ? (
          <div className="line-clamp-4 whitespace-pre-wrap break-words text-[14px]">
            <Markdown content={message.content} inline />
          </div>
        ) : (
          <div className="text-[13px] italic text-muted">{message.attachments?.length ? `${message.attachments.length} attachment${message.attachments.length > 1 ? "s" : ""}` : "Embed"}</div>
        )}
      </div>
    </div>
  );
}

export function PinsPanel({ channelId }: { channelId: string }) {
  const client = useClient();
  const store = useStore([`pins:${channelId}`]);
  const version = store.version(`pins:${channelId}`);
  const [pins, setPins] = useState<Message[] | null>(null);
  useEffect(() => {
    let live = true;
    client.api
      .pins(channelId)
      .then((p) => live && setPins(p))
      .catch(() => live && setPins([]));
    return () => {
      live = false;
    };
  }, [client, channelId, version]);

  if (!pins) return <Spinner />;
  if (!pins.length) return <Empty icon={<Pin size={26} />} title="No pinned messages" />;
  return (
    <div>
      {pins.map((m) => (
        <CompactMessage key={m.id} message={m} action={<JumpButton message={m} />} />
      ))}
    </div>
  );
}

export function ThreadsPanel({ channelId }: { channelId: string }) {
  const client = useClient();
  const store = useStore(["channels"]);
  const [archived, setArchived] = useState<Channel[] | null>(null);
  useEffect(() => {
    let live = true;
    client.api
      .searchThreads(channelId, { archived: true, limit: 25 })
      .then((r) => {
        if (!live) return;
        store.upsertChannels(r.threads);
        setArchived(r.threads);
      })
      .catch(() => live && setArchived([]));
    return () => {
      live = false;
    };
  }, [client, store, channelId]);

  const active = store.threadsOf(channelId);
  const older = (archived ?? []).filter((t) => !active.some((a) => a.id === t.id));
  const open = (t: Channel) => {
    client.closeOverlay();
    if (t.guild_id) client.navigate({ view: "server", guildId: t.guild_id, channelId: t.id });
  };
  const row = (t: Channel) => (
    <button key={t.id} onClick={() => open(t)} className="flex w-full items-center gap-3 border-b border-line px-4 py-2.5 text-left last:border-b-0 hover:bg-sunken">
      <MessagesSquare size={16} className="shrink-0 text-muted" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium">{t.name}</span>
        <span className="text-[12px] text-muted">
          {t.message_count ?? 0} messages · {formatStamp(snowflakeToMs(t.last_message_id ?? t.id))}
        </span>
      </span>
    </button>
  );
  if (!active.length && archived && !older.length) return <Empty icon={<MessagesSquare size={26} />} title="No threads" />;
  return (
    <div>
      {active.length > 0 && <div className="px-4 pb-1 pt-3 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Active</div>}
      {active.map(row)}
      {older.length > 0 && <div className="px-4 pb-1 pt-3 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Older</div>}
      {older.map(row)}
      {!archived && <Spinner />}
    </div>
  );
}

interface SwitchItem {
  key: string;
  label: string;
  sub?: string;
  icon: ReactNode;
  unread?: boolean;
  route: Route;
}

/** Ctrl+K: jump to a DM, channel or server by name (# channels, @ people, * servers). */
export function QuickSwitcher() {
  const client = useClient();
  const store = client.store;
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const all = useMemo<SwitchItem[]>(() => {
    const items: SwitchItem[] = [];
    for (const c of store.dmChannels()) {
      const group = c.type === ChannelType.GroupDM;
      items.push({
        key: c.id,
        label: store.channelName(c),
        icon: group ? <Users size={16} /> : <Avatar user={store.recipients(c)[0]} size={20} />,
        unread: store.isUnread(c.id),
        route: { view: "dms", channelId: c.id },
      });
    }
    for (const g of store.sortedGuilds()) {
      const vaulted = R.modeOf(client.rules.config, g.id) === "vault";
      items.push({
        key: g.id,
        label: g.name,
        icon: <GuildIcon guild={g} size={20} muted={vaulted} />,
        ...(vaulted ? { sub: "Vaulted" } : {}),
        route: vaulted ? { view: "vault", guildId: g.id } : { view: "server", guildId: g.id },
      });
      if (vaulted) continue;
      for (const group of store.guildChannelGroups(g.id)) {
        for (const c of group.channels) {
          if (c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice) continue;
          items.push({
            key: c.id,
            label: c.name ?? "",
            sub: g.name,
            icon: <Hash size={16} />,
            unread: store.isUnread(c.id) && !store.mutedByDiscord(c),
            route: { view: "server", guildId: g.id, channelId: c.id },
          });
        }
      }
    }
    return items;
  }, [client, store]);

  const results = useMemo(() => {
    let q = query.trim().toLowerCase();
    let pool = all;
    const prefix = q[0];
    if (prefix === "#" || prefix === "@" || prefix === "*") {
      q = q.slice(1);
      pool = all.filter((i) =>
        prefix === "@" ? i.route.view === "dms" : prefix === "*" ? i.route.view === "vault" || (i.route.view === "server" && !("channelId" in i.route)) : "channelId" in i.route && i.route.view === "server",
      );
    }
    if (!q) return pool.filter((i) => i.route.view === "dms").slice(0, 8);
    const scored = pool
      .map((i) => {
        const l = i.label.toLowerCase();
        const score = l.startsWith(q) ? 0 : l.split(/[\s\-_]+/).some((w) => w.startsWith(q)) ? 1 : l.includes(q) ? 2 : -1;
        return { i, score };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => a.score - b.score);
    return scored.slice(0, 10).map((x) => x.i);
  }, [all, query]);

  const go = (item: SwitchItem | undefined) => {
    if (!item) return;
    client.closeOverlay();
    client.navigate(item.route);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/40 p-4 pt-[12vh]" onClick={() => client.closeOverlay()}>
      <div className="h-fit w-full max-w-lg overflow-hidden rounded-xl border border-line bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Search size={17} className="text-faint" />
          <input
            autoFocus={!isTouch()}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                go(results[index]);
              }
            }}
            placeholder="Where would you like to go?"
            className="w-full bg-transparent text-[16px] outline-none placeholder:text-faint"
          />
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-1.5">
          {results.map((item, i) => (
            <button
              key={item.key}
              onMouseEnter={() => setIndex(i)}
              onClick={() => go(item)}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left ${i === index ? "bg-sunken" : ""}`}
            >
              <span className="flex w-5 shrink-0 justify-center text-muted">{item.icon}</span>
              <span className={`min-w-0 truncate text-[14.5px] ${item.unread ? "font-semibold text-text" : "text-text/85"}`}>{item.label}</span>
              {item.sub && (
                <span className="ml-auto flex shrink-0 items-center gap-1 text-[12px] text-faint">
                  {item.sub === "Vaulted" && <Lock size={11} />}
                  {item.sub}
                </span>
              )}
            </button>
          ))}
          {!results.length && <div className="p-6 text-center text-[13.5px] text-muted">Nothing found</div>}
        </div>
      </div>
    </div>
  );
}

function JumpButton({ message }: { message: Message }) {
  const client = useClient();
  return (
    <button
      className="rounded px-1.5 text-[12px] font-medium text-accent hover:bg-accent-soft"
      onClick={() => {
        const route = routeToMessage(client.store.channels.get(message.channel_id), message.id);
        client.closeOverlay();
        if (route) client.navigate(route);
      }}
    >
      Jump
    </button>
  );
}

interface SearchState {
  q: string;
  results: Message[];
  total: number;
  loading: boolean;
  indexing?: boolean;
}

/** Discord's message search: a whole open server, or the one DM/channel you're in. */
export function SearchPanel({ channelId, guildId }: { channelId: string; guildId?: string }) {
  const client = useClient();
  const store = client.store;
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState | null>(null);
  const latest = useRef("");
  const scopeName = guildId ? store.guilds.get(guildId)?.name : store.channelName(store.channels.get(channelId));

  const run = async (q: string, offset = 0) => {
    if (!q.trim()) return;
    latest.current = q;
    setState((s) => ({ q, results: offset ? (s?.results ?? []) : [], total: s?.total ?? 0, loading: true }));
    try {
      const res = await client.api.searchMessages(guildId ? { guildId } : { channelId }, { content: q.trim(), offset });
      if (latest.current !== q) return;
      if (!res.messages) {
        setState({ q, results: [], total: 0, loading: false, indexing: true });
        return;
      }
      const hits = res.messages.map((group) => group.find((m) => m.hit) ?? group[0]).filter((m): m is Message => !!m);
      setState((s) => ({ q, results: [...(offset ? (s?.results ?? []) : []), ...hits], total: res.total_results ?? hits.length, loading: false }));
    } catch (err) {
      client.toast(`Search failed. ${err instanceof Error ? err.message : ""}`, "error");
      setState(null);
    }
  };

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(query);
        }}
        className="sticky top-0 z-10 border-b border-line bg-surface p-3"
      >
        <div className="flex items-center gap-2 rounded-md bg-sunken px-2.5 py-1.5">
          <Search size={15} className="shrink-0 text-faint" />
          <input
            autoFocus={!isTouch()}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            enterKeyHint="search"
            placeholder={`Search ${scopeName ?? ""}`}
            className="w-full bg-transparent text-[14.5px] outline-none placeholder:text-faint"
          />
        </div>
      </form>
      {state?.loading && !state.results.length && <Spinner />}
      {state?.indexing && <Empty title="Still indexing. Try again shortly." />}
      {state && !state.loading && !state.indexing && !state.results.length && <Empty icon={<Search size={26} />} title="No results" />}
      {state && state.results.length > 0 && (
        <div className="px-4 pb-1 pt-3 text-[11.5px] font-semibold uppercase tracking-wide text-muted">
          {state.total} result{state.total === 1 ? "" : "s"}
        </div>
      )}
      {state?.results.map((m) => (
        <CompactMessage
          key={m.id}
          message={m}
          action={<JumpButton message={m} />}
          {...(guildId ? { label: `#${store.channels.get(m.channel_id)?.name ?? "channel"}` } : {})}
        />
      ))}
      {state && state.results.length > 0 && state.results.length < state.total && (
        <div className="flex justify-center p-3">
          <Button tone="quiet" disabled={state.loading} onClick={() => void run(state.q, state.results.length)}>
            {state.loading ? "Loading…" : "More"}
          </Button>
        </div>
      )}
    </div>
  );
}

interface ForwardTarget {
  id: string;
  label: string;
  sub?: string;
  icon: ReactNode;
}

const NOT_POSTABLE = new Set<number>([ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildForum, ChannelType.GuildMedia]);

/** Forward a message to a DM or a channel you can post in (open servers, or a channel under an active pass). */
export function ForwardPicker({ message }: { message: Message }) {
  const client = useClient();
  const store = client.store;
  const [query, setQuery] = useState("");
  const [sending, setSending] = useState(false);
  const targets = useMemo<ForwardTarget[]>(() => {
    const out: ForwardTarget[] = [];
    for (const c of store.dmChannels()) {
      out.push({
        id: c.id,
        label: store.channelName(c),
        icon: c.type === ChannelType.GroupDM ? <Users size={16} /> : <Avatar user={store.recipients(c)[0]} size={22} />,
      });
    }
    for (const g of store.sortedGuilds()) {
      for (const group of store.guildChannelGroups(g.id)) {
        for (const c of group.channels) {
          if (!NOT_POSTABLE.has(c.type) && client.canSendIn(c)) out.push({ id: c.id, label: c.name ?? "", sub: g.name, icon: <Hash size={16} /> });
        }
      }
    }
    return out;
  }, [client, store]);
  const q = query.trim().toLowerCase();
  const shown = (q ? targets.filter((t) => t.label.toLowerCase().includes(q) || t.sub?.toLowerCase().includes(q)) : targets).slice(0, 40);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={() => client.closeOverlay()}>
      <div
        className="flex max-h-[80vh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface shadow-xl sm:max-w-md sm:rounded-xl sm:border sm:border-line"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 pb-2 pt-4">
          <div className="text-[17px] font-semibold">Forward to</div>
          <input
            autoFocus={!isTouch()}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="mt-3 w-full rounded-md bg-sunken px-3 py-2 text-[14.5px] outline-none placeholder:text-faint"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {shown.map((t) => (
            <button
              key={t.id}
              disabled={sending}
              onClick={async () => {
                setSending(true);
                await client.forward(message, t.id);
                client.closeOverlay();
              }}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-sunken disabled:opacity-50"
            >
              <span className="flex w-6 shrink-0 justify-center text-muted">{t.icon}</span>
              <span className="min-w-0 flex-1 truncate text-[14.5px]">{t.label}</span>
              {t.sub && <span className="max-w-[40%] truncate text-[12px] text-faint">{t.sub}</span>}
            </button>
          ))}
          {!shown.length && <div className="p-6 text-center text-[13.5px] text-muted">Nothing found</div>}
        </div>
      </div>
    </div>
  );
}
