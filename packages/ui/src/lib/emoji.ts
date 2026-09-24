import type { Emoji, Guild, Store } from "@minicord/core";
import { useEffect, useState } from "react";

export interface EmojiEntry {
  emoji: string;
  /** Shortcodes without colons; the first is the display name. */
  names: string[];
  keywords: string;
  group: number;
}

export interface EmojiData {
  list: EmojiEntry[];
  byName: Map<string, EmojiEntry>;
  /** Keyed without U+FE0F so either form matches. */
  byEmoji: Map<string, EmojiEntry>;
}

export const EMOJI_GROUPS: { id: number; label: string; icon: string }[] = [
  { id: 0, label: "Smileys & Emotion", icon: "😀" },
  { id: 1, label: "People", icon: "👋" },
  { id: 3, label: "Nature", icon: "🌿" },
  { id: 4, label: "Food & Drink", icon: "🍔" },
  { id: 5, label: "Travel & Places", icon: "🚗" },
  { id: 6, label: "Activities", icon: "⚽" },
  { id: 7, label: "Objects", icon: "💡" },
  { id: 8, label: "Symbols", icon: "❤️" },
  { id: 9, label: "Flags", icon: "🏁" },
];

export const DEFAULT_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

let loading: Promise<EmojiData> | null = null;
let loaded: EmojiData | null = null;
const bare = (s: string) => s.replace(/️/g, "");

/** The emoji table is ~180 KB, so it's its own chunk, loaded the first time something needs it. */
export function loadEmoji(): Promise<EmojiData> {
  loading ??= import("./emoji-data.json").then((mod) => {
    const rows = mod.default as unknown as [string, string, string, number][];
    const list = rows.map(([emoji, names, keywords, group]) => ({ emoji, names: names.split(" "), keywords, group }));
    const byName = new Map<string, EmojiEntry>();
    const byEmoji = new Map<string, EmojiEntry>();
    for (const e of list) {
      for (const n of e.names) if (!byName.has(n)) byName.set(n, e);
      byEmoji.set(bare(e.emoji), e);
    }
    loaded = { list, byName, byEmoji };
    return loaded;
  });
  return loading;
}

export function useEmojiData(): EmojiData | null {
  const [data, setData] = useState(loaded);
  useEffect(() => {
    if (!data) void loadEmoji().then(setData);
  }, [data]);
  return data;
}

export function emojiName(data: EmojiData | null, emoji: string): string | undefined {
  return data?.byEmoji.get(bare(emoji))?.names[0];
}

/** Name-prefix matches first, then name-substring, then keyword matches. */
export function searchEmoji(data: EmojiData, query: string, limit = 60): EmojiEntry[] {
  const q = query.toLowerCase().replace(/^:|:$/g, "");
  if (!q) return [];
  const prefix: EmojiEntry[] = [];
  const inner: EmojiEntry[] = [];
  const keyword: EmojiEntry[] = [];
  for (const e of data.list) {
    if (e.names.some((n) => n.startsWith(q))) prefix.push(e);
    else if (e.names.some((n) => n.includes(q))) inner.push(e);
    else if (e.keywords.includes(q)) keyword.push(e);
  }
  return [...prefix, ...inner, ...keyword].slice(0, limit);
}

export interface CustomEmojiGroup {
  guild: Guild;
  emojis: (Emoji & { id: string; name: string })[];
}

/**
 * Custom emoji you can actually use: the current server's static emoji, plus everything
 * (animated, other servers) with Nitro — same rules as Discord.
 */
export function usableCustomEmoji(store: Store, guildId: string | undefined): CustomEmojiGroup[] {
  const premium = (store.me?.premium_type ?? 0) > 0;
  const current = guildId ? store.guilds.get(guildId) : undefined;
  const guilds = current ? [current, ...store.sortedGuilds().filter((g) => g.id !== current.id)] : store.sortedGuilds();
  return guilds
    .filter((g) => premium || g.id === guildId)
    .map((guild) => ({
      guild,
      emojis: (guild.emojis ?? []).filter(
        (e): e is Emoji & { id: string; name: string } => !!e.id && !!e.name && e.available !== false && (premium || !e.animated),
      ),
    }))
    .filter((g) => g.emojis.length > 0);
}

export function customEmojiText(e: { id: string; name: string; animated?: boolean }): string {
  return `<${e.animated ? "a" : ""}:${e.name}:${e.id}>`;
}

/** Split into [text, code, text, code, ...] so replacements can skip code spans. */
export function outsideCode(text: string, fn: (plain: string) => string): string {
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, i) => (i % 2 ? part : fn(part)))
    .join("");
}

/** :shortcode: → unicode emoji, or a usable custom emoji; unknown names stay as typed. */
export function replaceShortcodes(data: EmojiData, text: string, custom: CustomEmojiGroup[] = []): string {
  return outsideCode(text, (plain) =>
    plain.replace(/(?<!<a?):([\w+-]{2,}):(?!\d+>)/g, (match, name: string) => {
      const unicode = data.byName.get(name.toLowerCase());
      if (unicode) return unicode.emoji;
      for (const g of custom) {
        const e = g.emojis.find((x) => x.name === name);
        if (e) return customEmojiText(e);
      }
      return match;
    }),
  );
}
