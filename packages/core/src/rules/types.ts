export type GuildMode = "open" | "vault";

export interface QuietHours {
  enabled: boolean;
  /** "HH:MM", local time */
  start: string;
  end: string;
}

export interface RulesConfig {
  /** Mode for servers you haven't sorted yet (e.g. newly joined). */
  defaultMode: GuildMode;
  guildModes: Record<string, GuildMode>;
  /**
   * Channels where a server posts its events (Sesh cards, calendar bots, announcements): readable
   * even when the server is vaulted, and their dated posts join the Events agenda. channelId → guildId.
   */
  eventChannels: Record<string, string>;
  passMinutes: number;
  passExtensionMinutes: number;
  manualPassesPerDay: number;
  /** A manual pass opens only after this pause, then asks again ("still want to go in?"). */
  passPauseSeconds: number;
  /** Each manual pass opened today doubles the next pause. */
  passPauseDoubles: boolean;
  /** How long loosening changes wait before taking effect. */
  cooldownHours: number;
  vaultMentionDelivery: "instant" | "digest";
  /** Don't treat @everyone/@here in vaulted servers as a ping. */
  vaultIgnoreEveryone: boolean;
  /** "mentions": only pings notify in open servers. "discord": follow Discord's per-server setting. */
  openNotify: "mentions" | "discord";
  quietHours: QuietHours;
  /** "HH:MM" local times when held digest items are delivered. */
  digestTimes: string[];
}

export type Change =
  | { kind: "guildMode"; guildId: string; mode: GuildMode }
  | { kind: "defaultMode"; mode: GuildMode }
  | { kind: "eventChannel"; guildId: string; channelId: string; on: boolean }
  | { kind: "passMinutes"; value: number }
  | { kind: "passExtensionMinutes"; value: number }
  | { kind: "manualPassesPerDay"; value: number }
  | { kind: "passPauseSeconds"; value: number }
  | { kind: "passPauseDoubles"; value: boolean }
  | { kind: "cooldownHours"; value: number }
  | {
      kind: "settings";
      patch: Partial<
        Pick<RulesConfig, "vaultMentionDelivery" | "vaultIgnoreEveryone" | "openNotify" | "quietHours" | "digestTimes">
      >;
    };

export interface PendingChange {
  id: string;
  change: Change;
  requestedAt: number;
  effectiveAt: number;
}

export type PassKind = "mention" | "event" | "manual";

export interface Pass {
  id: string;
  guildId: string;
  /** Channel or thread the pass unlocks. */
  channelId: string;
  kind: PassKind;
  reason?: string;
  anchorMessageId?: string;
  startedAt: number;
  endsAt: number;
  extended: boolean;
  endedAt?: number;
  messagesSent: number;
}

/** A manual pass waiting out its pause. */
export interface PassWait {
  id: string;
  guildId: string;
  channelId: string;
  requestedAt: number;
  readyAt: number;
}

export interface RulesState {
  version: 1;
  /** Until onboarding finishes, every change applies immediately. */
  onboarded: boolean;
  config: RulesConfig;
  pending: PendingChange[];
  /** Active passes plus recent history (trimmed). */
  passes: Pass[];
  passRequest?: PassWait;
}

export const DEFAULT_CONFIG: RulesConfig = {
  defaultMode: "vault",
  guildModes: {},
  eventChannels: {},
  passMinutes: 10,
  passExtensionMinutes: 5,
  manualPassesPerDay: 3,
  passPauseSeconds: 60,
  passPauseDoubles: true,
  cooldownHours: 24,
  vaultMentionDelivery: "instant",
  vaultIgnoreEveryone: true,
  openNotify: "mentions",
  quietHours: { enabled: true, start: "23:00", end: "08:00" },
  digestTimes: ["12:00", "18:00"],
};

export function initialRulesState(): RulesState {
  return { version: 1, onboarded: false, config: structuredClone(DEFAULT_CONFIG), pending: [], passes: [] };
}
