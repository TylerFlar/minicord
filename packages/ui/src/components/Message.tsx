import { snowflakeToMs, type Attachment, type Embed, type Message, type Poll, type User } from "@minicord/core";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Check,
  Copy,
  CornerUpLeft,
  FileText,
  Forward,
  Gem,
  Link2,
  Megaphone,
  MessageSquareDot,
  MessagesSquare,
  MoreHorizontal,
  Pause,
  Pencil,
  Phone,
  PhoneMissed,
  Pin,
  Play,
  Shield,
  Smile,
  SmilePlus,
  Trash2,
} from "lucide-react";
import { memo, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { MinicordClient } from "../app/client.ts";
import { useClient, useSignals } from "../app/context.tsx";
import { parseEmojiText, pointFrom, type MenuEntry, type PickedEmoji } from "../app/overlay.ts";
import { emojiUrl, stickerUrl } from "../lib/cdn.ts";
import { DEFAULT_REACTIONS, replaceShortcodes, useEmojiData } from "../lib/emoji.ts";
import { formatBytes, formatClock, formatFull, formatRelative, formatSpan, formatTime } from "../lib/format.ts";
import { messagePreview } from "../lib/preview.ts";
import { isTouch, useLongPress } from "../lib/responsive.ts";
import { Avatar } from "./Avatar.tsx";
import { Markdown } from "./Markdown.tsx";
import { MessageComponents } from "./MessageComponents.tsx";
import { Reactions } from "./Reactions.tsx";
import { Button } from "./ui.tsx";

export interface MessagePerms {
  send: boolean;
  react: boolean;
  manage: boolean;
  pin: boolean;
}

export const NO_PERMS: MessagePerms = { send: false, react: false, manage: false, pin: false };

const Flags = { SuppressEmbeds: 1 << 2, Ephemeral: 1 << 6, Loading: 1 << 7, VoiceMessage: 1 << 13 };
/** Types rendered as regular chat messages; everything else is a one-line system row. */
const CHAT_TYPES = new Set([0, 19, 20, 23]);
export const isChatMessage = (m: Message) => CHAT_TYPES.has(m.type);

// Discord picks one of these by the message timestamp.
const JOIN_MESSAGES = [
  "{} joined the party.",
  "{} is here.",
  "Welcome, {}. We hope you brought pizza.",
  "A wild {} appeared.",
  "{} just landed.",
  "{} just slid into the server.",
  "{} just showed up!",
  "Welcome {}. Say hi!",
  "{} hopped into the server.",
  "Everyone welcome {}!",
  "Glad you're here, {}.",
  "Good to see you, {}.",
  "Yay you made it, {}!",
];

export interface MessageItemProps {
  message: Message;
  grouped: boolean;
  highlighted?: boolean;
  perms: MessagePerms;
  onReply: (m: Message) => void;
  onJump: (messageId: string) => void;
}

export const MessageItem = memo(function MessageItem(props: MessageItemProps) {
  const { message } = props;
  if (message.type === 21) {
    // A thread's first row shows the message it was started from.
    return message.referenced_message ? <ChatMessage {...props} message={message.referenced_message} grouped={false} perms={NO_PERMS} /> : null;
  }
  return isChatMessage(message) ? <ChatMessage {...props} /> : <SystemMessage message={message} onJump={props.onJump} />;
});

function mentionsMe(m: Message, client: MinicordClient, guildId: string | undefined): boolean {
  const store = client.store;
  const me = store.me?.id;
  if (!me || m.author?.id === me) return false;
  if (m.mentions?.some((u) => u.id === me)) return true;
  if (m.mention_everyone) return !(guildId && store.guildSettings.get(guildId)?.suppress_everyone);
  const roles = guildId ? store.myMembers.get(guildId)?.roles : undefined;
  return !!roles && !!m.mention_roles?.some((r) => roles.includes(r));
}

function confirmDelete(client: MinicordClient, msg: Message): void {
  client.confirm({ title: "Delete message", body: "This can't be undone.", action: "Delete", danger: true, run: () => void client.deleteMessage(msg) });
}

function toReaction(e: PickedEmoji) {
  return { id: e.id, name: e.name, ...(e.animated ? { animated: true } : {}) };
}

function messageMenu(client: MinicordClient, msg: Message, perms: MessagePerms, onReply: (m: Message) => void, at: { x: number; y: number }): MenuEntry[] {
  const mine = msg.author.id === client.store.me?.id;
  const guildId = msg.guild_id ?? client.store.channels.get(msg.channel_id)?.guild_id;
  const react = (e: PickedEmoji) => void client.toggleReaction(msg, toReaction(e));
  const items: MenuEntry[] = [];
  if (perms.react) {
    items.push({ reactions: true, onPick: react, onMore: () => client.openOverlay({ kind: "emoji", ...at, ...(guildId ? { guildId } : {}), onPick: react }) });
  }
  if (msg.reactions?.length) items.push({ label: "View reactions", icon: <Smile size={16} />, onSelect: () => client.openOverlay({ kind: "reactions", message: msg }) });
  if (mine && isChatMessage(msg)) items.push({ label: "Edit message", icon: <Pencil size={16} />, onSelect: () => client.startEdit(msg.id) });
  if (perms.send) items.push({ label: "Reply", icon: <CornerUpLeft size={16} />, onSelect: () => onReply(msg) });
  if (isChatMessage(msg)) items.push({ label: "Forward", icon: <Forward size={16} />, onSelect: () => client.openOverlay({ kind: "forward", message: msg }) });
  if (msg.content) items.push({ label: "Copy text", icon: <Copy size={16} />, onSelect: () => client.copy(msg.content) });
  if (perms.pin) items.push({ label: msg.pinned ? "Unpin message" : "Pin message", icon: <Pin size={16} />, onSelect: () => void client.togglePin(msg) });
  items.push({ label: "Mark unread", icon: <MessageSquareDot size={16} />, onSelect: () => void client.markUnreadFrom(msg) });
  items.push({ label: "Copy message link", icon: <Link2 size={16} />, onSelect: () => client.copy(client.messageLink(msg), "Link copied") });
  if (mine || perms.manage) {
    items.push({ separator: true }, { label: "Delete message", icon: <Trash2 size={16} />, danger: true, onSelect: () => confirmDelete(client, msg) });
  }
  return items;
}

function ChatMessage({ message, grouped, highlighted, perms, onReply, onJump }: MessageItemProps) {
  const client = useSignals(["editing"]);
  const store = client.store;
  const touch = isTouch();
  const mine = message.author?.id === store.me?.id;
  const pending = message.id.startsWith("pending-");
  const guildId = message.guild_id ?? store.channels.get(message.channel_id)?.guild_id;
  const ts = Date.parse(message.timestamp);
  const editing = client.editingId === message.id;
  const reply = message.type === 19 && message.message_reference?.type !== 1;
  const startsGroup = !grouped || reply || !!message.interaction_metadata;

  const openMenu = (x: number, y: number) => {
    if (!pending) client.openOverlay({ kind: "menu", x, y, items: messageMenu(client, message, perms, onReply, { x, y }) });
  };
  const longPress = useLongPress(openMenu);
  const showProfile = (e: MouseEvent, userId = message.author.id) => {
    e.stopPropagation();
    client.openOverlay({ kind: "profile", ...pointFrom(e, true), userId, ...(guildId ? { guildId } : {}) });
  };
  const react = (e: PickedEmoji) => void client.toggleReaction(message, toReaction(e));
  const openPicker = (e: MouseEvent) =>
    client.openOverlay({ kind: "emoji", ...pointFrom(e, true), ...(guildId ? { guildId } : {}), onPick: react });

  const mentioned = mentionsMe(message, client, guildId);
  const color = store.roleColor(guildId, message.author.id, message.member);
  const forwarded = message.message_reference?.type === 1 ? message.message_snapshots : undefined;

  return (
    <div
      id={`msg-${message.id}`}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!touch) openMenu(e.clientX, e.clientY);
      }}
      {...(touch ? longPress : {})}
      className={`group relative px-3 py-0.5 sm:px-4 ${startsGroup ? "mt-[17px]" : ""} ${touch ? "select-none [-webkit-touch-callout:none]" : ""} ${
        highlighted ? "bg-highlight" : mentioned ? "bg-highlight/70 shadow-[inset_2px_0_0_var(--mc-warn)]" : "hover:bg-sunken/50"
      } ${pending ? "opacity-60" : ""}`}
    >
      {reply && <ReplyPreview message={message} guildId={guildId} onJump={onJump} />}
      {message.interaction_metadata && (
        <div className="relative mb-0.5 flex items-center gap-1.5 pl-[52px] text-[13px] text-muted sm:pl-[56px]">
          <span className="absolute left-[19px] top-[9px] h-[10px] w-[29px] rounded-tl-md border-l-2 border-t-2 border-line sm:w-[33px]" />
          {message.interaction_metadata.user && <span className="font-medium text-text/80">{store.displayName(message.interaction_metadata.user.id, guildId)}</span>}
          used <span className="text-accent">/{message.interaction_metadata.name ?? "command"}</span>
        </div>
      )}
      <div className="flex gap-3 sm:gap-4">
        <div className="w-10 shrink-0">
          {startsGroup ? (
            <button onClick={showProfile} className="mt-0.5 block rounded-full">
              <Avatar user={store.users.get(message.author.id) ?? message.author} size={40} />
            </button>
          ) : (
            <span className="invisible block whitespace-nowrap text-right text-[10px] leading-[22px] text-faint group-hover:visible">{formatTime(ts)}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {startsGroup && (
            <div className="flex items-baseline gap-2 leading-[22px]">
              <button onClick={showProfile} className="min-w-0 truncate text-[15px] font-semibold hover:underline" style={color ? { color } : undefined}>
                {store.authorName(message)}
              </button>
              {message.author.bot && <span className="self-center rounded bg-accent px-1 text-[10px] font-semibold leading-[15px] text-on-accent">APP</span>}
              <span className="shrink-0 text-[11.5px] text-faint" title={formatFull(ts)}>
                {formatTime(ts)}
              </span>
            </div>
          )}
          {(message.flags ?? 0) & Flags.Loading ? (
            <div className="flex items-center gap-2 text-[15px] italic text-muted">
              <span className="typing-dots" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              {store.authorName(message)} is thinking…
            </div>
          ) : editing ? (
            <EditBox message={message} />
          ) : (
            message.content && (
              <div className="whitespace-pre-wrap break-words text-[15px] leading-[1.375]">
                <Markdown content={message.content} {...(guildId ? { guildId } : {})} />
                {message.edited_timestamp && (
                  <span className="ml-1 select-none text-[10.5px] text-faint" title={formatFull(Date.parse(message.edited_timestamp))}>
                    (edited)
                  </span>
                )}
              </div>
            )
          )}
          {forwarded?.map((s, i) => <Forwarded key={i} snapshot={s.message} reference={message.message_reference!} />)}
          {message.attachments?.length > 0 && <Attachments attachments={message.attachments} voice={!!((message.flags ?? 0) & Flags.VoiceMessage)} />}
          {message.sticker_items?.map((s) => {
            const url = stickerUrl(s);
            return url ? (
              <img key={s.id} src={url} alt={s.name} title={s.name} className="mt-1 h-40 w-40 object-contain" loading="lazy" />
            ) : (
              <div key={s.id} className="mt-1 text-[13px] italic text-muted">
                Sticker: {s.name}
              </div>
            );
          })}
          {message.poll && <PollView message={message} poll={message.poll} canVote={perms.send} />}
          {!((message.flags ?? 0) & Flags.SuppressEmbeds) && message.embeds?.map((e, i) => <EmbedView key={i} embed={e} />)}
          {!!message.components?.length && <MessageComponents message={message} guildId={guildId} />}
          {message.thread && <ThreadChip message={message} />}
          {!!message.reactions?.length && <Reactions message={message} canReact={perms.react} onAdd={openPicker} />}
          {!!((message.flags ?? 0) & Flags.Ephemeral) && (
            <div className="mt-1 flex items-center gap-1.5 text-[12.5px] text-muted">
              Only you can see this ·
              <button className="text-accent hover:underline" onClick={() => client.dismissEphemeral(message)}>
                Dismiss message
              </button>
            </div>
          )}
        </div>
      </div>
      {!pending && !editing && !touch && (
        <div className="absolute -top-4 right-4 z-10 hidden items-center rounded-md border border-line bg-surface p-0.5 shadow-sm group-hover:flex">
          {perms.react &&
            [...client.recentEmoji, ...DEFAULT_REACTIONS.filter((e) => !client.recentEmoji.includes(e))].slice(0, 3).map((text) => {
              const e = parseEmojiText(text);
              return (
                <button key={text} onClick={() => react(e)} className="flex h-8 w-8 items-center justify-center rounded hover:bg-sunken">
                  {e.id ? <img src={emojiUrl(e.id, false, 32)} alt={e.name} className="h-5 w-5 object-contain" /> : <span className="text-[18px] leading-none">{text}</span>}
                </button>
              );
            })}
          {perms.react && (
            <ToolbarButton label="Add reaction" onClick={openPicker}>
              <SmilePlus size={18} />
            </ToolbarButton>
          )}
          {mine && isChatMessage(message) ? (
            <ToolbarButton label="Edit" onClick={() => client.startEdit(message.id)}>
              <Pencil size={16} />
            </ToolbarButton>
          ) : (
            perms.send && (
              <ToolbarButton label="Reply" onClick={() => onReply(message)}>
                <CornerUpLeft size={18} />
              </ToolbarButton>
            )
          )}
          <ToolbarButton
            label="More"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              openMenu(r.left - 150, r.bottom + 4);
            }}
          >
            <MoreHorizontal size={18} />
          </ToolbarButton>
        </div>
      )}
    </div>
  );
}

