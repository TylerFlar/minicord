import { ChannelType, rules as R, type Channel, type VoiceState } from "@minicord/core";
import { ArrowLeft, BellOff, CalendarDays, CheckCheck, ChevronDown, ExternalLink, Hash, HeadphoneOff, Link2, Megaphone, MessagesSquare, MicOff, Video, Volume2 } from "lucide-react";
import type { MouseEvent } from "react";
import { Conversation } from "../components/Conversation.tsx";
import { ForumView } from "../components/Forum.tsx";
import { Avatar } from "../components/Avatar.tsx";
import { guildMenu } from "../components/Sidebar.tsx";
import { usePostedEvents } from "../components/PostedEventCard.tsx";
import { Empty, IconButton } from "../components/ui.tsx";
import type { MinicordClient } from "../app/client.ts";
import { useClient, useNow, useSignals, useStore } from "../app/context.tsx";
import type { MenuEntry } from "../app/overlay.ts";
import { useIsMobile } from "../lib/responsive.ts";
import { agendaItems } from "./Events.tsx";

const VOICE = new Set<number>([ChannelType.GuildVoice, ChannelType.GuildStageVoice]);
const FORUM = new Set<number>([ChannelType.GuildForum, ChannelType.GuildMedia]);

export function ChannelIcon({ channel, size = 20 }: { channel: Channel; size?: number }) {
  if (channel.type === ChannelType.GuildAnnouncement) return <Megaphone size={size} />;
  if (FORUM.has(channel.type)) return <MessagesSquare size={size} />;
  if (VOICE.has(channel.type)) return <Volume2 size={size} />;
  return <Hash size={size} />;
}

function channelMenu(client: MinicordClient, c: Channel): MenuEntry[] {
  const muted = client.isMuted({ channel: c });
  const link = `https://discord.com/channels/${c.guild_id}/${c.id}`;
  return [
    { label: "Mark as read", icon: <CheckCheck size={16} />, onSelect: () => client.markChannelRead(c.id) },
    { label: muted ? "Unmute channel" : "Mute channel", icon: <BellOff size={16} />, onSelect: () => void client.setMuted({ channel: c }, !muted) },
    { separator: true },
    { label: "Copy link", icon: <Link2 size={16} />, onSelect: () => client.copy(link, "Link copied") },
    { label: "Open in Discord", icon: <ExternalLink size={16} />, onSelect: () => client.platform.shell.openDiscord(`/channels/${c.guild_id}/${c.id}`) },
  ];
}

function VoiceMembers({ states, guildId }: { states: VoiceState[]; guildId: string }) {
  const store = useClient().store;
  return (
    <div className="mb-1 ml-8 flex flex-col">
      {states.map((vs) => {
        const user = vs.member?.user ?? store.users.get(vs.user_id);
        return (
          <div key={vs.user_id} className="flex items-center gap-2 rounded-md px-1.5 py-[3px] text-[14px] text-muted">
            <Avatar user={user} size={22} />
            <span className="min-w-0 flex-1 truncate">{vs.member?.nick || store.displayName(vs.user_id, guildId)}</span>
            {vs.self_stream && <span className="rounded bg-danger px-1 text-[10px] font-bold leading-[14px] text-white">LIVE</span>}
            {vs.self_video && <Video size={14} />}
            {(vs.self_mute || vs.mute) && <MicOff size={14} />}
            {(vs.self_deaf || vs.deaf) && <HeadphoneOff size={14} />}
          </div>
        );
      })}
    </div>
  );
}

