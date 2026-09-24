import type { Guild, PresenceStatus, User } from "@minicord/core";
import { avatarUrl, guildIconUrl, initials } from "../lib/cdn.ts";
import { STATUS_COLOR, STATUS_LABEL } from "../lib/presence.ts";

export function StatusDot({ status, size = 10, className = "" }: { status: PresenceStatus; size?: number; className?: string }) {
  const hollow = status === "offline" || status === "invisible";
  return (
    <span
      title={STATUS_LABEL[status]}
      className={`block shrink-0 rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        background: hollow ? "var(--avatar-ring, var(--mc-surface))" : STATUS_COLOR[status],
        boxShadow: `inset 0 0 0 ${hollow ? Math.max(2, size / 4) : 0}px ${STATUS_COLOR[status]}`,
      }}
    />
  );
}

/**
 * A user's avatar, optionally with Discord's status dot cut into the corner. The ring
 * takes the colour of `--avatar-ring` (set it where the background isn't the surface).
 */
export function Avatar({ user, size = 32, className = "", status }: { user: User | undefined; size?: number; className?: string; status?: PresenceStatus }) {
  const img = (
    <img
      src={avatarUrl(user, size * 2)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      className={`shrink-0 rounded-full bg-sunken object-cover ${status ? "" : className}`}
      style={{ width: size, height: size }}
    />
  );
  if (!status) return img;
  const dot = Math.max(8, Math.round(size * 0.3));
  return (
    <span className={`relative inline-block shrink-0 ${className}`} style={{ width: size, height: size }}>
      {img}
      <span
        className="absolute rounded-full"
        style={{ right: -2, bottom: -2, padding: Math.max(2, Math.round(size / 16)), background: "var(--avatar-ring, var(--mc-surface))" }}
      >
        <StatusDot status={status} size={dot} />
      </span>
    </span>
  );
}

export function GuildIcon({ guild, size = 24, muted = false }: { guild: Guild; size?: number; muted?: boolean }) {
  const url = guildIconUrl(guild, size * 2);
  const style = { width: size, height: size };
  const filter = muted ? "grayscale opacity-60" : "";
  if (url) return <img src={url} alt="" style={style} className={`shrink-0 rounded-md object-cover ${filter}`} loading="lazy" />;
  return (
    <span
      style={{ ...style, fontSize: Math.max(9, size * 0.38) }}
      className={`inline-flex shrink-0 items-center justify-center rounded-md bg-sunken font-semibold text-muted ${filter}`}
    >
      {initials(guild.name)}
    </span>
  );
}