function ToolbarButton({ label, onClick, children }: { label: string; onClick: (e: MouseEvent<HTMLButtonElement>) => void; children: ReactNode }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} className="flex h-8 w-8 items-center justify-center rounded text-muted hover:bg-sunken hover:text-text">
      {children}
    </button>
  );
}

function ReplyPreview({ message, guildId, onJump }: { message: Message; guildId: string | undefined; onJump: (id: string) => void }) {
  const client = useClient();
  const store = client.store;
  const ref = message.referenced_message;
  const pinged = !!ref && message.mentions?.some((u) => u.id === ref.author.id);
  return (
    <div className="relative mb-0.5 flex min-w-0 items-center gap-1.5 pl-[52px] text-[13px] leading-[18px] text-muted sm:pl-[56px]">
      <span className="absolute left-[19px] top-[9px] h-[10px] w-[29px] rounded-tl-md border-l-2 border-t-2 border-line sm:w-[33px]" />
      {!ref ? (
        <span className="italic">Original message was deleted</span>
      ) : (
        <button className="flex min-w-0 items-center gap-1.5 hover:text-text" onClick={() => onJump(ref.id)}>
          <Avatar user={store.users.get(ref.author.id) ?? ref.author} size={16} />
          <span className="shrink-0 font-medium" style={{ color: store.roleColor(guildId, ref.author.id, ref.member) }}>
            {pinged ? "@" : ""}
            {store.authorName(ref)}
          </span>
          <span className="truncate">{ref.content ? messagePreview(ref, store, 140) : <i>Click to see attachment</i>}</span>
        </button>
      )}
    </div>
  );
}