function ChannelSidebar({ guildId, selectedId, mobile }: { guildId: string; selectedId: string | undefined; mobile: boolean }) {
  const client = useSignals(["rules", "collapsed"]);
  const store = useStore(["guilds", `channels:${guildId}`, `guild:${guildId}`, "readstates", "settings", "voice", "members", "channels", "events"]);
  const posted = usePostedEvents();
  const now = useNow(60_000);
  const guild = store.guilds.get(guildId)!;
  const groups = store.guildChannelGroups(guildId);
  const eventCount = agendaItems(
    [...store.events.values()].filter((e) => e.guild_id === guildId),
    posted.filter((e) => e.guildId === guildId),
    now,
  ).length;

  const open = (c: Channel) => {
    if (VOICE.has(c.type)) client.joinCall(c.id);
    else client.navigate({ view: "server", guildId, channelId: c.id });
  };
  const context = (c: Channel) => (e: MouseEvent) => {
    e.preventDefault();
    client.openOverlay({ kind: "menu", x: e.clientX, y: e.clientY, items: channelMenu(client, c) });
  };

  const row = (c: Channel, depth = 0) => {
    const selected = c.id === selectedId;
    const muted = store.mutedByDiscord(c) || !!c.member?.muted;
    const unread = !VOICE.has(c.type) && !muted && store.isUnread(c.id);
    const mentions = store.mentionCount(c.id);
    return (
      <div key={c.id} className="relative">
        {unread && !selected && <span className="absolute -left-2 top-1/2 h-2 w-1 -translate-y-1/2 rounded-r-full bg-text" />}
        <button
          onClick={() => open(c)}
          onContextMenu={context(c)}
          className={`flex w-full items-center gap-1.5 rounded-md py-[5px] pr-2 text-left ${depth ? "pl-7 text-[14px]" : "pl-2 text-[15px]"} ${
            selected
              ? "bg-sunken text-text"
              : unread || mentions
                ? "font-semibold text-text hover:bg-sunken/70"
                : muted
                  ? "text-faint hover:bg-sunken/70"
                  : "text-muted hover:bg-sunken/70 hover:text-text"
          }`}
        >
          {depth ? <MessagesSquare size={15} className="shrink-0 opacity-70" /> : <span className="shrink-0 opacity-70"><ChannelIcon channel={c} /></span>}
          <span className="min-w-0 flex-1 truncate">{c.name}</span>
          {mentions > 0 && <span className="min-w-[18px] rounded-full bg-danger px-1.5 text-center text-[11.5px] font-bold leading-[18px] text-white">{mentions}</span>}
        </button>
      </div>
    );
  };

  return (
    <div className={`flex shrink-0 flex-col bg-bg ${mobile ? "w-full" : "w-60 border-r border-line"}`}>
      <div className="flex h-12 shrink-0 items-center border-b border-line">
        {mobile && (
          <IconButton label="Back" onClick={() => client.back()} className="ml-1.5">
            <ArrowLeft size={19} />
          </IconButton>
        )}
        <button
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            client.openOverlay({ kind: "menu", x: r.left + 8, y: r.bottom + 4, items: guildMenu(client, guild) });
          }}
          className={`flex h-full min-w-0 flex-1 items-center gap-2 text-left hover:bg-sunken/60 ${mobile ? "px-2" : "px-4"}`}
        >
          <span className="min-w-0 flex-1 truncate text-[15.5px] font-semibold">{guild.name}</span>
          <ChevronDown size={18} className="shrink-0 text-muted" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3 pt-2">
        <button
          onClick={() => client.navigate({ view: "events", guildId })}
          className="mb-2 flex w-full items-center gap-1.5 rounded-md py-[5px] pl-2 pr-2 text-left text-[15px] text-muted hover:bg-sunken/70 hover:text-text"
        >
          <CalendarDays size={18} className="shrink-0 opacity-70" />
          <span className="flex-1">Events</span>
          {eventCount > 0 && <span className="text-[12.5px] tabular-nums">{eventCount}</span>}
        </button>
        {groups.map((group) => {
          const category = group.category;
          const collapsed = !!category && client.isCollapsed(guildId, category.id);
          const channels = collapsed ? group.channels.filter((c) => c.id === selectedId || store.mentionCount(c.id) > 0) : group.channels;
          return (
            <div key={category?.id ?? "none"} className={category ? "mt-4" : ""}>
              {category && (
                <button
                  onClick={() => client.setCollapsed(guildId, category.id, !collapsed)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    client.openOverlay({
                      kind: "menu",
                      x: e.clientX,
                      y: e.clientY,
                      items: [{ label: collapsed ? "Expand category" : "Collapse category", onSelect: () => client.setCollapsed(guildId, category.id, !collapsed) }],
                    });
                  }}
                  className="flex w-full items-center gap-0.5 pb-1 pr-2 text-left text-[12px] font-semibold uppercase tracking-wide text-muted hover:text-text"
                >
                  <ChevronDown size={12} className={`shrink-0 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
                  <span className="truncate">{category.name}</span>
                </button>
              )}
              {channels.map((c) => {
                const voice = VOICE.has(c.type) ? store.voiceIn(c.id) : [];
                // Like Discord: the active threads you've joined, plus the one you're in.
                const threads = VOICE.has(c.type) || collapsed ? [] : store.threadsOf(c.id).filter((t) => t.id === selectedId || !!t.member);
                return (
                  <div key={c.id}>
                    {row(c)}
                    {voice.length > 0 && <VoiceMembers states={voice} guildId={guildId} />}
                    {threads.map((t) => row(t, 1))}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ServerScreen({ guildId, channelId, anchor, list = false }: { guildId: string; channelId?: string; anchor?: string; list?: boolean }) {
  const client = useSignals(["rules"]);
  const store = useStore(["guilds", `channels:${guildId}`, "channels"]);
  const mobile = useIsMobile();
  const guild = store.guilds.get(guildId);
  if (!guild) return <Empty title="Server not found" />;

  const vaulted = R.modeOf(client.rules.config, guildId) === "vault";
  const selected = channelId ? store.channels.get(channelId) : undefined;
  const showConversation = !mobile || (!!selected && !list);
  // In a pass the channel list stays hidden: you're here for one conversation.
  const showList = !vaulted && (!mobile || !showConversation);
  const back = mobile ? () => client.back() : undefined;

  return (
    <div className="flex min-w-0 flex-1">
      {showList && <ChannelSidebar guildId={guildId} selectedId={channelId} mobile={mobile} />}
      {!showConversation ? null : selected && FORUM.has(selected.type) ? (
        <ForumView key={selected.id} channel={selected} {...(back ? { onBack: back } : {})} />
      ) : selected ? (
        <Conversation key={selected.id} channelId={selected.id} {...(anchor ? { anchor } : {})} {...(back ? { onBack: back } : {})} />
      ) : (
        <div className="flex flex-1 items-center justify-center bg-surface">
          <Empty icon={<Hash size={28} />} title="Pick a channel" />
        </div>
      )}
    </div>
  );
}
