import { Check, SmilePlus } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useClient, useSignals } from "../app/context.tsx";
import { parseEmojiText, type MenuEntry, type PickedEmoji } from "../app/overlay.ts";
import { emojiUrl } from "../lib/cdn.ts";
import { DEFAULT_REACTIONS } from "../lib/emoji.ts";
import { isTouch, useIsMobile } from "../lib/responsive.ts";
import { BotModal } from "./BotModal.tsx";
import { EmojiPicker } from "./EmojiPicker.tsx";
import { ExpressionPicker } from "./ExpressionPicker.tsx";
import { MemberList } from "./MemberList.tsx";
import { ForwardPicker, PinsPanel, ProfileCard, QuickSwitcher, SearchPanel, ThreadsPanel } from "./Panels.tsx";
import { Button } from "./ui.tsx";

/** Phones get bottom sheets; everything else floats at the pointer. */
function useSheet(): boolean {
  const mobile = useIsMobile();
  return mobile || isTouch();
}

function Sheet({ children }: { children: ReactNode }) {
  const client = useClient();
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/35" onClick={() => client.closeOverlay()}>
      <div
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-surface shadow-xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-1 mt-2 h-1 w-10 rounded-full bg-line" />
        {children}
      </div>
    </div>
  );
}

/** Positions its child at (x, y), flipped/clamped to stay on screen. */
function Floating({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  const client = useClient();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    let left = Math.min(x, innerWidth - r.width - pad);
    let top = y + r.height > innerHeight - pad ? y - r.height : y;
    left = Math.max(pad, left);
    top = Math.max(pad, Math.min(top, innerHeight - r.height - pad));
    setPos({ left, top });
  }, [x, y]);
  return (
    <div
      className="fixed inset-0 z-50"
      onMouseDown={(e) => e.target === e.currentTarget && client.closeOverlay()}
      onContextMenu={(e) => {
        e.preventDefault();
        client.closeOverlay();
      }}
    >
      <div ref={ref} className="absolute" style={{ left: pos?.left ?? x, top: pos?.top ?? y, visibility: pos ? "visible" : "hidden" }}>
        {children}
      </div>
    </div>
  );
}

function Anchored({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return useSheet() ? <Sheet>{children}</Sheet> : <Floating x={x} y={y}>{children}</Floating>;
}

function EmojiGlyph({ emoji }: { emoji: PickedEmoji }) {
  return emoji.id ? (
    <img src={emojiUrl(emoji.id, false, 48)} alt={emoji.name} className="h-6 w-6 object-contain" />
  ) : (
    <span className="text-[22px] leading-none">{emoji.text}</span>
  );
}

function QuickReactions({ onPick, onMore }: { onPick: (e: PickedEmoji) => void; onMore: () => void }) {
  const client = useClient();
  const sheet = useSheet();
  const recent = [...client.recentEmoji, ...DEFAULT_REACTIONS.filter((e) => !client.recentEmoji.includes(e))].slice(0, sheet ? 6 : 4);
  return (
    <div className={`flex items-center gap-1 ${sheet ? "justify-between px-3 pb-2 pt-1" : "px-1 pb-1"}`}>
      {recent.map((text) => {
        const emoji = parseEmojiText(text);
        return (
          <button
            key={text}
            onClick={() => {
              client.closeOverlay();
              client.useEmoji(text);
              onPick(emoji);
            }}
            className={`flex items-center justify-center rounded-full bg-sunken hover:bg-line ${sheet ? "h-11 w-11" : "h-9 w-9"}`}
          >
            <EmojiGlyph emoji={emoji} />
          </button>
        );
      })}
      <button
        aria-label="More reactions"
        onClick={() => {
          client.closeOverlay();
          onMore();
        }}
        className={`flex items-center justify-center rounded-full bg-sunken text-muted hover:bg-line hover:text-text ${sheet ? "h-11 w-11" : "h-9 w-9"}`}
      >
        <SmilePlus size={sheet ? 20 : 17} />
      </button>
    </div>
  );
}

function Menu({ items }: { items: MenuEntry[] }) {
  const client = useClient();
  const sheet = useSheet();
  return (
    <div className={sheet ? "px-2 pb-2" : "min-w-[200px] rounded-lg border border-line bg-surface p-1.5 shadow-xl"}>
      {items.map((item, i) => {
        if ("separator" in item) return <div key={i} className="mx-1 my-1 h-px bg-line" />;
        if ("reactions" in item) return <QuickReactions key={i} onPick={item.onPick} onMore={item.onMore} />;
        return (
          <button
            key={i}
            onClick={() => {
              client.closeOverlay();
              item.onSelect();
            }}
            className={`flex w-full items-center justify-between gap-6 rounded-md px-2.5 text-left ${sheet ? "py-3 text-[15.5px]" : "py-1.5 text-[13.5px]"} ${
              item.danger ? "text-danger hover:bg-danger hover:text-white" : "hover:bg-accent hover:text-on-accent"
            }`}
          >
            <span className="flex items-center gap-2.5">
              {item.leading}
              {item.label}
            </span>
            {item.checked ? <Check size={16} /> : item.icon && <span className="flex opacity-80">{item.icon}</span>}
          </button>
        );
      })}
    </div>
  );
}

function Confirm({ title, body, action, danger, run }: { title: string; body?: string; action: string; danger?: boolean; run: () => void }) {
  const client = useClient();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => client.closeOverlay()}>
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[17px] font-semibold">{title}</h3>
        {body && <p className="mt-1.5 text-[14px] text-muted">{body}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button tone="quiet" onClick={() => client.closeOverlay()}>
            Cancel
          </Button>
          <Button
            autoFocus
            tone={danger ? "danger-solid" : "accent"}
            onClick={() => {
              client.closeOverlay();
              run();
            }}
          >
            {action}
          </Button>
        </div>
      </div>
    </div>
  );
}