function SystemMessage({ message: m, onJump }: { message: Message; onJump: (id: string) => void }) {
  const client = useClient();
  const store = client.store;
  const guildId = m.guild_id ?? store.channels.get(m.channel_id)?.guild_id;
  const ts = Date.parse(m.timestamp);
  const name = (user: User) => (
    <button
      className="font-medium text-text hover:underline"
      style={{ color: store.roleColor(guildId, user.id) }}
      onClick={(e) => client.openOverlay({ kind: "profile", ...pointFrom(e, true), userId: user.id, ...(guildId ? { guildId } : {}) })}
    >
      {store.memberOf(guildId, user.id)?.nick || store.userName(store.users.get(user.id) ?? user)}
    </button>
  );
  const link = (label: ReactNode, onClick: () => void) => (
    <button className="font-medium text-text hover:underline" onClick={onClick}>
      {label}
    </button>
  );
  const author = name(m.author);
  const target = m.mentions?.[0];
  let icon: ReactNode = <ArrowRight size={16} className="text-accent" />;
  let body: ReactNode;
  switch (m.type) {
    case 1:
      body = <>{author} added {target ? name(target) : "someone"} to the group.</>;
      break;
    case 2:
      icon = <ArrowLeft size={16} className="text-danger" />;
      body = target && target.id !== m.author.id ? <>{author} removed {name(target)} from the group.</> : <>{author} left the group.</>;
      break;
    case 3: {
      const ended = m.call?.ended_timestamp;
      const missed = !!store.me && !m.call?.participants.includes(store.me.id);
      icon = missed ? <PhoneMissed size={16} className="text-danger" /> : <Phone size={16} className="text-accent" />;
      const lasted = ended ? formatSpan(Date.parse(ended) - ts) : "";
      body = !ended ? (
        <>
          {author} started a call. {link("Join the call", () => client.joinCall(m.channel_id))}
        </>
      ) : missed ? (
        <>
          You missed a call from {author} that lasted {lasted}.
        </>
      ) : (
        <>
          {author} started a call that lasted {lasted}.
        </>
      );
      break;
    }
    case 4:
      icon = <Pencil size={15} className="text-muted" />;
      body = (
        <>
          {author} changed the channel name: <span className="font-medium text-text">{m.content}</span>
        </>
      );
      break;
    case 5:
      icon = <Pencil size={15} className="text-muted" />;
      body = <>{author} changed the channel icon.</>;
      break;
    case 6:
      icon = <Pin size={15} className="text-muted" />;
      body = (
        <>
          {author} pinned {link("a message", () => m.message_reference?.message_id && onJump(m.message_reference.message_id))} to this channel.{" "}
          {link("See all pinned messages", () => client.openOverlay({ kind: "pins", channelId: m.channel_id }))}.
        </>
      );
      break;
    case 7: {
      const [before, after] = JOIN_MESSAGES[snowflakeToMs(m.id) % JOIN_MESSAGES.length]!.split("{}");
      body = (
        <>
          {before}
          {author}
          {after}
        </>
      );
      break;
    }
    case 8:
    case 9:
    case 10:
    case 11: {
      icon = <Gem size={15} className="text-[#d46bd0]" />;
      const times = Number(m.content) > 1 ? ` ${m.content} times` : "";
      const guild = guildId ? store.guilds.get(guildId)?.name : undefined;
      body = (
        <>
          {author} just boosted the server{times}!{m.type > 8 && guild ? ` ${guild} has achieved Level ${m.type - 8}!` : ""}
        </>
      );
      break;
    }
    case 12:
      icon = <Megaphone size={15} className="text-muted" />;
      body = (
        <>
          {author} has added <span className="font-medium text-text">{m.content}</span> to this channel.
        </>
      );
      break;
    case 18: {
      icon = <MessagesSquare size={15} className="text-muted" />;
      const threadId = m.message_reference?.channel_id;
      body = (
        <>
          {author} started a thread: {link(m.content, () => threadId && guildId && client.navigate({ view: "server", guildId, channelId: threadId }))}
        </>
      );
      break;
    }
    case 24:
      icon = <Shield size={15} className="text-muted" />;
      body = <>AutoMod blocked a message.</>;
      break;
    case 46: {
      icon = <BarChart3 size={15} className="text-muted" />;
      const question = m.embeds?.[0]?.fields?.find((f) => f.name === "poll_question_text")?.value ?? "";
      body = (
        <>
          {author}'s poll {link(question, () => m.message_reference?.message_id && onJump(m.message_reference.message_id))} has closed.
        </>
      );
      break;
    }
    default:
      if (!m.content) return null;
      body = (
        <>
          {author} <Markdown content={m.content} inline />
        </>
      );
  }
  return (
    <div id={`msg-${m.id}`} className="mt-2 flex items-start gap-3 px-3 py-0.5 text-[14.5px] leading-[22px] text-muted hover:bg-sunken/50 sm:gap-4 sm:px-4">
      <span className="flex w-10 shrink-0 justify-center pt-[3px]">{icon}</span>
      <div className="min-w-0 flex-1">
        {body}{" "}
        <span className="ml-1 text-[11.5px] text-faint" title={formatFull(ts)}>
          {formatTime(ts)}
        </span>
      </div>
    </div>
  );
}

