export type Route =
  | { view: "inbox" }
  | { view: "dms"; channelId?: string; anchor?: string }
  | { view: "friends" }
  /** `list` shows the channel list instead of reopening the last channel (phone layout). */
  | { view: "server"; guildId: string; channelId?: string; anchor?: string; list?: boolean }
  | { view: "vault"; guildId: string }
  | { view: "servers" }
  | { view: "events" }
  | { view: "settings" }
  | { view: "onboarding" };
