/**
 * The subset of Discord's user-API object shapes minicord relies on.
 * Field names match the wire format so gateway/REST payloads can be stored as-is.
 */

export type Snowflake = string;

export const ChannelType = {
  GuildText: 0,
  DM: 1,
  GuildVoice: 2,
  GroupDM: 3,
  GuildCategory: 4,
  GuildAnnouncement: 5,
  AnnouncementThread: 10,
  PublicThread: 11,
  PrivateThread: 12,
  GuildStageVoice: 13,
  GuildDirectory: 14,
  GuildForum: 15,
  GuildMedia: 16,
} as const;
export type ChannelTypeValue = (typeof ChannelType)[keyof typeof ChannelType];

export interface User {
  id: Snowflake;
  username: string;
  global_name?: string | null;
  discriminator?: string;
  avatar?: string | null;
  bot?: boolean;
  system?: boolean;
  /** 0 none, 1 Nitro Classic, 2 Nitro, 3 Nitro Basic */
  premium_type?: number;
}

export interface Role {
  id: Snowflake;
  name: string;
  permissions: string;
  position: number;
  color?: number;
  colors?: { primary_color: number };
  managed?: boolean;
  mentionable?: boolean;
  hoist?: boolean;
}

export interface PermissionOverwrite {
  id: Snowflake;
  /** 0 = role, 1 = member */
  type: 0 | 1;
  allow: string;
  deny: string;
}

export interface ThreadMetadata {
  archived: boolean;
  auto_archive_duration?: number;
  archive_timestamp?: string;
  locked?: boolean;
}

export interface Channel {
  id: Snowflake;
  type: number;
  guild_id?: Snowflake;
  name?: string | null;
  topic?: string | null;
  position?: number;
  parent_id?: Snowflake | null;
  permission_overwrites?: PermissionOverwrite[];
  last_message_id?: Snowflake | null;
  last_pin_timestamp?: string | null;
  /** DMs / group DMs (deduplicated form in READY) */
  recipient_ids?: Snowflake[];
  recipients?: User[];
  owner_id?: Snowflake;
  icon?: string | null;
  nsfw?: boolean;
  flags?: number;
  rate_limit_per_user?: number;
  thread_metadata?: ThreadMetadata;
  member_count?: number;
  message_count?: number;
  applied_tags?: Snowflake[];
  available_tags?: { id: Snowflake; name: string; emoji_name?: string | null }[];
}

export interface Emoji {
  id: Snowflake | null;
  name: string | null;
  animated?: boolean;
  /** false when the server lost the boost level that unlocked it */
  available?: boolean;
}

export interface Guild {
  id: Snowflake;
  name: string;
  icon?: string | null;
  owner_id?: Snowflake;
  roles: Role[];
  emojis?: Emoji[];
  stickers?: Sticker[];
  features?: string[];
  member_count?: number;
  description?: string | null;
  banner?: string | null;
  unavailable?: boolean;
  joined_at?: string;
}

export interface Sticker {
  id: Snowflake;
  name: string;
  /** 1 png, 2 apng, 3 lottie, 4 gif */
  format_type: number;
  description?: string | null;
  tags?: string;
  available?: boolean;
  guild_id?: Snowflake;
}

export interface Member {
  user?: User;
  user_id?: Snowflake;
  roles: Snowflake[];
  nick?: string | null;
  avatar?: string | null;
  joined_at?: string;
  communication_disabled_until?: string | null;
}

export interface Attachment {
  id: Snowflake;
  filename: string;
  size: number;
  url: string;
  proxy_url: string;
  content_type?: string;
  width?: number | null;
  height?: number | null;
  description?: string | null;
  flags?: number;
  duration_secs?: number;
  /** Base64 amplitude samples (voice messages). */
  waveform?: string;
  placeholder?: string;
}

export interface EmbedMedia {
  url: string;
  proxy_url?: string;
  width?: number;
  height?: number;
}

export interface Embed {
  type?: string;
  title?: string;
  description?: string;
  url?: string;
  timestamp?: string;
  color?: number;
  footer?: { text: string; icon_url?: string; proxy_icon_url?: string };
  image?: EmbedMedia;
  thumbnail?: EmbedMedia;
  video?: EmbedMedia;
  provider?: { name?: string; url?: string };
  author?: { name: string; url?: string; icon_url?: string; proxy_icon_url?: string };
  fields?: { name: string; value: string; inline?: boolean }[];
}