function EditBox({ message }: { message: Message }) {
  const client = useClient();
  const [text, setText] = useState(message.content);
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [text]);
  const save = () => {
    const next = text.trim();
    client.stopEdit();
    if (!next) confirmDelete(client, message);
    else if (next !== message.content) void client.editMessage(message, next);
  };
  const touch = isTouch();
  return (
    <div className="my-1">
      <textarea
        ref={ref}
        value={text}
        rows={1}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !touch) {
            e.preventDefault();
            save();
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            client.stopEdit();
          }
        }}
        className="w-full resize-none rounded-lg bg-sunken px-3 py-2 text-[15px] leading-[1.375] outline-none"
      />
      {touch ? (
        <div className="mt-1 flex justify-end gap-2">
          <Button size="sm" tone="quiet" onClick={() => client.stopEdit()}>
            Cancel
          </Button>
          <Button size="sm" tone="accent" onClick={save}>
            Save
          </Button>
        </div>
      ) : (
        <div className="text-[12px] text-muted">
          escape to{" "}
          <button className="text-accent hover:underline" onClick={() => client.stopEdit()}>
            cancel
          </button>{" "}
          • enter to{" "}
          <button className="text-accent hover:underline" onClick={save}>
            save
          </button>
        </div>
      )}
    </div>
  );
}

