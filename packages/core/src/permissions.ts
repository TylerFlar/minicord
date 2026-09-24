import type { Channel, Guild, Member, PermissionOverwrite } from "./types.ts";

export const Permission = {
  CreateInstantInvite: 1n << 0n,
  Administrator: 1n << 3n,
  AddReactions: 1n << 6n,
  ManageMessages: 1n << 13n,
  ViewChannel: 1n << 10n,
  SendMessages: 1n << 11n,
  EmbedLinks: 1n << 14n,
  AttachFiles: 1n << 15n,
  ReadMessageHistory: 1n << 16n,
  MentionEveryone: 1n << 17n,
  UseExternalEmojis: 1n << 18n,
  Connect: 1n << 20n,
  Speak: 1n << 21n,
  SendMessagesInThreads: 1n << 38n,
  PinMessages: 1n << 51n,
} as const;

const ALL = (1n << 64n) - 1n;

function roleMap(guild: Guild): Map<string, bigint> {
  const map = new Map<string, bigint>();
  for (const role of guild.roles) map.set(role.id, BigInt(role.permissions));
  return map;
}

/** Guild-level permissions for a member (before channel overwrites). */
export function basePermissions(guild: Guild, member: Member | undefined, userId: string): bigint {
  if (guild.owner_id === userId) return ALL;
  const roles = roleMap(guild);
  let perms = roles.get(guild.id) ?? 0n; // @everyone role shares the guild id
  for (const roleId of member?.roles ?? []) perms |= roles.get(roleId) ?? 0n;
  return perms & Permission.Administrator ? ALL : perms;
}

function applyOverwrites(
  base: bigint,
  overwrites: PermissionOverwrite[],
  guildId: string,
  member: Member | undefined,
  userId: string,
): bigint {
  let perms = base;
  const everyone = overwrites.find((o) => o.id === guildId);
  if (everyone) perms = (perms & ~BigInt(everyone.deny)) | BigInt(everyone.allow);

  let allow = 0n;
  let deny = 0n;
  const myRoles = new Set(member?.roles ?? []);
  for (const o of overwrites) {
    if (o.type === 0 && myRoles.has(o.id)) {
      allow |= BigInt(o.allow);
      deny |= BigInt(o.deny);
    }
  }
  perms = (perms & ~deny) | allow;

  const own = overwrites.find((o) => o.type === 1 && o.id === userId);
  if (own) perms = (perms & ~BigInt(own.deny)) | BigInt(own.allow);
  return perms;
}

/**
 * Effective permissions in a guild channel. Threads use their parent's overwrites,
 * so pass the parent channel for them (see `permissionChannel`).
 */
export function channelPermissions(
  guild: Guild,
  channel: Channel,
  member: Member | undefined,
  userId: string,
): bigint {
  const base = basePermissions(guild, member, userId);
  if (base === ALL) return ALL;
  const perms = applyOverwrites(base, channel.permission_overwrites ?? [], guild.id, member, userId);

  // Timed-out members can only read.
  const until = member?.communication_disabled_until;
  if (until && Date.parse(until) > Date.now()) {
    return perms & (Permission.ViewChannel | Permission.ReadMessageHistory);
  }
  return perms;
}

export function has(perms: bigint, flag: bigint): boolean {
  return (perms & flag) === flag;
}
