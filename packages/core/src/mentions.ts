import type { Message, UserGuildSettings } from "./types.ts";

export type MentionKind = "user" | "reply" | "role" | "everyone";

export interface Mention {
  kind: MentionKind;
  /** Whether Discord would treat this as a ping (a non-ping reply still shows in the inbox). */
  pings: boolean;
}

export interface MentionContext {
  meId: string;
  myRoleIds(guildId: string): readonly string[];
  guildSettings(guildId: string): UserGuildSettings | undefined;
}

/** Classify how (if at all) a message is directed at the current user. */
export function classifyMention(msg: Message, ctx: MentionContext): Mention | null {
  if (msg.author?.id === ctx.meId) return null;

  const repliesToMe = msg.referenced_message?.author?.id === ctx.meId;
  if (msg.mentions?.some((u) => u.id === ctx.meId)) {
    // Replies with "ping" on add the replied-to author to `mentions`.
    const content = msg.content ?? "";
    const explicit = content.includes(`<@${ctx.meId}>`) || content.includes(`<@!${ctx.meId}>`);
    return { kind: repliesToMe && !explicit ? "reply" : "user", pings: true };
  }

  const guildId = msg.guild_id;
  if (guildId) {
    const settings = ctx.guildSettings(guildId);
    if (!settings?.suppress_roles && msg.mention_roles?.length) {
      const mine = ctx.myRoleIds(guildId);
      if (msg.mention_roles.some((r) => mine.includes(r))) return { kind: "role", pings: true };
    }
    if (msg.mention_everyone && !settings?.suppress_everyone) return { kind: "everyone", pings: true };
  }

  if (repliesToMe) return { kind: "reply", pings: false };
  return null;
}
