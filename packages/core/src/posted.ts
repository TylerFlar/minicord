import { ChannelType, type Channel, type Embed, type Message } from "./types.ts";
import type { CalendarEntry } from "./events.ts";
import { compareSnowflakes } from "./util/snowflake.ts";

/**
 * An event announced in a channel post rather than with Discord's events feature: a bot's event
 * card (Sesh), a line in a bot's listing (Sesh, ChronicleBot), or a post like "meet at <t:…>".
 * Only posts carrying Discord timestamps are dated; free-text dates aren't guessed at.
 */
export interface PostedEvent {
  /** The message id, plus `:n` for the n-th line of a listing. */
  id: string;
  guildId: string;
  channelId: string;
  messageId: string;
  title: string;
  start: number;
  end: number;
  location?: string;
  /** Markdown, as posted. */
  description?: string;
  /** Where a listing line points: a Discord message or event, or an outside calendar page. */
  link?: string;
}

const STAMP = /<t:(-?\d{1,13})(?::[tTdDfFR])?>/g;
const LINK = /\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/;
const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;
const TIME_FIELD = /^(time|when|date|starts?|start time|date & time|date and time)$/i;
const LOCATION_FIELD = /^(location|where|venue|place|address)$/i;

const STAMP_RANGE = /<t:-?\d{1,13}(?::[tTdDfFR])?>\s*(?:-|–|—|to|until|till)\s*<t:-?\d{1,13}(?::[tTdDfFR])?>/gi;