function Forwarded({ snapshot, reference }: { snapshot: NonNullable<Message["message_snapshots"]>[number]["message"]; reference: NonNullable<Message["message_reference"]> }) {
  const client = useClient();
  const store = client.store;
  const origin = reference.channel_id ? store.channels.get(reference.channel_id) : undefined;
  const ts = snapshot.timestamp ? Date.parse(snapshot.timestamp) : undefined;
  return (
    <div className="mt-0.5 max-w-[560px] border-l-4 border-line pl-3">
      <div className="flex items-center gap-1 text-[13px] italic text-muted">
        <Forward size={13} /> Forwarded
      </div>
      {snapshot.content && (
        <div className="whitespace-pre-wrap break-words text-[15px] leading-[1.375]">
          <Markdown content={snapshot.content} />
        </div>
      )}
      {!!snapshot.attachments?.length && <Attachments attachments={snapshot.attachments} voice={false} />}
      {snapshot.embeds?.map((e, i) => <EmbedView key={i} embed={e} />)}
      {(origin || ts) && (
        <button
          className="mt-0.5 text-[12px] text-muted hover:underline"
          disabled={!origin || !reference.message_id}
          onClick={() => origin && reference.message_id && client.openLink(`https://discord.com/channels/${origin.guild_id ?? "@me"}/${origin.id}/${reference.message_id}`)}
        >
          {origin?.guild_id ? `#${origin.name} · ` : ""}
          {ts ? formatRelative(ts) : ""}
        </button>
      )}
    </div>
  );
}

function ThreadChip({ message }: { message: Message }) {
  const client = useClient();
  const thread = message.thread!;
  return (
    <button
      onClick={() => {
        client.store.upsertChannels([thread]);
        if (thread.guild_id) client.navigate({ view: "server", guildId: thread.guild_id, channelId: thread.id });
      }}
      className="mt-1 flex w-full max-w-[440px] items-center gap-3 rounded-lg border border-line bg-sunken/60 px-3 py-2 text-left hover:bg-sunken"
    >
      <MessagesSquare size={17} className="shrink-0 text-muted" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium">{thread.name}</span>
        <span className="text-[12.5px] font-medium text-accent">
          {thread.message_count ?? 0} message{thread.message_count === 1 ? "" : "s"} ›
        </span>
      </span>
    </button>
  );
}

