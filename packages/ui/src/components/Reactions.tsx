import { sameEmoji, type Emoji, type Message, type Reaction } from "@minicord/core";
import { SmilePlus } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type TouchEvent, type UIEvent } from "react";
import { createPortal } from "react-dom";
import { useClient, useSignals, useStore } from "../app/context.tsx";
import { emojiUrl } from "../lib/cdn.ts";
import { emojiName, useEmojiData, type EmojiData } from "../lib/emoji.ts";
import { isTouch, useIsMobile, useLongPress } from "../lib/responsive.ts";
import { Avatar } from "./Avatar.tsx";
import { Empty, NameList, Spinner } from "./ui.tsx";

const TOOLTIP_DELAY_MS = 350;

function emojiLabel(data: EmojiData | null, e: Emoji): string {
  return (e.id ? e.name : (emojiName(data, e.name ?? "") ?? e.name)) ?? "emoji";
}

function ReactionEmoji({ emoji, size }: { emoji: Emoji; size: number }) {
  return emoji.id ? (
    <img src={emojiUrl(emoji.id, false, size * 2)} alt="" className="shrink-0 object-contain" style={{ width: size, height: size }} />
  ) : (
    <span className="shrink-0 leading-none" style={{ fontSize: size - 1 }}>
      {emoji.name}
    </span>
  );
}

/** The reactions under a message. Hover one to see who reacted; on phones, long-press it for everyone. */
export function Reactions({ message, canReact, onAdd }: { message: Message; canReact: boolean; onAdd: (e: MouseEvent) => void }) {
  const data = useEmojiData();
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {message.reactions!.map((r, i) => (
        <ReactionPill key={r.emoji.id ?? r.emoji.name ?? i} message={message} reaction={r} label={emojiLabel(data, r.emoji)} canReact={canReact} />
      ))}
      {canReact && !isTouch() && (
        <button onClick={onAdd} aria-label="Add reaction" className="hidden h-[26px] items-center rounded-lg bg-sunken px-1.5 text-muted hover:text-text group-hover:inline-flex">
          <SmilePlus size={16} />
        </button>
      )}
    </div>
  );
}

function ReactionPill({ message, reaction: r, label, canReact }: { message: Message; reaction: Reaction; label: string; canReact: boolean }) {
  const client = useClient();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const longPress = useLongPress(() => client.openOverlay({ kind: "reactions", message, emoji: r.emoji }));
  // The message's own long-press opens its menu; a pill's shows who reacted instead.
  const own = (fn: (e: TouchEvent) => void) => (e: TouchEvent) => {
    e.stopPropagation();
    fn(e);
  };
  const pointer = isTouch()
    ? { onTouchStart: own(longPress.onTouchStart), onTouchMove: own(longPress.onTouchMove), onTouchEnd: own(longPress.onTouchEnd), onTouchCancel: own(longPress.onTouchCancel) }
    : {
        onMouseEnter: (e: MouseEvent<HTMLButtonElement>) => {
          const el = e.currentTarget;
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setAnchor(el.getBoundingClientRect()), TOOLTIP_DELAY_MS);
        },
        onMouseLeave: () => {
          clearTimeout(timer.current);
          setAnchor(null);
        },
      };
  return (
    <>
      <button
        aria-label={`:${label}:, ${r.count} reaction${r.count === 1 ? "" : "s"}`}
        aria-pressed={r.me}
        onClick={() => {
          if (canReact) void client.toggleReaction(message, r.emoji);
        }}
        {...pointer}
        className={`inline-flex h-[26px] items-center gap-1.5 rounded-lg border px-1.5 text-[13px] ${
          r.me ? "border-accent/60 bg-accent-soft text-accent" : `border-transparent bg-sunken text-muted ${canReact ? "hover:border-line" : "cursor-default"}`
        }`}
      >
        <ReactionEmoji emoji={r.emoji} size={16} />
        <span className="font-semibold tabular-nums">{r.count}</span>
      </button>
      {anchor && <ReactionTooltip anchor={anchor} message={message} reaction={r} label={label} />}
    </>
  );
}