/** Plain text for titles: no emoji, mentions, times or markdown, nor the "at"/"-" a removed time leaves behind. */
function plain(text: string): string {
  return text
    .replace(STAMP_RANGE, " ")
    .replace(STAMP, " ")
    .replace(/<a?:\w+:\d+>/g, " ")
    .replace(/:[a-z0-9_+-]+:/gi, " ")
    .replace(/<@[!&]?\d+>|<#\d+>/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_~`|>#]+/g, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(?:\s+(?:at|on|from|@))+$|[\s\-–—:,(]+$/i, "")
    .trim();
}

function firstLine(text: string | undefined): { title: string; rest: string } {
  const lines = (text ?? "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const title = plain(lines[i]!);
    if (title.replace(/[^\p{L}\p{N}]/gu, "").length >= 2) return { title, rest: lines.slice(i + 1).join("\n").trim() };
  }
  return { title: "", rest: "" };
}

/** The first timestamp, and the second when it's written as a range ("<t:a> - <t:b>", "<t:a> to <t:b>"). */
function timeRange(text: string): { start: number; end?: number } | null {
  const stamps = [...text.matchAll(STAMP)];
  const first = stamps[0];
  if (!first) return null;
  const start = Number(first[1]) * 1000;
  const second = stamps[1];
  if (second) {
    const between = text.slice(first.index + first[0].length, second.index);
    const end = Number(second[1]) * 1000;
    if (/^\s*(?:-|–|—|to|until|till)\s*$/i.test(between) && end > start) return { start, end };
  }
  return { start };
}

/** "3 hours, 30 minutes", "90 min", "1.5h". */
function duration(text: string): number | null {
  const hours = /(\d+(?:\.\d+)?)\s*(?:h|hrs?|hours?)\b/i.exec(text);
  const minutes = /(\d+)\s*(?:m|mins?|minutes?)\b/i.exec(text);
  if (!hours && !minutes) return null;
  return ((hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0)) * 60_000;
}

function location(value: string): string | undefined {
  const text = value
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .split("\n")
    .map((l) => l.replace(/[*_`>]+/g, "").trim())
    .filter(Boolean)
    .join(", ");
  return text || undefined;
}

function fieldNamed(embed: Embed, pattern: RegExp): { name: string; value: string } | undefined {
  return embed.fields?.find((f) => pattern.test(plain(f.name)));
}

/** A bot's event card: one event, its time in a field ("Time", "When"…). */
function card(embed: Embed, message: Message): Omit<PostedEvent, "id" | "guildId" | "channelId" | "messageId"> | null {
  const time = fieldNamed(embed, TIME_FIELD);
  const range = time ? timeRange(time.value) : null;
  if (!range) return null;
  const length = duration(fieldNamed(embed, /^duration$/i)?.value ?? "");
  const where = fieldNamed(embed, LOCATION_FIELD);
  const place = where ? location(where.value) : undefined;
  return {
    title: plain(embed.title ?? "") || firstLine(message.content).title || "Event",
    start: range.start,
    end: range.end ?? range.start + (length ?? DEFAULT_DURATION_MS),
    ...(place ? { location: place } : {}),
    ...(embed.description?.trim() ? { description: embed.description.trim() } : {}),
  };
}

/** A listing: lines that each link to an event and carry its time. */
function listing(embed: Embed): { title: string; start: number; end: number; link: string }[] {
  const lines = [embed.description ?? "", ...(embed.fields ?? []).map((f) => f.value)].flatMap((v) => v.split("\n"));
  const events: { title: string; start: number; end: number; link: string }[] = [];
  for (const line of lines) {
    const link = LINK.exec(line);
    const range = timeRange(line);
    if (!link || !range) continue;
    const title = plain(link[1]!);
    if (title) events.push({ title, start: range.start, end: range.end ?? range.start + DEFAULT_DURATION_MS, link: link[2]! });
  }
  return events;
}

/** Every dated event a message announces. */
export function postedEvents(message: Message, guildId: string): PostedEvent[] {
  const base = { guildId, channelId: message.channel_id, messageId: message.id };
  const events: PostedEvent[] = [];
  const add = (e: Omit<PostedEvent, "id" | "guildId" | "channelId" | "messageId">) =>
    events.push({ ...base, id: events.length ? `${message.id}:${events.length}` : message.id, ...e });

  for (const embed of message.embeds ?? []) {
    const single = card(embed, message);
    if (single) {
      add(single);
      continue;
    }
    const lines = listing(embed);
    if (lines.length) {
      for (const line of lines) add(line);
      continue;
    }
    const range = timeRange(embed.description ?? "");
    const title = plain(embed.title ?? "");
    if (range && title) {
      add({ title, start: range.start, end: range.end ?? range.start + DEFAULT_DURATION_MS, description: embed.description!.trim() });
    }
  }
  if (!events.length) {
    const range = timeRange(message.content ?? "");
    const { title, rest } = firstLine(message.content);
    if (range && title) add({ title, start: range.start, end: range.end ?? range.start + DEFAULT_DURATION_MS, ...(rest ? { description: rest } : {}) });
  }
  return events;
}

const DISCORD_EVENT = /^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/events\/\d+\/(\d+)/;
const DISCORD_MESSAGE = /^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/channels\/\d+\/\d+\/(\d+)/;

/**
 * One entry per event: listing lines that point at a Discord event we already know, or at a card
 * we also parsed, are dropped, and repeats (the same title at the same time, e.g. in every weekly
 * listing) keep only the newest post.
 */
export function dedupePostedEvents(events: PostedEvent[], isKnownEvent: (eventId: string) => boolean): PostedEvent[] {
  const cards = new Set(events.filter((e) => !e.link).map((e) => e.messageId));
  const best = new Map<string, PostedEvent>();
  for (const e of events) {
    const discordEvent = e.link ? DISCORD_EVENT.exec(e.link)?.[1] : undefined;
    if (discordEvent && isKnownEvent(discordEvent)) continue;
    const linkedMessage = e.link ? DISCORD_MESSAGE.exec(e.link)?.[1] : undefined;
    if (linkedMessage && cards.has(linkedMessage)) continue;
    const key = `${e.title.toLowerCase()}|${e.start}`;
    const seen = best.get(key);
    if (!seen || compareSnowflakes(e.messageId, seen.messageId) > 0) best.set(key, e);
  }
  return [...best.values()].sort((a, b) => a.start - b.start);
}

const EVENTISH = /event|calendar|meet[- ]?ups?|\bmeets?\b|hangouts?|happenings?|upcoming|schedule|rsvp|\bplans\b|furmeet|outings?|gatherings?/i;
const NOT_EVENTS = /staff|\bmods?\b|moderat|admin|logs?\b|\bbots?\b|tips|suggest|test|archive|verif/i;
/** Plain chat channels, even when their topic mentions plans. */
const CHAT = /^(general|chat|off-?topic|lounge|random|memes?|intros?|introductions?|welcome|rules)$/i;

/** How strongly a channel looks like where a server posts its events (0 = not at all). */
export function eventChannelScore(channel: Channel): number {
  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) return 0;
  const name = channel.name ?? "";
  if (NOT_EVENTS.test(name) || CHAT.test(name.replace(/^[^\p{L}\p{N}]+/u, ""))) return 0;
  let score = EVENTISH.test(name) ? 3 : EVENTISH.test(channel.topic ?? "") ? 2 : 0;
  if (/announce/i.test(name)) score += 1;
  if (channel.type === ChannelType.GuildAnnouncement) score += 1;
  return score >= 2 ? score : 0;
}

export function postedEventUrl(e: PostedEvent): string {
  return `https://discord.com/channels/${e.guildId}/${e.channelId}/${e.messageId}`;
}

export function postedCalendarEntry(e: PostedEvent): CalendarEntry {
  return {
    uid: `${e.id}@discord-posts.minicord`,
    title: e.title,
    ...(e.description ? { description: e.description } : {}),
    start: e.start,
    end: e.end,
    ...(e.location ? { location: e.location } : {}),
    url: postedEventUrl(e),
  };
}