function PollView({ message, poll, canVote }: { message: Message; poll: Poll; canVote: boolean }) {
  const client = useClient();
  const [selected, setSelected] = useState<number[]>([]);
  const counts = poll.results?.answer_counts ?? [];
  const total = counts.reduce((n, c) => n + c.count, 0);
  const voted = counts.some((c) => c.me_voted);
  const expiry = poll.expiry ? Date.parse(poll.expiry) : undefined;
  const closed = !!poll.results?.is_finalized || (expiry !== undefined && expiry < Date.now());
  const results = voted || closed;
  const toggle = (id: number) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : poll.allow_multiselect ? [...s, id] : [id]));
  return (
    <div className="mt-1 w-full max-w-[460px] rounded-lg border border-line bg-sunken/50 p-3">
      <div className="text-[15px] font-semibold">{poll.question.text}</div>
      <div className="mb-2 text-[12px] text-muted">{poll.allow_multiselect ? "Select one or more answers" : "Select one answer"}</div>
      <div className="flex flex-col gap-1.5">
        {poll.answers.map((a) => {
          const count = counts.find((c) => c.id === a.answer_id);
          const pct = total ? Math.round(((count?.count ?? 0) / total) * 100) : 0;
          const on = selected.includes(a.answer_id);
          return (
            <button
              key={a.answer_id}
              disabled={results || !canVote}
              onClick={() => toggle(a.answer_id)}
              className={`relative overflow-hidden rounded-md border bg-surface px-3 py-2 text-left text-[14px] ${on ? "border-accent" : "border-line"} ${results ? "" : "enabled:hover:border-muted"}`}
            >
              {results && <span className="absolute inset-y-0 left-0 bg-accent-soft" style={{ width: `${pct}%` }} />}
              <span className="relative flex items-center gap-2">
                {a.poll_media.emoji &&
                  (a.poll_media.emoji.id ? (
                    <img src={emojiUrl(a.poll_media.emoji.id, false, 32)} alt="" className="h-5 w-5" />
                  ) : (
                    <span>{a.poll_media.emoji.name}</span>
                  ))}
                <span className="min-w-0 flex-1">{a.poll_media.text}</span>
                {count?.me_voted && <Check size={15} className="text-accent" />}
                {results && <span className="text-[12.5px] font-medium tabular-nums text-muted">{pct}%</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-[12.5px] text-muted">
        <span>
          {total} vote{total === 1 ? "" : "s"} · {closed ? "Poll closed" : expiry ? `Ends ${formatRelative(expiry)}` : "Open"}
        </span>
        {!closed &&
          canVote &&
          (voted ? (
            <button className="hover:text-text hover:underline" onClick={() => void client.votePoll(message, [])}>
              Remove vote
            </button>
          ) : (
            <Button size="sm" tone="accent" disabled={!selected.length} onClick={() => void client.votePoll(message, selected)}>
              Vote
            </Button>
          ))}
      </div>
    </div>
  );
}

// ---- attachments & embeds ----------------------------------------------------

const isVisual = (a: Attachment) => /^(image|video)\//.test(a.content_type ?? "") || (!a.content_type && /\.(png|jpe?g|gif|webp)$/i.test(a.filename));
const isSpoiler = (a: Attachment) => a.filename.startsWith("SPOILER_") || !!((a.flags ?? 0) & 8);

function fitted(width?: number | null, height?: number | null, maxW = 400, maxH = 320): { width?: number; height?: number } {
  if (!width || !height) return {};
  const scale = Math.min(1, maxW / width, maxH / height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function sized(url: string, w?: number, h?: number): string {
  if (!w || !h) return url;
  return `${url}${url.includes("?") ? "&" : "?"}width=${w * 2}&height=${h * 2}`;
}

function Attachments({ attachments, voice }: { attachments: Attachment[]; voice: boolean }) {
  const media = attachments.filter(isVisual);
  const files = attachments.filter((a) => !isVisual(a));
  return (
    <div className="mt-1 flex flex-col items-start gap-1.5">
      {media.length === 1 && <MediaItem attachment={media[0]!} single />}
      {media.length > 1 && (
        <div className="grid w-full max-w-[420px] grid-cols-2 gap-1">
          {media.map((a) => (
            <MediaItem key={a.id} attachment={a} single={false} />
          ))}
        </div>
      )}
      {files.map((a) =>
        voice && a.content_type?.startsWith("audio/") ? (
          <VoiceMessage key={a.id} attachment={a} />
        ) : a.content_type?.startsWith("audio/") ? (
          <div key={a.id} className="w-full max-w-[420px] rounded-lg border border-line bg-sunken/50 p-2.5">
            <FileRow attachment={a} />
            <audio src={a.url} controls preload="none" className="mt-2 h-9 w-full" />
          </div>
        ) : (
          <div key={a.id} className="w-full max-w-[420px] rounded-lg border border-line bg-sunken/50 p-2.5">
            <FileRow attachment={a} />
          </div>
        ),
      )}
    </div>
  );
}

function FileRow({ attachment: a }: { attachment: Attachment }) {
  const client = useClient();
  return (
    <div className="flex items-center gap-2.5">
      <FileText size={28} className="shrink-0 text-muted" strokeWidth={1.5} />
      <span className="min-w-0">
        <button className="block max-w-full truncate text-left text-[14px] text-accent hover:underline" disabled={!a.url} onClick={() => client.platform.shell.openExternal(a.url)}>
          {a.filename}
        </button>
        <span className="block text-[12px] text-muted">{formatBytes(a.size)}</span>
      </span>
    </div>
  );
}

function MediaItem({ attachment: a, single }: { attachment: Attachment; single: boolean }) {
  const client = useClient();
  const [revealed, setRevealed] = useState(!isSpoiler(a));
  const type = a.content_type ?? "image/";
  const size = single ? fitted(a.width, a.height) : {};
  const frame = single ? "max-h-[320px] max-w-full" : "aspect-square h-full w-full object-cover";
  if (!a.url) {
    return <div className="flex h-24 w-40 items-center justify-center rounded-lg bg-sunken px-3 text-center text-[12px] text-muted">{a.filename}</div>;
  }
  const view = () => client.openOverlay({ kind: "media", url: a.url, media: type.startsWith("video/") ? "video" : "image", original: a.url });
  let media: ReactNode;
  if (type === "image/gif") {
    media = <StillImage src={a.proxy_url} alt={a.filename} className={`rounded-lg ${frame}`} style={size} onOpen={view} />;
  } else if (type.startsWith("video/")) {
    media = <video src={a.url} controls preload="metadata" style={size} className={`rounded-lg bg-black ${frame}`} />;
  } else {
    media = (
      <img
        src={sized(a.proxy_url, size.width, size.height)}
        alt={a.description ?? a.filename}
        style={size}
        className={`cursor-zoom-in rounded-lg object-cover ${frame}`}
        loading="lazy"
        onClick={view}
      />
    );
  }
  if (revealed) return media;
  return (
    <button onClick={() => setRevealed(true)} className="relative overflow-hidden rounded-lg" style={size}>
      <span className="pointer-events-none block blur-2xl">{media}</span>
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="rounded-full bg-black/60 px-3 py-1 text-[12px] font-semibold tracking-wide text-white">SPOILER</span>
      </span>
    </button>
  );
}

function waveformBars(b64: string | undefined, n: number): number[] {
  if (!b64) return Array.from({ length: n }, () => 0.35);
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    return Array.from({ length: n }, () => 0.35);
  }
  const step = bytes.length / n;
  return Array.from({ length: n }, (_, i) => {
    let max = 0;
    for (let j = Math.floor(i * step); j < Math.max(Math.floor((i + 1) * step), Math.floor(i * step) + 1); j++) max = Math.max(max, bytes[j] ?? 0);
    return max / 255;
  });
}

function VoiceMessage({ attachment: a }: { attachment: Attachment }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const bars = useMemo(() => waveformBars(a.waveform, 36), [a.waveform]);
  const duration = a.duration_secs ?? 0;
  const progress = duration ? time / duration : 0;
  return (
    <div className="flex w-[300px] max-w-full items-center gap-3 rounded-full border border-line bg-sunken/60 py-1.5 pl-1.5 pr-3">
      <button
        aria-label={playing ? "Pause" : "Play"}
        onClick={() => (playing ? audio.current?.pause() : void audio.current?.play())}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent"
      >
        {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
      </button>
      <div
        className="flex h-7 flex-1 cursor-pointer items-center gap-[2px]"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          if (audio.current && duration) audio.current.currentTime = ((e.clientX - r.left) / r.width) * duration;
        }}
      >
        {bars.map((h, i) => (
          <span key={i} className={`w-[3px] flex-1 rounded-full ${i / bars.length < progress ? "bg-accent" : "bg-faint/60"}`} style={{ height: `${Math.max(14, h * 100)}%` }} />
        ))}
      </div>
      <span className="w-9 shrink-0 text-right text-[12px] tabular-nums text-muted">{formatClock(playing || time ? time : duration)}</span>
      <audio
        ref={audio}
        src={a.url}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setTime(0);
        }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
      />
    </div>
  );
}

/** First frame only until hovered: GIFs don't get to autoplay. */
function StillImage({ src, alt, className, style, onOpen }: { src: string; alt: string; className: string; style?: object; onOpen?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [animate, setAnimate] = useState(false);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    // No crossOrigin: a tainted canvas still displays fine, and we never read its pixels.
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d")?.drawImage(img, 0, 0);
      setReady(true);
    };
    img.src = src;
  }, [src]);
  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setAnimate(true)}
      onMouseLeave={() => setAnimate(false)}
      onClick={(e) => {
        if (!isTouch() || animate) return onOpen?.();
        e.stopPropagation();
        setAnimate(true);
      }}
    >
      {animate ? (
        <img src={src} alt={alt} className={`${className} cursor-zoom-in`} style={style} />
      ) : (
        <canvas ref={canvasRef} className={`${className} ${ready ? "" : "bg-sunken"}`} style={style} />
      )}
      {!animate && <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1 text-[10px] font-semibold text-white">GIF</span>}
    </span>
  );
}