export interface Reaction {
  emoji: Emoji;
  count: number;
  me: boolean;
  burst_count?: number;
  me_burst?: boolean;
  count_details?: { normal: number; burst: number };
}

export interface MessageReference {
  type?: number;
  message_id?: Snowflake;
  channel_id?: Snowflake;
  guild_id?: Snowflake;
}

export interface StickerItem {
  id: Snowflake;
  name: string;
  /** 1 png, 2 apng, 3 lottie, 4 gif */
  format_type: number;
}

export interface Message {
  id: Snowflake;
  channel_id: Snowflake;
  guild_id?: Snowflake;
  author: User;
  member?: Member;
  content: string;
  timestamp: string;
  edited_timestamp?: string | null;
  tts?: boolean;
  mention_everyone: boolean;
  mentions: User[];
  mention_roles: Snowflake[];
  attachments: Attachment[];
  embeds: Embed[];
  reactions?: Reaction[];
  nonce?: string | number;
  pinned?: boolean;
  type: number;
  flags?: number;
  message_reference?: MessageReference;
  referenced_message?: Message | null;
  sticker_items?: StickerItem[];
  thread?: Channel;
  call?: { participants: Snowflake[]; ended_timestamp?: string | null };
  poll?: Poll;
  /** Forwarded messages carry a copy of the original. */
  message_snapshots?: { message: Partial<Message> & { content?: string; attachments?: Attachment[]; embeds?: Embed[] } }[];
  interaction_metadata?: { name?: string; user?: User };
  application_id?: Snowflake;
  components?: Component[];
}

// ---- message components (buttons, selects, modals, components v2) ----------

export interface ButtonComponent {
  type: 2;
  /** 1 primary, 2 secondary, 3 success, 4 danger, 5 link, 6 premium */
  style: number;
  label?: string;
  emoji?: Emoji;
  custom_id?: string;
  url?: string;
  disabled?: boolean;
}

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
  emoji?: Emoji;
  default?: boolean;
}

export interface SelectComponent {
  /** 3 string, 5 user, 6 role, 7 mentionable, 8 channel */
  type: 3 | 5 | 6 | 7 | 8;
  custom_id: string;
  options?: SelectOption[];
  placeholder?: string;
  min_values?: number;
  max_values?: number;
  disabled?: boolean;
  required?: boolean;
}

export interface TextInputComponent {
  type: 4;
  custom_id: string;
  /** 1 short, 2 paragraph */
  style: number;
  label?: string;
  placeholder?: string;
  value?: string;
  required?: boolean;
  min_length?: number;
  max_length?: number;
}

export interface UnfurledMedia {
  url: string;
  proxy_url?: string;
  width?: number | null;
  height?: number | null;
  content_type?: string;
}

export type Component =
  | { type: 1; components: Component[] }
  | ButtonComponent
  | SelectComponent
  | TextInputComponent
  | { type: 9; components: Component[]; accessory?: Component }
  | { type: 10; content: string }
  | { type: 11; media: UnfurledMedia; description?: string | null; spoiler?: boolean }
  | { type: 12; items: { media: UnfurledMedia; description?: string | null; spoiler?: boolean }[] }
  | { type: 13; file: UnfurledMedia; spoiler?: boolean; name?: string; size?: number }
  | { type: 14; divider?: boolean; spacing?: number }
  | { type: 17; components: Component[]; accent_color?: number | null; spoiler?: boolean }
  | { type: 18; label: string; description?: string; component: Component };

// ---- application (slash) commands ------------------------------------------

export interface CommandOption {
  /** 1 subcommand, 2 group, 3 string, 4 integer, 5 boolean, 6 user, 7 channel, 8 role, 9 mentionable, 10 number, 11 attachment */
  type: number;
  name: string;
  description?: string;
  required?: boolean;
  choices?: { name: string; value: string | number }[];
  options?: CommandOption[];
  autocomplete?: boolean;
  channel_types?: number[];
  min_value?: number;
  max_value?: number;
  min_length?: number;
  max_length?: number;
}

export interface ApplicationCommand {
  id: Snowflake;
  application_id: Snowflake;
  version: Snowflake;
  /** 1 chat input (slash), 2 user, 3 message */
  type: number;
  name: string;
  description: string;
  options?: CommandOption[];
  dm_permission?: boolean;
  nsfw?: boolean;
}

export interface CommandApplication {
  id: Snowflake;
  name: string;
  icon?: string | null;
  description?: string;
  bot_id?: Snowflake;
}

export interface CommandIndex {
  applications: CommandApplication[];
  application_commands: ApplicationCommand[];
}

