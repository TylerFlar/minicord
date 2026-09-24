import type { InteractionModal, Message } from "@minicord/core";
import type { ReactNode } from "react";

export interface PickedEmoji {
  id: string | null;
  name: string;
  animated?: boolean;
  /** What goes into a message: the unicode character, or <:name:id> for custom emoji. */
  text: string;
}

export type MenuEntry =
  | { label: string; icon?: ReactNode; leading?: ReactNode; checked?: boolean; danger?: boolean; onSelect: () => void }
  | { separator: true }
  | { reactions: true; onPick: (emoji: PickedEmoji) => void; onMore: () => void };

/** One floating thing at a time: menus, pickers, cards and viewers share this slot. */
export type Overlay =
  | { kind: "menu"; x: number; y: number; items: MenuEntry[] }
  | { kind: "emoji"; x: number; y: number; guildId?: string; onPick: (emoji: PickedEmoji) => void }
  | { kind: "profile"; x: number; y: number; userId: string; guildId?: string }
  | { kind: "media"; url: string; media: "image" | "video"; original: string }
  | { kind: "pins"; channelId: string }
  | { kind: "threads"; channelId: string }
  | { kind: "switcher" }
  | { kind: "search"; channelId: string; guildId?: string }
  | { kind: "forward"; message: Message }
  | { kind: "modal"; modal: InteractionModal }
  | { kind: "members"; channelId: string }
  | {
      kind: "expressions";
      x: number;
      y: number;
      tab: "gif" | "sticker" | "emoji";
      guildId?: string;
      onEmoji: (emoji: PickedEmoji) => void;
      onGif: (url: string) => void;
      onSticker: (sticker: { id: string; name: string; format_type: number }) => void;
    }
  | { kind: "confirm"; title: string; body?: string; action: string; danger?: boolean; run: () => void };

/** Recent-emoji strings are either a unicode emoji or a <:name:id> token. */
export function parseEmojiText(text: string): PickedEmoji {
  const m = /^<(a?):(\w+):(\d+)>$/.exec(text);
  return m ? { id: m[3]!, name: m[2]!, animated: m[1] === "a", text } : { id: null, name: text, text };
}

/** Where to anchor an overlay opened from a click or context-menu event. */
export function pointFrom(e: { clientX: number; clientY: number; currentTarget?: EventTarget | null }, preferElement = false) {
  const el = e.currentTarget as HTMLElement | null;
  if (preferElement && el?.getBoundingClientRect) {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.bottom + 4 };
  }
  return { x: e.clientX, y: e.clientY };
}