function EmbedView({ embed: e }: { embed: Embed }) {
  const client = useClient();
  // Bots write emoji as :shortcodes:, which Discord shows as emoji.
  const emoji = useEmojiData();
  const text = (t: string) => (emoji ? replaceShortcodes(emoji, t) : t);
  const view = (url: string) => client.openOverlay({ kind: "media", url, media: "image", original: url });

  if (e.type === "image" && (e.thumbnail || e.image)) {
    const m = e.image ?? e.thumbnail!;
    const size = fitted(m.width, m.height);
    return <img src={m.proxy_url ?? m.url} alt="" style={size} className="mt-1 max-h-[320px] max-w-full cursor-zoom-in rounded-lg" loading="lazy" onClick={() => view(m.url)} />;
  }
  if (e.type === "gifv" && e.video) {
    const size = fitted(e.video.width, e.video.height);
    return <GifVideo src={e.video.proxy_url ?? e.video.url} poster={e.thumbnail?.proxy_url} size={size} />;
  }

  const thumb = e.thumbnail?.proxy_url ?? e.thumbnail?.url;
  const image = e.image?.proxy_url ?? e.image?.url;
  const isVideo = e.type === "video";
  const color = e.color ? `#${e.color.toString(16).padStart(6, "0")}` : "var(--mc-line)";
  return (
    <div className="mt-1 flex max-w-[520px] gap-3 rounded-[5px] border-l-4 bg-sunken/70 py-2.5 pl-3 pr-4" style={{ borderLeftColor: color }}>
      <div className="min-w-0 flex-1">
        {e.provider?.name && <div className="text-[12px] text-muted">{e.provider.name}</div>}
        {e.author?.name && (
          <div className="mt-0.5 flex items-center gap-2 text-[13.5px] font-semibold">
            {(e.author.proxy_icon_url ?? e.author.icon_url) && <img src={e.author.proxy_icon_url ?? e.author.icon_url} alt="" className="h-6 w-6 rounded-full" loading="lazy" />}
            {e.author.url ? (
              <button className="hover:underline" onClick={() => client.openLink(e.author!.url!)}>
                {e.author.name}
              </button>
            ) : (
              e.author.name
            )}
          </div>
        )}
        {e.title && (
          <button
            className="mt-0.5 block text-left text-[15px] font-semibold text-accent hover:underline disabled:text-text disabled:no-underline"
            disabled={!e.url}
            onClick={() => e.url && client.openLink(e.url)}
          >
            <Markdown content={text(e.title)} inline />
          </button>
        )}
        {e.description && (
          <div className="mt-1 whitespace-pre-wrap break-words text-[14px] text-text/90">
            <Markdown content={text(e.description.length > 700 ? `${e.description.slice(0, 700)}…` : e.description)} inline />
          </div>
        )}
        {e.fields?.length ? (
          <div className="mt-2 grid grid-cols-3 gap-x-4 gap-y-2">
            {e.fields.map((f, i) => (
              <div key={i} className={f.inline ? "" : "col-span-3"}>
                <div className="text-[13px] font-semibold">
                  <Markdown content={text(f.name)} inline />
                </div>
                <div className="whitespace-pre-wrap text-[13.5px] text-text/90">
                  <Markdown content={text(f.value)} inline />
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {(image || (isVideo && thumb)) && (
          <button className="relative mt-3 block" onClick={() => (isVideo ? e.url && client.openLink(e.url) : image && view(e.image!.url))}>
            <img src={image ?? thumb} alt="" className="max-h-[300px] max-w-full rounded" loading="lazy" />
            {isVideo && (
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="rounded-full bg-black/60 p-3 text-white">
                  <Play size={22} fill="currentColor" />
                </span>
              </span>
            )}
          </button>
        )}
        {(e.footer?.text || e.timestamp) && (
          <div className="mt-2 flex items-center gap-1.5 text-[12px] text-muted">
            {(e.footer?.proxy_icon_url ?? e.footer?.icon_url) && <img src={e.footer?.proxy_icon_url ?? e.footer?.icon_url} alt="" className="h-5 w-5 rounded-full" loading="lazy" />}
            {e.footer?.text}
            {e.footer?.text && e.timestamp ? " • " : ""}
            {e.timestamp && formatFull(Date.parse(e.timestamp))}
          </div>
        )}
      </div>
      {thumb && !isVideo && !image && <img src={thumb} alt="" className="h-20 w-20 shrink-0 rounded object-cover" loading="lazy" />}
    </div>
  );
}

function GifVideo({ src, poster, size }: { src: string; poster: string | undefined; size: { width?: number; height?: number } }) {
  const ref = useRef<HTMLVideoElement>(null);
  return (
    <span
      className="relative mt-1 inline-block"
      onClick={() => {
        const v = ref.current;
        if (v && isTouch()) void (v.paused ? v.play() : v.pause());
      }}
    >
      <video
        ref={ref}
        src={src}
        poster={poster}
        muted
        loop
        playsInline
        preload="none"
        style={size}
        className="max-h-[320px] max-w-full rounded-lg bg-sunken"
        onMouseEnter={() => void ref.current?.play()}
        onMouseLeave={() => ref.current?.pause()}
      />
      <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-black/55 px-1 text-[10px] font-semibold text-white">GIF</span>
    </span>
  );
}