function MediaViewer({ url, media, original }: { url: string; media: "image" | "video"; original: string }) {
  const client = useClient();
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-4" onClick={() => client.closeOverlay()}>
      {media === "video" ? (
        <video src={url} controls autoPlay className="max-h-[85vh] max-w-full rounded" onClick={(e) => e.stopPropagation()} />
      ) : (
        <img src={url} alt="" className="max-h-[85vh] max-w-full rounded object-contain" onClick={(e) => e.stopPropagation()} />
      )}
      <button
        className="mt-3 text-[13px] text-white/70 hover:text-white hover:underline"
        onClick={(e) => {
          e.stopPropagation();
          client.platform.shell.openExternal(original);
        }}
      >
        Open original
      </button>
    </div>
  );
}

/** Panels drop down from the conversation header on desktop, and slide up on phones. */
function Panel({ title, children }: { title: string; children: ReactNode }) {
  const client = useClient();
  const body = (
    <>
      <div className="flex h-11 items-center border-b border-line px-4 text-[15px] font-semibold">{title}</div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </>
  );
  if (useSheet()) return <Sheet>{body}</Sheet>;
  return (
    <div className="fixed inset-0 z-50" onMouseDown={(e) => e.target === e.currentTarget && client.closeOverlay()}>
      <div className="absolute right-4 top-12 flex max-h-[75vh] w-[440px] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xl">{body}</div>
    </div>
  );
}

export function OverlayHost() {
  const client = useSignals(["overlay"]);
  const overlay = client.overlay;

  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      client.closeOverlay();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [client, overlay]);

  if (!overlay) return null;
  switch (overlay.kind) {
    case "menu":
      return (
        <Anchored x={overlay.x} y={overlay.y}>
          <Menu items={overlay.items} />
        </Anchored>
      );
    case "emoji":
      return (
        <Anchored x={overlay.x} y={overlay.y}>
          <EmojiPicker
            {...(overlay.guildId ? { guildId: overlay.guildId } : {})}
            onPick={(e) => {
              client.closeOverlay();
              overlay.onPick(e);
            }}
          />
        </Anchored>
      );
    case "profile":
      return (
        <Anchored x={overlay.x} y={overlay.y}>
          <ProfileCard userId={overlay.userId} {...(overlay.guildId ? { guildId: overlay.guildId } : {})} />
        </Anchored>
      );
    case "media":
      return <MediaViewer url={overlay.url} media={overlay.media} original={overlay.original} />;
    case "pins":
      return (
        <Panel title="Pinned messages">
          <PinsPanel channelId={overlay.channelId} />
        </Panel>
      );
    case "threads":
      return (
        <Panel title="Threads">
          <ThreadsPanel channelId={overlay.channelId} />
        </Panel>
      );
    case "switcher":
      return <QuickSwitcher />;
    case "search":
      return (
        <Panel title="Search">
          <SearchPanel channelId={overlay.channelId} {...(overlay.guildId ? { guildId: overlay.guildId } : {})} />
        </Panel>
      );
    case "forward":
      return <ForwardPicker message={overlay.message} />;
    case "modal":
      return <BotModal modal={overlay.modal} />;
    case "members": {
      const channel = client.store.channels.get(overlay.channelId);
      return channel ? (
        <Panel title="Members">
          <MemberList channel={channel} sheet />
        </Panel>
      ) : null;
    }
    case "expressions":
      return (
        <Anchored x={overlay.x} y={overlay.y}>
          <ExpressionPicker
            tab={overlay.tab}
            {...(overlay.guildId ? { guildId: overlay.guildId } : {})}
            onEmoji={(e) => {
              client.closeOverlay();
              overlay.onEmoji(e);
            }}
            onGif={(url) => {
              client.closeOverlay();
              overlay.onGif(url);
            }}
            onSticker={(s) => {
              client.closeOverlay();
              overlay.onSticker(s);
            }}
          />
        </Anchored>
      );
    case "confirm":
      return <Confirm {...overlay} />;
  }
}
