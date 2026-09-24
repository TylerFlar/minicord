import type { Channel, Member, Presence } from "../types.ts";

/** Discord's lazily-loaded member sidebar (GUILD_MEMBER_LIST_UPDATE). */
export interface MemberListGroup {
  /** A hoisted role id, "online" or "offline". */
  id: string;
  count: number;
}

export type ListMember = Member & { presence?: Presence & { user?: { id: string } } };

export type MemberListItem = { group: MemberListGroup } | { member: ListMember };

export interface MemberList {
  id: string;
  guildId: string;
  /** Sparse: only the ranges we subscribed to are filled. */
  items: (MemberListItem | undefined)[];
  groups: MemberListGroup[];
  memberCount: number;
  onlineCount: number;
}

export interface MemberListOp {
  op: "SYNC" | "INSERT" | "UPDATE" | "DELETE" | "INVALIDATE";
  range?: [number, number];
  index?: number;
  items?: MemberListItem[];
  item?: MemberListItem;
}

const C1 = 0xcc9e2d51;
const C2 = 0x1b873593;

function mixK(k: number): number {
  k = Math.imul(k, C1);
  k = (k << 15) | (k >>> 17);
  return Math.imul(k, C2);
}

/** MurmurHash3 x86 32-bit over the string's (ASCII) bytes, unsigned. */
export function murmurhash3(key: string, seed = 0): number {
  const tail = key.length & 3;
  const body = key.length - tail;
  let h = seed;
  let i = 0;
  for (; i < body; i += 4) {
    const k =
      (key.charCodeAt(i) & 0xff) |
      ((key.charCodeAt(i + 1) & 0xff) << 8) |
      ((key.charCodeAt(i + 2) & 0xff) << 16) |
      ((key.charCodeAt(i + 3) & 0xff) << 24);
    h ^= mixK(k);
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  let k = 0;
  if (tail >= 3) k ^= (key.charCodeAt(i + 2) & 0xff) << 16;
  if (tail >= 2) k ^= (key.charCodeAt(i + 1) & 0xff) << 8;
  if (tail >= 1) {
    k ^= key.charCodeAt(i) & 0xff;
    h ^= mixK(k);
  }
  h ^= key.length;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const VIEW_CHANNEL = 1n << 10n;

/**
 * The id Discord gives a channel's member list: "everyone" when no overwrite touches
 * VIEW_CHANNEL, otherwise a hash of the overwrites that do (channels that show the
 * same people share a list).
 */
export function memberListId(channel: Channel): string {
  const parts: string[] = [];
  for (const o of channel.permission_overwrites ?? []) {
    if (BigInt(o.allow) & VIEW_CHANNEL) parts.push(`allow:${o.id}`);
    else if (BigInt(o.deny) & VIEW_CHANNEL) parts.push(`deny:${o.id}`);
  }
  return parts.length ? String(murmurhash3(parts.sort().join(","))) : "everyone";
}

export function applyMemberListOps(list: MemberList, ops: MemberListOp[]): void {
  for (const op of ops) {
    switch (op.op) {
      case "SYNC": {
        const [start, end] = op.range ?? [0, -1];
        const items = op.items ?? [];
        for (let i = start; i <= end; i++) list.items[i] = items[i - start];
        break;
      }
      case "INSERT":
        if (op.index !== undefined && op.item) list.items.splice(op.index, 0, op.item);
        break;
      case "UPDATE":
        if (op.index !== undefined && op.item) list.items[op.index] = op.item;
        break;
      case "DELETE":
        if (op.index !== undefined) list.items.splice(op.index, 1);
        break;
      case "INVALIDATE": {
        const [start, end] = op.range ?? [0, -1];
        for (let i = start; i <= end; i++) list.items[i] = undefined;
        break;
      }
    }
  }
  while (list.items.length && list.items[list.items.length - 1] === undefined) list.items.pop();
}
