import { ScheduledEventEntityType, ScheduledEventStatus, type ScheduledEvent } from "./types.ts";

const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;

export function eventStart(e: ScheduledEvent): number {
  return Date.parse(e.scheduled_start_time);
}

export function eventEnd(e: ScheduledEvent): number {
  return e.scheduled_end_time ? Date.parse(e.scheduled_end_time) : eventStart(e) + DEFAULT_DURATION_MS;
}

const VIRTUAL_VENUE = /\b(vrchat|online|virtual|zoom|discord|twitch|youtube|google meet|microsoft teams|livestream|stream|minecraft|roblox|steam)\b/i;

/** External events whose location is a place (not a link or a virtual venue) are treated as in person. */
export function isInPerson(e: ScheduledEvent): boolean {
  if (e.entity_type !== ScheduledEventEntityType.External) return false;
  const location = e.entity_metadata?.location?.trim() ?? "";
  return location.length > 0 && !/^https?:\/\//i.test(location) && !VIRTUAL_VENUE.test(location);
}

export function isUpcomingOrLive(e: ScheduledEvent, now: number): boolean {
  if (e.status === ScheduledEventStatus.Canceled || e.status === ScheduledEventStatus.Completed) return false;
  return eventEnd(e) > now;
}

export function eventUrl(e: ScheduledEvent): string {
  return `https://discord.com/events/${e.guild_id}/${e.id}`;
}

function calStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function googleCalendarUrl(e: ScheduledEvent, guildName?: string): string {
  const details = [e.description ?? "", guildName ? `From ${guildName} on Discord` : "", eventUrl(e)]
    .filter(Boolean)
    .join("\n\n");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: e.name,
    dates: `${calStamp(eventStart(e))}/${calStamp(eventEnd(e))}`,
    details,
  });
  const location = e.entity_metadata?.location;
  if (location) params.set("location", location);
  return `https://calendar.google.com/calendar/render?${params}`;
}

function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
}

/** A single-event iCalendar file (RFC 5545), for any calendar app. */
export function toICS(e: ScheduledEvent, guildName?: string, now = Date.now()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//minicord//events//EN",
    "BEGIN:VEVENT",
    `UID:${e.id}@discord-events.minicord`,
    `DTSTAMP:${calStamp(now)}`,
    `DTSTART:${calStamp(eventStart(e))}`,
    `DTEND:${calStamp(eventEnd(e))}`,
    `SUMMARY:${icsEscape(e.name)}`,
    `DESCRIPTION:${icsEscape([e.description ?? "", guildName ? `From ${guildName} on Discord` : ""].filter(Boolean).join("\n\n"))}`,
    `URL:${eventUrl(e)}`,
  ];
  const location = e.entity_metadata?.location;
  if (location) lines.push(`LOCATION:${icsEscape(location)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export type AgendaBucket = "live" | "today" | "tomorrow" | "this-week" | "later";

export function agendaBucket(e: ScheduledEvent, now: number): AgendaBucket {
  const start = eventStart(e);
  if (e.status === ScheduledEventStatus.Active || (start <= now && eventEnd(e) > now)) return "live";
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
