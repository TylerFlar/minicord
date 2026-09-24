import type { Channel, Guild, Member, ReadState, Role, ScheduledEvent, UserGuildSettings } from "../types.ts";

/** Guild objects in user READY/GUILD_CREATE may nest their fields under `properties`. */
export interface RawGuild {
  id: string;
  unavailable?: boolean;
  properties?: Partial<Guild> & Record<string, unknown>;
  name?: string;
  icon?: string | null;
  owner_id?: string;
  features?: string[];
  roles?: Role[];
  channels?: Channel[];
  threads?: Channel[];
  emojis?: Guild["emojis"];
  stickers?: Guild["stickers"];
  guild_scheduled_events?: ScheduledEvent[];
  members?: Member[];
  member_count?: number;
  joined_at?: string;
  description?: string | null;
  banner?: string | null;
}

export interface NormalizedGuild {
  guild: Guild;
  channels: Channel[];
  threads: Channel[];
  events: ScheduledEvent[];
}

export function normalizeGuild(raw: RawGuild): NormalizedGuild {
  const p = { ...raw, ...(raw.properties ?? {}) } as RawGuild & Partial<Guild>;
  const guild: Guild = {
    id: raw.id,
    name: (p.name as string) ?? "Unknown server",
    icon: p.icon ?? null,
    ...(p.owner_id ? { owner_id: p.owner_id } : {}),
    roles: raw.roles ?? p.roles ?? [],
    emojis: raw.emojis ?? p.emojis ?? [],
    stickers: raw.stickers ?? p.stickers ?? [],
    features: (p.features as string[]) ?? [],
    ...(raw.member_count !== undefined ? { member_count: raw.member_count } : {}),
    ...(raw.joined_at ? { joined_at: raw.joined_at } : {}),
    description: (p.description as string | null) ?? null,
    banner: (p.banner as string | null) ?? null,
  };
  const withGuild = (c: Channel): Channel => ({ ...c, guild_id: raw.id });
  return {
    guild,
    channels: (raw.channels ?? []).map(withGuild),
    threads: (raw.threads ?? []).map(withGuild),
    events: (raw.guild_scheduled_events ?? []).map((e) => ({ ...e, guild_id: e.guild_id ?? raw.id })),
  };
}

/** READY sends some collections either as arrays or as `{ entries, partial, version }` (versioned capabilities). */
export function entriesOf<T>(value: T[] | { entries?: T[] } | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : (value.entries ?? []);
}

export function channelReadStates(value: ReadState[] | { entries?: ReadState[] } | undefined): ReadState[] {
  return entriesOf(value).filter((r) => !r.read_state_type);
}

export function settingsKey(guildId: string | null | undefined): string {
  return guildId ?? "@me";
}

export type { UserGuildSettings };
