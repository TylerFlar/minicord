import type { Mention } from "../mentions.ts";
import { MessageNotificationLevel } from "../types.ts";
import { modeOf } from "./commitment.ts";
import { quietHoursEnd } from "./time.ts";
import type { RulesConfig } from "./types.ts";

export type NotifyCategory = "dm" | "mention" | "message" | "call";

export type NotifyDecision =
  | { action: "notify"; category: NotifyCategory }
  | { action: "digest"; category: NotifyCategory }
  | { action: "hold"; category: NotifyCategory; until: number }
  | { action: "none"; reason: string };

export interface NotifyInput {
  config: RulesConfig;
  meId: string;
  authorId: string;
  isDM: boolean;
  guildId?: string;
  mention: Mention | null;
  /** DM muted, or guild/channel muted in Discord's own settings. */
  mutedByDiscord: boolean;
  /** Effective Discord notification level for the channel (MessageNotificationLevel). */
  discordLevel?: number;
  authorBlocked: boolean;
  /** The user is looking at this exact channel right now. */
  viewingChannel: boolean;
  now: number;
}

/**
 * Decide whether a new message should interrupt the user. Calm by default:
 * DMs and real pings only; vaulted servers can batch pings into digests;
 * quiet hours hold everything (calls are decided elsewhere).
 */
export function decideNotification(input: NotifyInput): NotifyDecision {
  const { config } = input;
  if (input.authorId === input.meId) return { action: "none", reason: "own message" };
  if (input.authorBlocked) return { action: "none", reason: "blocked" };
  if (input.viewingChannel) return { action: "none", reason: "already viewing" };

  let category: NotifyCategory;
  let digest = false;

  if (input.isDM) {
    if (input.mutedByDiscord) return { action: "none", reason: "dm muted" };
    category = "dm";
  } else {
    if (!input.guildId) return { action: "none", reason: "no guild" };
    const mode = modeOf(config, input.guildId);
    const mention = input.mention;
    if (mention?.pings) {
      if (mode === "vault" && mention.kind === "everyone" && config.vaultIgnoreEveryone) {
        return { action: "none", reason: "@everyone in vault" };
      }
      if (mode === "open" && input.mutedByDiscord) return { action: "none", reason: "server muted" };
      category = "mention";
      digest = mode === "vault" && config.vaultMentionDelivery === "digest";
    } else if (
      mode === "open" &&
      config.openNotify === "discord" &&
      !input.mutedByDiscord &&
      input.discordLevel === MessageNotificationLevel.AllMessages
    ) {
      category = "message";
    } else {
      return { action: "none", reason: "not for you" };
    }
  }

  const quietUntil = quietHoursEnd(config.quietHours, input.now);
  if (quietUntil !== null) return { action: "hold", category, until: quietUntil };
  if (digest) return { action: "digest", category };
  return { action: "notify", category };
}
