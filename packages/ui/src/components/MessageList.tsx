import { ChannelType, isNewer, Permission, type Channel, type Message } from "@minicord/core";
import { ArrowDown, Hash, MessagesSquare, Users } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useClient, useSignals, useStore } from "../app/context.tsx";
import { formatDay, sameDay } from "../lib/format.ts";
import { Avatar } from "./Avatar.tsx";
import { isChatMessage, MessageItem, NO_PERMS, type MessagePerms } from "./Message.tsx";
import { Button, Spinner } from "./ui.tsx";

const GROUP_WINDOW_MS = 7 * 60_000;
/** After this many "load older" pages, add a gentle nudge instead of letting history become a feed. */
const SOFT_CAP_PAGES = 3;

function groupedWith(prev: Message | undefined, msg: Message): boolean {
  if (!prev || prev.author?.id !== msg.author?.id || !isChatMessage(prev) || !isChatMessage(msg) || msg.type === 19) return false;
  const a = Date.parse(prev.timestamp);
  const b = Date.parse(msg.timestamp);
  return b - a < GROUP_WINDOW_MS && sameDay(a, b);
}

function ChannelIntro({ channel }: { channel: Channel }) {
  const client = useClient();
  const store = client.store;
  const name = store.channelName(channel);
  if (channel.type === ChannelType.DM) {
    const user = store.recipients(channel)[0];
    return (
      <div className="px-4 pb-2 pt-8">
        <Avatar user={user} size={80} />
        <div className="mt-3 text-[26px] font-bold leading-tight">{name}</div>
        {user && <div className="text-[15px] text-muted">{user.username}</div>}
      </div>
    );
  }
  const thread = channel.type === ChannelType.PublicThread || channel.type === ChannelType.PrivateThread || channel.type === ChannelType.AnnouncementThread;
  const icon = channel.type === ChannelType.GroupDM ? <Users size={36} /> : thread ? <MessagesSquare size={34} /> : <Hash size={40} />;
  return (
    <div className="px-4 pb-2 pt-8">
      <div className="flex h-[68px] w-[68px] items-center justify-center rounded-full bg-sunken text-muted">{icon}</div>
      <div className="mt-3 text-[26px] font-bold leading-tight">{channel.type === ChannelType.GroupDM ? name : thread ? name : `Welcome to #${name}!`}</div>
      {channel.topic && !thread && <div className="mt-1 text-[14.5px] text-muted">{channel.topic}</div>}
    </div>
  );
}

