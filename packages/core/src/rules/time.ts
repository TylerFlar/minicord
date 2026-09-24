import type { QuietHours } from "./types.ts";

function parseHHMM(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function atMinutes(base: Date, minutes: number, dayOffset = 0): number {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + dayOffset);
  d.setMinutes(minutes);
  return d.getTime();
}

export function startOfLocalDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** If `now` falls inside quiet hours, returns when they end; otherwise null. Handles windows spanning midnight. */
export function quietHoursEnd(quiet: QuietHours, now: number): number | null {
  if (!quiet.enabled) return null;
  const start = parseHHMM(quiet.start);
  const end = parseHHMM(quiet.end);
  if (start === end) return null;
  const date = new Date(now);
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (start < end) {
    return minutes >= start && minutes < end ? atMinutes(date, end) : null;
  }
  if (minutes >= start) return atMinutes(date, end, 1);
  if (minutes < end) return atMinutes(date, end);
  return null;
}

/** The next digest delivery time strictly after `now`. */
export function nextDigestTime(times: string[], now: number): number | null {
  if (times.length === 0) return null;
  const date = new Date(now);
  const candidates = times.flatMap((t) => [atMinutes(date, parseHHMM(t)), atMinutes(date, parseHHMM(t), 1)]);
  return Math.min(...candidates.filter((c) => c > now));
}
