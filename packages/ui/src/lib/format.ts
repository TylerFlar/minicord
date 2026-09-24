const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayLong = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });
const dayShort = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const full = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" });
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function sameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

export function formatTime(ms: number): string {
  return time.format(ms);
}

export function formatDay(ms: number, now = Date.now()): string {
  if (sameDay(ms, now)) return "Today";
  if (sameDay(ms, now - 86_400_000)) return "Yesterday";
  return dayLong.format(ms);
}

/** Compact stamp for lists: time today, weekday this week, date otherwise. */
export function formatStamp(ms: number, now = Date.now()): string {
  if (sameDay(ms, now)) return time.format(ms);
  if (now - ms < 6 * 86_400_000) return weekdayShort.format(ms);
  return dayShort.format(ms);
}

export function formatFull(ms: number): string {
  return full.format(ms);
}

export function formatRelative(ms: number, now = Date.now()): string {
  const diff = ms - now;
  const abs = Math.abs(diff);
  if (abs < 60_000) return relative.format(Math.round(diff / 1000), "second");
  if (abs < 3_600_000) return relative.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return relative.format(Math.round(diff / 3_600_000), "hour");
  if (abs < 30 * 86_400_000) return relative.format(Math.round(diff / 86_400_000), "day");
  if (abs < 365 * 86_400_000) return relative.format(Math.round(diff / (30 * 86_400_000)), "month");
  return relative.format(Math.round(diff / (365 * 86_400_000)), "year");
}

/** Discord `<t:unix:format>` timestamps. */
export function formatDiscordTimestamp(unixSeconds: number, format = "f"): string {
  const ms = unixSeconds * 1000;
  const d = new Date(ms);
  switch (format) {
    case "t":
      return time.format(d);
    case "T":
      return d.toLocaleTimeString();
    case "d":
      return d.toLocaleDateString();
    case "D":
      return d.toLocaleDateString(undefined, { dateStyle: "long" });
    case "F":
      return full.format(d);
    case "R":
      return formatRelative(ms);
    default:
      return d.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });
  }
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatDuration(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours >= 1) return `${Math.round(hours)}h`;
  return `${Math.max(1, Math.round(ms / 60_000))}m`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export function eventDateParts(ms: number): { month: string; day: string; weekday: string; time: string } {
  const d = new Date(ms);
  return {
    month: d.toLocaleDateString(undefined, { month: "short" }).toUpperCase(),
    day: String(d.getDate()),
    weekday: weekdayShort.format(d),
    time: time.format(d),
  };
}

/** 0:07, 1:32 — media player clock. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "5 minutes", "2 hours" — for things like call length. */
export function formatSpan(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/** "30 s", "1 min", "4 min" — for pass pauses. */
export function formatPause(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.round(s / 60)} min`;
}