/** A modal a bot opened in response to one of your interactions (INTERACTION_MODAL_CREATE). */
export interface InteractionModal {
  id: Snowflake;
  nonce?: string;
  channel_id: Snowflake;
  guild_id?: Snowflake;
  custom_id: string;
  title: string;
  components: Component[];
  application: { id: Snowflake; name: string; icon?: string | null };
}

// ---- presence ----------------------------------------------------------------

export type PresenceStatus = "online" | "idle" | "dnd" | "offline" | "invisible";

export interface Activity {
  /** 0 playing, 1 streaming, 2 listening, 3 watching, 4 custom status, 5 competing */
  type: number;
  name: string;
  state?: string | null;
  details?: string | null;
  emoji?: { name: string; id?: string | null; animated?: boolean } | null;
}

export interface Presence {
  status: PresenceStatus;
  activities?: Activity[];
  client_status?: { desktop?: string; mobile?: string; web?: string };
}

export interface PollAnswer {
  answer_id: number;
  poll_media: { text?: string; emoji?: Emoji };
}

export interface Poll {
  question: { text?: string };
  answers: PollAnswer[];
  expiry?: string | null;
  allow_multiselect?: boolean;
  results?: { is_finalized: boolean; answer_counts: { id: number; count: number; me_voted: boolean }[] };
}

export interface VoiceState {
  user_id: Snowflake;
  channel_id: Snowflake | null;
  guild_id?: Snowflake;
  self_mute?: boolean;
  self_deaf?: boolean;
  mute?: boolean;
  deaf?: boolean;
  self_video?: boolean;
  self_stream?: boolean;
  member?: Member;
}

export interface UserProfile {
  user: User & { bio?: string; banner?: string | null; accent_color?: number | null };
  user_profile?: { bio?: string; pronouns?: string; accent_color?: number | null };
  guild_member?: Member;
  guild_member_profile?: { bio?: string; pronouns?: string };
}

export interface ReadState {
  /** channel id (or guild id for non-channel read states) */
  id: Snowflake;
  last_message_id?: Snowflake | 0 | null;
  mention_count?: number;
  last_pin_timestamp?: string | null;
  flags?: number;
  /** 0 = channel; other values are guild events, notification center, etc. */
  read_state_type?: number;
  badge_count?: number;
  last_acked_id?: Snowflake;
}

export const MessageNotificationLevel = {
  AllMessages: 0,
  OnlyMentions: 1,
  NoMessages: 2,
  ParentDefault: 3,
} as const;

export interface ChannelOverride {
  channel_id: Snowflake;
  muted: boolean;
  mute_config?: { end_time: string | null; selected_time_window?: number } | null;
  message_notifications: number;
  collapsed?: boolean;
  flags?: number;
}

export interface UserGuildSettings {
  /** null for DM settings */
  guild_id: Snowflake | null;
  muted: boolean;
  mute_config?: { end_time: string | null; selected_time_window?: number } | null;
  message_notifications: number;
  suppress_everyone: boolean;
  suppress_roles: boolean;
  mobile_push?: boolean;
  hide_muted_channels?: boolean;
  channel_overrides: ChannelOverride[];
  flags?: number;
  notify_highlights?: number;
  mute_scheduled_events?: boolean;
}

export const RelationshipType = {
  None: 0,
  Friend: 1,
  Blocked: 2,
  IncomingRequest: 3,
  OutgoingRequest: 4,
  Implicit: 5,
  Suggestion: 6,
} as const;

export interface Relationship {
  id: Snowflake;
  type: number;
  user?: User;
  user_id?: Snowflake;
  nickname?: string | null;
  since?: string;
}

export const ScheduledEventStatus = { Scheduled: 1, Active: 2, Completed: 3, Canceled: 4 } as const;
export const ScheduledEventEntityType = { StageInstance: 1, Voice: 2, External: 3 } as const;

export interface ScheduledEvent {
  id: Snowflake;
  guild_id: Snowflake;
  channel_id?: Snowflake | null;
  creator_id?: Snowflake | null;
  creator?: User;
  name: string;
  description?: string | null;
  scheduled_start_time: string;
  scheduled_end_time?: string | null;
  privacy_level?: number;
  status: number;
  entity_type: number;
  entity_id?: Snowflake | null;
  entity_metadata?: { location?: string } | null;
  user_count?: number;
  image?: string | null;
  recurrence_rule?: unknown;
}

export interface GatewayDispatch<T = unknown> {
  t: string;
  s: number | null;
  d: T;
}