/** Discord's reaction tooltip: the emoji, big, and who reacted with it. */
function ReactionTooltip({ anchor, message, reaction, label }: { anchor: DOMRect; message: Message; reaction: Reaction; label: string }) {
  const client = useSignals(["reactors"]);
  const store = client.store;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const reactors = client.reactorsOf(message, reaction.emoji);
  const guildId = message.guild_id ?? store.channels.get(message.channel_id)?.guild_id;

  useEffect(() => {
    void client.loadReactors(message, reaction.emoji);
  }, [client, message, reaction]);

  // Centered above the pill (below it when there's no room), kept on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const above = anchor.top - r.height - 8;
    setPos({ left: Math.max(8, Math.min(anchor.left + anchor.width / 2 - r.width / 2, innerWidth - r.width - 8)), top: above >= 8 ? above : anchor.bottom + 8 });
  }, [anchor, reactors?.users.length, reaction.count]);

  const names = (reactors?.users ?? []).slice(0, 3).map((u) => <strong className="font-semibold">{store.displayName(u.id, guildId)}</strong>);
  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none fixed z-50 flex max-w-[280px] items-center gap-3 rounded-lg bg-text px-3 py-2.5 text-[13.5px] leading-snug text-bg shadow-lg"
      style={{ left: pos?.left ?? anchor.left, top: pos?.top ?? anchor.top, visibility: pos ? "visible" : "hidden" }}
    >
      <ReactionEmoji emoji={reaction.emoji} size={32} />
      <span className="min-w-0">
        {names.length ? (
          <>
            <NameList names={names} others={Math.max(0, reaction.count - names.length)} /> reacted with :{label}:
          </>
        ) : (
          `:${label}:`
        )}
      </span>
    </div>,
    document.body,
  );
}

/** Everyone who reacted, emoji by emoji: Discord's reactions window (a sheet on phones). */
export function ReactionsViewer({ message: opened, emoji }: { message: Message; emoji?: Emoji }) {
  const client = useSignals(["reactors"]);
  const store = useStore([`messages:${opened.channel_id}`, "members", "relationships"]);
  const data = useEmojiData();
  const sheet = useIsMobile() || isTouch();
  const [picked, setPicked] = useState(emoji);
  // Reactions keep changing while this is open: read the message as it is now.
  const message = store.messagesOf(opened.channel_id)?.messages.find((m) => m.id === opened.id) ?? opened;
  const reactions = message.reactions ?? [];
  const current = reactions.find((r) => picked && sameEmoji(r.emoji, picked)) ?? reactions[0];
  const reactors = current ? client.reactorsOf(message, current.emoji) : undefined;
  const listed = reactors?.users;
  const guildId = message.guild_id ?? store.channels.get(message.channel_id)?.guild_id;

  useEffect(() => {
    if (current) void client.loadReactors(message, current.emoji);
    else client.closeOverlay(); // the last reaction went away
  }, [client, message, current]);

  // Server nicknames for the people listed.
  useEffect(() => {
    if (guildId && listed?.length) client.requestMembers(guildId, listed.map((u) => u.id));
  }, [client, guildId, listed]);

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (current && reactors?.more && !reactors.loading && el.scrollHeight - el.scrollTop - el.clientHeight < 240) void client.loadReactors(message, current.emoji, true);
  };

  const tabs = reactions.map((r, i) => (
    <button
      key={r.emoji.id ?? r.emoji.name ?? i}
      aria-label={`:${emojiLabel(data, r.emoji)}:, ${r.count}`}
      aria-pressed={r === current}
      onClick={() => setPicked(r.emoji)}
      className={`flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 ${r === current ? "bg-sunken text-text" : "text-muted hover:bg-sunken/60 hover:text-text"}`}
    >
      <ReactionEmoji emoji={r.emoji} size={20} />
      <span className="text-[13.5px] font-semibold tabular-nums">{r.count}</span>
    </button>
  ));
  const list = (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-2" onScroll={onScroll}>
      {listed?.map((u) => {
        const name = store.displayName(u.id, guildId);
        return (
          <div key={u.id} className="flex min-w-0 items-center gap-3 rounded-md px-2 py-1.5">
            <Avatar user={store.users.get(u.id) ?? u} size={32} />
            <span className="min-w-0 truncate text-[14.5px] font-medium">{name}</span>
            {name !== u.username && <span className="min-w-0 shrink truncate text-[13px] text-muted">{u.username}</span>}
          </div>
        );
      })}
      {(!reactors || reactors.loading) && <Spinner />}
      {reactors?.failed && !reactors.loading && <Empty title="Couldn't load reactions" />}
    </div>
  );

  const close = () => client.closeOverlay();
  if (sheet) {
    return (
      <div className="fixed inset-0 z-50 flex items-end bg-black/35" onClick={close}>
        <div
          role="dialog"
          aria-label="Reactions"
          className="flex h-[60vh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface shadow-xl"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mx-auto mb-1 mt-2 h-1 w-10 shrink-0 rounded-full bg-line" />
          <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3 pb-2 [scrollbar-width:none]">{tabs}</div>
          {list}
        </div>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
      <div
        role="dialog"
        aria-label="Reactions"
        className="flex h-[440px] max-h-[80vh] w-full max-w-[440px] overflow-hidden rounded-xl border border-line bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex w-[116px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line p-2">{tabs}</div>
        {list}
      </div>
    </div>
  );
}
