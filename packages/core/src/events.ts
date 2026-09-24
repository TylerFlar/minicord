import { ScheduledEventEntityType, ScheduledEventStatus, type ScheduledEvent } from "./types.ts";

const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;

export function eventStart(e: ScheduledEvent): number {
  return Date.parse(e.scheduled_start_time);
}

export function eventEnd(e: ScheduledEvent): number {
  return e.scheduled_end_time ? Date.parse(e.scheduled_end_time) : eventStart(e) + DEFAULT_DURATION_MS;
}

const VIRTUAL_VENUE = /\b(vrchat|online|virtual|zoom|discord|twitch|youtube|google meet|microsoft teams|livestream|stream|minecraft|roblox|steam)\b/i;

/** A place you'd go to, rather than a link or a virtual venue. */
export function isPhysicalLocation(location: string | undefined): boolean {
  const text = location?.trim() ?? "";
  return text.length > 0 && !/^https?:\/\//i.test(text) && !VIRTUAL_VENUE.test(text);
}

/** External events whose location is a place (not a link or a virtual venue) are treated as in person. */
export function isInPerson(e: ScheduledEvent): boolean {
  return e.entity_type === ScheduledEventEntityType.External && isPhysicalLocation(e.entity_metadata?.location);
}

export function isUpcomingOrLive(e: ScheduledEvent, now: number): boolean {
  if (e.status === ScheduledEventStatus.Canceled || e.status === ScheduledEventStatus.Completed) return false;
  return eventEnd(e) > now;
}

export function eventUrl(e: ScheduledEvent): string {
  return `https://discord.com/events/${e.guild_id}/${e.id}`;
}

/** What a calendar needs to know about an event, whether it's a Discord event or posted in a channel. */
export interface CalendarEntry {
  uid: string;
  title: string;
  description?: string;
  start: number;
  end: number;
  location?: string;
  url: string;
}

function asEntry(e: ScheduledEvent | CalendarEntry): CalendarEntry {
  if (!("scheduled_start_time" in e)) return e;
  const location = e.entity_metadata?.location;
  return {
    uid: `${e.id}@discord-events.minicord`,
    title: e.name,
    ...(e.description ? { description: e.description } : {}),
    start: eventStart(e),
    end: eventEnd(e),
    ...(location ? { location } : {}),
    url: eventUrl(e),
  };
}

function calStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function googleCalendarUrl(event: ScheduledEvent | CalendarEntry, guildName?: string): string {
  const e = asEntry(event);
  const details = [e.description ?? "", guildName ? `From ${guildName} on Discord` : "", e.url].filter(Boolean).join("\n\n");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${calStamp(e.start)}/${calStamp(e.end)}`,
    details,
  });
  if (e.location) params.set("location", e.location);
  return `https://calendar.google.com/calendar/render?${params}`;
}

function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
}

/** A single-event iCalendar file (RFC 5545), for any calendar app. */
export function toICS(event: ScheduledEvent | CalendarEntry, guildName?: string, now = Date.now()): string {
  const e = asEntry(event);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//minicord//events//EN",
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${calStamp(now)}`,
    `DTSTART:${calStamp(e.start)}`,
    `DTEND:${calStamp(e.end)}`,
    `SUMMARY:${icsEscape(e.title)}`,
    `DESCRIPTION:${icsEscape([e.description ?? "", guildName ? `From ${guildName} on Discord` : ""].filter(Boolean).join("\n\n"))}`,
    `URL:${e.url}`,
  ];
  if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export type AgendaBucket = "live" | "today" | "tomorrow" | "this-week" | "later";

export function agendaBucket(e: ScheduledEvent, now: number): AgendaBucket {
  return agendaBucketAt(eventStart(e), eventEnd(e), now, e.status === ScheduledEventStatus.Active);
}

/** Agenda bucket for anything with a start and an end. */
export function agendaBucketAt(start: number, end: number, now: number, live = false): AgendaBucket {
  if (live || (start <= now && end > now)) return "live";
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const day = 86_400_000;
  const t = today.getTime();
  if (start < t + day) return "today";
  if (start < t + 2 * day) return "tomorrow";
  if (start < t + 7 * day) return "this-week";
  return "later";
}

export function sortByStart(events: ScheduledEvent[]): ScheduledEvent[] {
  return [...events].sort((a, b) => eventStart(a) - eventStart(b));
}
