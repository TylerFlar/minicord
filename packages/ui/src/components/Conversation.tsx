import { ChannelType, rules as R, type Message } from "@minicord/core";
import { ArrowLeft, CalendarDays, ChevronRight, Hash, Megaphone, MessagesSquare, Phone, Pin, Search, Upload, Users } from "lucide-react";
import { effectiveStatus } from "../lib/presence.ts";
import { useIsMobile, useLocalFlag } from "../lib/responsive.ts";
import { MemberList } from "./MemberList.tsx";
import { useEffect, useRef, useState } from "react";
import { useNow, useSignals, useStore } from "../app/context.tsx";
import { Avatar } from "./Avatar.tsx";
import { Composer } from "./Composer.tsx";
import { MessageList } from "./MessageList.tsx";
import { PassBanner, usePassExpiry } from "./PassBanner.tsx";
import { IconButton } from "./ui.tsx";

const THREAD_TYPES = new Set<number>([ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread]);

/** A single channel: header, messages, composer. Used for DMs, open-server channels, threads and passes. */
export function Conversation({ channelId, anchor, onBack }: { channelId: string; anchor?: string; onBack?: () => void }) {
  const client = useSignals(["rules", "focus"]);
  const store = useStore([`channel:${channelId}`, "dms", `typing:${channelId}`, "channels", "presences"]);
  const mobile = useIsMobile();
  const [membersShown, setMembersShown] = useLocalFlag("mc:members", true);
  const channel = store.channels.get(channelId);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  useNow(1000); // re-evaluate pass state every second

  useEffect(() => {
    client.setViewing(channelId);
    setReplyTo(null);
    setFiles([]);
    return () => client.setViewing(null);
  }, [client, channelId]);

  const access = channel ? client.accessOf(channel) : { allowed: false };
  usePassExpiry(access.pass, access.grace);
  if (!channel) return <div className="flex-1 bg-surface p-6 text-muted">Channel not found.</div>;

  const isDm = channel.type === ChannelType.DM;
  const isGroup = channel.type === ChannelType.GroupDM;
  const isThread = THREAD_TYPES.has(channel.type);
  const parent = isThread && channel.parent_id ? store.channels.get(channel.parent_id) : undefined;
  const recipients = store.recipients(channel);
  const name = store.channelName(channel);
  const canWrite = client.canSendIn(channel);
  const typing = store.typingIn(channelId).filter((u) => u.id !== store.me?.id);
  const blocked = !access.allowed ? "Vaulted. Open a pass from the vault to reply." : !store.canSend(channel) ? "You can't send messages here." : undefined;
  const threads = !isDm && !isGroup && !isThread && channel.type !== ChannelType.GuildVoice;
  // In a vaulted server you only ever see one channel (a pass, or an event channel): no member list,
  // search stays in the channel, and history is capped.
  const vaulted = !!channel.guild_id && R.modeOf(client.rules.config, channel.guild_id) === "vault";
  const memberList = (isGroup || (!!channel.guild_id && !isThread && !vaulted)) && access.allowed;
  const eventable = !!channel.guild_id && (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) && access.allowed;
  const eventChannel = client.isEventChannel(channel);
  const toggleMembers = () => (mobile ? client.openOverlay({ kind: "members", channelId }) : setMembersShown(!membersShown));
  const dmPresence = isDm && recipients[0] ? store.presenceOf(recipients[0].id) : undefined;

  const droppable = access.allowed && canWrite;
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");

  return (
    <div
      className="relative flex min-w-0 flex-1 flex-col bg-surface"
      onDragEnter={(e) => {
        if (!droppable || !hasFiles(e)) return;
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => droppable && hasFiles(e) && e.preventDefault()}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(e) => {
        dragDepth.current = 0;
        setDragging(false);
        if (!droppable || !hasFiles(e)) return;
        e.preventDefault();
        const max = client.uploadLimit();
        const dropped = [...e.dataTransfer.files];
        if (dropped.some((f) => f.size > max)) client.toast("Some files are over your upload limit.", "warn");
        setFiles((prev) => [...prev, ...dropped.filter((f) => f.size <= max)].slice(0, 10));
      }}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3 sm:px-4">
        {onBack && (
          <IconButton label="Back" onClick={onBack} className="-ml-1.5">
            <ArrowLeft size={19} />
          </IconButton>
        )}
        {isDm && <Avatar user={recipients[0]} size={24} {...(dmPresence ? { status: effectiveStatus(dmPresence) } : {})} />}
        {isGroup && <Users size={20} className="shrink-0 text-muted" />}
        {!isDm && !isGroup && !isThread && (channel.type === ChannelType.GuildAnnouncement ? <Megaphone size={20} className="shrink-0 text-muted" /> : <Hash size={20} className="shrink-0 text-muted" />)}
        {parent && (
          <>
            <button
              className="hidden shrink-0 items-center gap-1 text-muted hover:text-text sm:flex"
              onClick={() => parent.guild_id && client.navigate({ view: "server", guildId: parent.guild_id, channelId: parent.id })}
            >
              <Hash size={18} /> {parent.name}
            </button>
            <ChevronRight size={16} className="hidden shrink-0 text-faint sm:block" />
            <MessagesSquare size={18} className="shrink-0 text-muted" />
          </>
        )}
        <span className="truncate text-[15.5px] font-semibold">{name}</span>
        {channel.topic && <span className="hidden min-w-0 truncate border-l border-line pl-3 text-[13.5px] text-muted md:inline">{channel.topic}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {(isDm || isGroup) && (
            <IconButton label="Call (opens Discord)" onClick={() => client.joinCall(channelId)} className="h-8 w-8">
              <Phone size={18} />
            </IconButton>
          )}
          {threads && access.allowed && (
            <IconButton label="Threads" onClick={() => client.openOverlay({ kind: "threads", channelId })} className="h-8 w-8">
              <MessagesSquare size={19} />
            </IconButton>
          )}
          {access.allowed && (
            <IconButton label="Pinned messages" onClick={() => client.openOverlay({ kind: "pins", channelId })} className="h-8 w-8">
              <Pin size={18} />
            </IconButton>
          )}
          {eventable && (
            <IconButton
              label={eventChannel ? "Event channel (on)" : "Event channel"}
              onClick={() => client.setEventChannel(channel, !eventChannel)}
              className={`h-8 w-8 ${eventChannel ? "text-accent" : ""}`}
            >
              <CalendarDays size={18} />
            </IconButton>
          )}
          {memberList && (
            <IconButton
              label={membersShown && !mobile ? "Hide member list" : "Member list"}
              onClick={toggleMembers}
              className={`h-8 w-8 ${membersShown && !mobile ? "text-text" : ""}`}
            >
              <Users size={19} />
            </IconButton>
          )}
          {access.allowed && (
            <IconButton
              label="Search"
              onClick={() =>
                // A pass only covers its channel, so search stays inside it; open servers search the whole server.
                client.openOverlay({ kind: "search", channelId, ...(channel.guild_id && !vaulted ? { guildId: channel.guild_id } : {}) })
              }
              className="h-8 w-8"
            >
              <Search size={18} />
            </IconButton>
          )}
        </span>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {access.pass && <PassBanner pass={access.pass} {...(access.grace ? { grace: true } : {})} />}
          {access.allowed ? (
            <MessageList
              channelId={channelId}
              {...(anchor ? { anchor } : {})}
              canWrite={canWrite}
              {...(vaulted ? { maxOlderPages: 2 } : {})}
              onReply={setReplyTo}
            />
          ) : (
            <div className="flex-1" />
          )}
          <Composer
            channel={channel}
            placeholder={isDm ? `Message @${name}` : isGroup ? `Message ${name}` : `Message ${isThread ? "" : "#"}${name}`}
            {...(blocked ? { blocked } : {})}
            replyTo={replyTo}
            onClearReply={() => setReplyTo(null)}
            files={files}
            setFiles={setFiles}
          />
          <div className="flex h-6 shrink-0 items-center gap-1.5 px-4 text-[12.5px] text-muted">
            {typing.length > 0 && (
              <>
                <span className="typing-dots" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
                <span className="truncate">
                  <span className="font-semibold text-text/80">
                    {typing.length > 3 ? "Several people" : typing.map((u) => store.displayName(u.id, channel.guild_id)).join(", ")}
                  </span>
                  {typing.length === 1 ? " is typing…" : " are typing…"}
                </span>
              </>
            )}
          </div>
        </div>
        {memberList && membersShown && !mobile && <MemberList channel={channel} />}
      </div>
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-accent/15 backdrop-blur-[1px]">
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-accent px-10 py-8 text-on-accent shadow-xl">
            <Upload size={30} />
            <div className="text-[16px] font-semibold">Upload to {isDm ? `@${name}` : `#${name}`}</div>
          </div>
        </div>
      )}
    </div>
  );
}
