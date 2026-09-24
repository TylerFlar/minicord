import type { Presence, PresenceStatus } from "@minicord/core";

export const STATUS_LABEL: Record<PresenceStatus, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do Not Disturb",
  invisible: "Invisible",
  offline: "Offline",
};

/** Dot colours (Discord's meanings, in this app's palette). */
export const STATUS_COLOR: Record<PresenceStatus, string> = {
  online: "var(--mc-online)",
  idle: "var(--mc-idle)",
  dnd: "var(--mc-danger)",
  invisible: "var(--mc-faint)",
  offline: "var(--mc-faint)",
};

const VERBS: Record<number, string> = { 0: "Playing", 1: "Streaming", 2: "Listening to", 3: "Watching", 5: "Competing in" };

/** The one line Discord shows under a name: custom status first, else what they're doing. */
export function activityText(presence: Presence | undefined): string | undefined {
  const activities = presence?.activities ?? [];
  const custom = activities.find((a) => a.type === 4);
  if (custom && (custom.state || custom.emoji)) return [custom.emoji?.id ? "" : custom.emoji?.name, custom.state].filter(Boolean).join(" ");
  const other = activities.find((a) => a.type !== 4);
  if (!other) return undefined;
  if (other.type === 2 && other.name === "Spotify") return `Listening to ${other.details ?? "Spotify"}`;
  return `${VERBS[other.type] ?? ""} ${other.name}`.trim();
}

export function effectiveStatus(presence: Presence | undefined): PresenceStatus {
  const s = presence?.status;
  return s === "online" || s === "idle" || s === "dnd" ? s : "offline";
}