export function MessageList({
  channelId,
  anchor,
  canWrite,
  maxOlderPages,
  onReply,
}: {
  channelId: string;
  anchor?: string;
  canWrite: boolean;
  /** Passes cap how far back you can scroll. */
  maxOlderPages?: number;
  onReply: (m: Message) => void;
}) {
  const client = useSignals([`marker:${channelId}`]);
  const store = useStore([`messages:${channelId}`, "readstates", "members", `channel:${channelId}`]);
  const list = store.messagesOf(channelId);
  const channel = store.channels.get(channelId);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [olderPages, setOlderPages] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [highlight, setHighlight] = useState<string | undefined>(anchor);
  const prevHeight = useRef(0);
  const count = list?.messages.length ?? 0;
  const marker = client.unreadMarker.get(channelId);
  const guildId = channel?.guild_id;

  const perms = useMemo<MessagePerms>(() => {
    if (!channel) return NO_PERMS;
    const dm = !channel.guild_id;
    const manage = !dm && store.can(channel, Permission.ManageMessages);
    return {
      send: canWrite,
      react: canWrite && (dm || store.can(channel, Permission.AddReactions)),
      manage,
      pin: canWrite && (dm || manage || store.can(channel, Permission.PinMessages)),
    };
  }, [channel, canWrite, store]);

  useEffect(() => {
    setOlderPages(0);
    setHighlight(anchor);
    atBottom.current = !anchor;
    void client.openChannel(channelId, anchor);
  }, [client, channelId, anchor]);

  // Nicknames and role colours need member data Discord doesn't send up front.
  useEffect(() => {
    if (!guildId || !list) return;
    client.requestMembers(guildId, new Set(list.messages.filter((m) => !m.author.bot && !m.member).map((m) => m.author.id)));
  }, [client, guildId, list, count]);

  // Keep the view pinned to the bottom for new messages; keep position when older ones load.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prevHeight.current && loadingOlder) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
    } else if (highlight && document.getElementById(`msg-${highlight}`)) {
      document.getElementById(`msg-${highlight}`)?.scrollIntoView({ block: "center" });
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevHeight.current = 0;
    if (atBottom.current && list && !list.hasMoreAfter) client.markViewed(channelId);
  }, [count, list, highlight, loadingOlder, client, channelId]);

  // Images, embeds and reactions grow the list after it renders; stay pinned to the bottom when we were there.
  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!el || !inner) return;
    const observer = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, [channelId, list !== undefined]);

  // Esc: jump to the newest message and mark the channel read (like Discord).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || client.overlay || client.editingId || e.defaultPrevented) return;
      client.markChannelRead(channelId);
      const el = scroller.current;
      if (list?.hasMoreAfter) {
        atBottom.current = true;
        void client.jumpToPresent(channelId);
      } else if (el) {
        el.scrollTop = el.scrollHeight;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [client, channelId, list]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom.current && list && !list.hasMoreAfter) client.markViewed(channelId);
  };

  const loadOlder = async () => {
    prevHeight.current = scroller.current?.scrollHeight ?? 0;
    setLoadingOlder(true);
    await client.loadOlder(channelId);
    setOlderPages((n) => n + 1);
    setLoadingOlder(false);
  };

  const jumpTo = (id: string) => {
    setHighlight(id);
    const el = document.getElementById(`msg-${id}`);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    else void client.openChannel(channelId, id);
  };

  if (!list || !channel) return <Spinner />;
  const messages = list.messages;
  const olderAllowed = maxOlderPages === undefined || olderPages < maxOlderPages;
  const firstUnread = marker ? messages.find((m) => !m.id.startsWith("pending-") && isNewer(m.id, marker) && m.author.id !== store.me?.id)?.id : undefined;

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto overflow-x-hidden">
        <div ref={content} className="pb-4">
        {list.hasMoreBefore ? (
          <div className="flex flex-col items-center gap-1 px-4 pb-2 pt-4">
            {olderAllowed ? (
              <Button size="sm" tone="quiet" onClick={loadOlder} disabled={loadingOlder}>
                {loadingOlder ? "Loading…" : "Load older messages"}
              </Button>
            ) : (
              <div className="text-[12.5px] text-muted">Passes only reach this far back.</div>
            )}
            {olderPages >= SOFT_CAP_PAGES && olderAllowed && <div className="text-[12.5px] text-muted">{olderPages * 50}+ messages back. Quicker to ask?</div>}
          </div>
        ) : (
          <ChannelIntro channel={channel} />
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const ts = Date.parse(m.timestamp);
          const newDay = !prev || !sameDay(Date.parse(prev.timestamp), ts);
          const isNew = m.id === firstUnread;
          return (
            <Fragment key={m.id}>
              {(newDay || isNew) && (
                <div className={`relative mx-4 flex items-center ${newDay ? "mb-1 mt-6 justify-center" : "my-2 justify-end"}`}>
                  <div className={`absolute inset-x-0 top-1/2 h-px ${isNew ? "bg-danger/70" : "bg-line"}`} />
                  {newDay && <span className="relative bg-surface px-2 text-[12px] font-semibold text-muted">{formatDay(ts)}</span>}
                  {isNew && <span className={`${newDay ? "absolute right-0" : "relative"} rounded-sm bg-danger px-1 text-[10px] font-bold uppercase leading-[14px] text-white`}>New</span>}
                </div>
              )}
              <MessageItem
                message={m}
                grouped={!newDay && !isNew && groupedWith(prev, m)}
                highlighted={m.id === highlight}
                perms={perms}
                onReply={onReply}
                onJump={jumpTo}
              />
            </Fragment>
          );
        })}
        </div>
      </div>
      {list.hasMoreAfter && (
        <button
          onClick={() => {
            atBottom.current = true;
            setHighlight(undefined);
            void client.jumpToPresent(channelId);
          }}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-medium text-on-accent shadow-md hover:opacity-90"
        >
          Jump to present <ArrowDown size={14} />
        </button>
      )}
    </div>
  );
}
