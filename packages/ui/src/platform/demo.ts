import {
  msToSnowflake,
  Permission,
  rules as R,
  type Channel,
  type GatewayDispatch,
  type Message,
  type Platform,
  type ScheduledEvent,
  type SessionHandlers,
  type User,
} from "@minicord/core";

/**
 * A made-up world for screenshots and trying the UI without an account (`?demo`):
 * nobody here is real, and nothing leaves the page. Writes are echoed back as
 * gateway events so sending, reacting and member lists behave like the real thing.
 */

/** Discord-length ids (the markdown parser only accepts real-looking snowflakes). */
export const sid = (n: number) => String(1_150_000_000_000_000_000n + BigInt(n));

const MIN = 60_000;
const now = Date.now();
let salt = 0;
const idAt = (minutesAgo: number) => msToSnowflake(now - minutesAgo * MIN + salt++);
const isoAt = (minutesAgo: number) => new Date(now - minutesAgo * MIN).toISOString();

function glyph(emoji: string, background: string, size = 128): string {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  g.fillStyle = background;
  g.fillRect(0, 0, size, size);
  g.font = `${Math.round(size * 0.56)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(emoji, size / 2, size / 2 + size * 0.04);
  return canvas.toDataURL("image/png");
}

/** A sunrise over hills, for the "photo" someone posts. */
function sunrise(): string {
  const w = 800;
  const h = 450;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d")!;
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#f7c59f");
  sky.addColorStop(0.55, "#f4a68b");
  sky.addColorStop(1, "#e98a7b");
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#fff4d6";
  g.beginPath();
  g.arc(w * 0.62, h * 0.62, 70, 0, Math.PI * 2);
  g.fill();
  const hill = (y: number, color: string, amp: number, phase: number) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 10) g.lineTo(x, y + Math.sin(x / 90 + phase) * amp + Math.sin(x / 37) * amp * 0.3);
    g.lineTo(w, h);
    g.fill();
  };
  hill(h * 0.66, "#b86b6b", 18, 0.5);
  hill(h * 0.76, "#7f5263", 22, 2.1);
  hill(h * 0.86, "#4e3a52", 16, 4);
  return canvas.toDataURL("image/jpeg", 0.86);
}

function person(id: string, username: string, name: string, emoji: string, bg: string): User {
  return { id, username, global_name: name, discriminator: "0", avatar: glyph(emoji, bg) };
}

const me = person(sid(100), "alex", "Alex", "🦊", "#f4d6c1");
const P = {
  sam: person(sid(101), "samrivera", "Sam", "🐻", "#dde8d2"),
  priya: person(sid(102), "priya.k", "Priya", "🦉", "#e5dcf2"),
  jordan: person(sid(103), "jordy", "Jordan", "🐢", "#cfe6e3"),
  mika: person(sid(104), "mika", "Mika", "🐙", "#f5d4dc"),
  theo: person(sid(105), "theo", "Theo", "🦦", "#f1e4c3"),
  noor: person(sid(106), "noor", "Noor", "🐝", "#f6ecbd"),
  kai: person(sid(107), "kai.w", "Kai", "🐧", "#d6e2f3"),
  lena: person(sid(108), "lena", "Lena", "🦋", "#dde9f6"),
};
const everyone = [me, ...Object.values(P)];

const perms = String(
  Permission.ViewChannel | Permission.SendMessages | Permission.ReadMessageHistory | Permission.AddReactions | Permission.AttachFiles | Permission.EmbedLinks,
);

interface DemoGuild {
  id: string;
  name: string;
  icon: string;
  members: number;
  channels: Channel[];
  roles?: { id: string; name: string; color: number; hoist?: boolean; position: number }[];
  member?: Record<string, string[]>;
}

const text = (id: string, guild: string, name: string, position: number, parent?: string, topic?: string): Channel => ({
  id,
  type: 0,
  guild_id: guild,
  name,
  position,
  ...(parent ? { parent_id: parent } : {}),
  ...(topic ? { topic } : {}),
});
const category = (id: string, guild: string, name: string, position: number): Channel => ({ id, type: 4, guild_id: guild, name, position });

const G = {
  trail: {
    id: sid(200),
    name: "Trail Crew",
    icon: glyph("🥾", "#dfe8d8"),
    members: 142,
    roles: [
      { id: sid(210), name: "Trail leads", color: 0x3b8a5c, hoist: true, position: 2 },
      { id: sid(211), name: "Regulars", color: 0xc07a3d, hoist: true, position: 1 },
    ],
    member: { [P.priya.id]: [sid(210)], [P.sam.id]: [sid(211)], [P.jordan.id]: [sid(211)] },
    channels: [
      category(sid(250), sid(200), "Plans", 0),
      text(sid(201), sid(200), "general", 0, sid(250), "Say hi. Plans go in #trip-planning."),
      text(sid(202), sid(200), "trip-planning", 1, sid(250), "Where we're going and who's driving"),
      text(sid(203), sid(200), "gear", 2, sid(250)),
      text(sid(205), sid(200), "photos", 3, sid(250)),
      category(sid(251), sid(200), "Voice", 1),
      { id: sid(204), type: 2, guild_id: sid(200), name: "Campfire", position: 0, parent_id: sid(251) },
    ],
  },
  photo: { id: sid(300), name: "Photo Walks", icon: glyph("📷", "#e3e1f2"), members: 58, channels: [text(sid(301), sid(300), "general", 0), text(sid(302), sid(300), "critique", 1)] },
  books: { id: sid(400), name: "Book Club", icon: glyph("📚", "#f3e3d3"), members: 23, channels: [text(sid(401), sid(400), "general", 0), text(sid(402), sid(400), "the-overstory", 1)] },
  games: { id: sid(700), name: "Game Night", icon: glyph("🎲", "#dbe8f1"), members: 17, channels: [text(sid(701), sid(700), "general", 0), text(sid(702), sid(700), "board-games", 1)] },
  city: {
    id: sid(500),
    name: "Big City Chat",
    icon: glyph("🌴", "#d5ece6"),
    members: 48210,
    channels: [text(sid(501), sid(500), "general", 0), text(sid(502), sid(500), "events", 1), text(sid(503), sid(500), "food", 2), text(sid(504), sid(500), "memes", 3)],
  },
  neighbors: {
    id: sid(600),
    name: "Neighborhood",
    icon: glyph("🏡", "#f2e6d0"),
    members: 311,
    channels: [text(sid(601), sid(600), "announcements", 0, undefined, "Block parties, meetings and other happenings"), text(sid(602), sid(600), "lost-and-found", 1)],
  },
} satisfies Record<string, DemoGuild>;

// ---- messages -------------------------------------------------------------------

const messages: Record<string, Message[]> = {};
function say(channelId: string, author: User, minutesAgo: number, content: string, extra: Partial<Message> = {}): Message {
  const guildId = Object.values(G).find((g) => g.channels.some((c) => c.id === channelId))?.id;
  const roles = guildId === G.trail.id ? (G.trail.member[author.id] ?? []) : [];
  const msg: Message = {
    id: idAt(minutesAgo),
    channel_id: channelId,
    ...(guildId ? { guild_id: guildId, member: { roles, nick: null } } : {}),
    author,
    content,
    timestamp: isoAt(minutesAgo),
    mention_everyone: false,
    mentions: [],
    mention_roles: [],
    attachments: [],
    embeds: [],
    type: extra.referenced_message ? 19 : 0,
    ...extra,
  };
  (messages[channelId] ??= []).push(msg);
  return msg;
}

say(sid(201), P.lena, 300, "Welcome to everyone who joined this week 👋");
say(sid(201), P.kai, 140, "Anyone have a spare headlamp for Saturday?");
say(sid(201), P.jordan, 131, "I have two, I'll bring one");

const plan = say(sid(202), P.priya, 95, "Sunrise hike on Saturday? Torrey Pines, south lot at 6 🌄");
say(sid(202), P.sam, 92, "in! I'll bring coffee ☕", { reactions: [{ emoji: { id: null, name: "☕" }, count: 4, me: true }] });
say(sid(202), P.jordan, 90, "", {
  poll: {
    question: { text: "Which trail?" },
    answers: [
      { answer_id: 1, poll_media: { text: "Guy Fleming", emoji: { id: null, name: "🌲" } } },
      { answer_id: 2, poll_media: { text: "Razor Point", emoji: { id: null, name: "⛰️" } } },
      { answer_id: 3, poll_media: { text: "Beach Trail", emoji: { id: null, name: "🌊" } } },
    ],
    allow_multiselect: false,
    expiry: new Date(now + 26 * 60 * MIN).toISOString(),
    results: {
      is_finalized: false,
      answer_counts: [
        { id: 1, count: 2, me_voted: false },
        { id: 2, count: 5, me_voted: true },
        { id: 3, count: 1, me_voted: false },
      ],
    },
  },
});
const readUpTo = say(sid(202), P.mika, 40, "can we make it 6:30? 6 is brutal 😅", {
  referenced_message: plan,
  message_reference: { message_id: plan.id, channel_id: sid(202), guild_id: sid(200) },
  reactions: [{ emoji: { id: null, name: "😂" }, count: 3, me: false }],
});
say(sid(202), P.priya, 38, `6:30 it is. <@${me.id}> are you driving?`, { mentions: [me] });
say(sid(202), P.theo, 12, "last time we went 👇", {
  attachments: [{ id: sid(900), filename: "torrey-pines.jpg", size: 48_000, url: sunrise(), proxy_url: "", content_type: "image/jpeg" }],
});
say(sid(202), P.kai, 3, "I can take two people from Hillcrest 🚗");
// The image lives in a data URL; thumbnails use the same one.
for (const m of messages[sid(202)]!) for (const a of m.attachments) a.proxy_url = a.url;

say(sid(301), P.noor, 25, "Golden hour walk along the harbor on Sunday, bring any camera");
say(sid(401), P.lena, 2000, "Chapter 12 has me in pieces");
say(sid(701), P.mika, 1500, "Game night at mine next Wednesday, 7pm 🎲");
say(sid(702), P.theo, 1400, "I'm bringing Wingspan");

// DMs
const DM_SAM = sid(800);
const DM_GROUP = sid(801);
say(DM_SAM, me, 180, "are we still on for saturday?");
say(DM_SAM, P.sam, 170, "obviously. I'll grab you at 5:45");
say(DM_SAM, me, 168, "you're a hero");
say(DM_SAM, P.sam, 15, "also you left your water bottle in my car 😂");
say(DM_SAM, P.sam, 14, "I'll bring it saturday");
say(DM_GROUP, P.mika, 400, "Wednesday at mine? 7pm");
say(DM_GROUP, P.priya, 390, "yes!! I'll make the dip");
say(DM_GROUP, me, 385, "I'm in 🙌");
say(sid(802), P.jordan, 3000, "thanks for the book rec, finished it in two days");
say(sid(803), P.theo, 5000, "sending you the photos from the coast later");

// Mentions waiting in vaulted servers.
const oldQuestion = say(sid(502), me, 60 * 24 * 6, "is the night market still happening this year?");
const mentions: Message[] = [
  say(sid(502), P.noor, 55, "The night market is back this Friday! 🏮 Vendors from 6 to 10", {
    referenced_message: oldQuestion,
    message_reference: { message_id: oldQuestion.id, channel_id: sid(502), guild_id: sid(500) },
    mentions: [me],
  }),
  say(sid(602), P.lena, 300, `<@${me.id}> is this your bike? It's been by the park gate all week`, { mentions: [me] }),
];
messages[sid(502)] = messages[sid(502)]!.filter((m) => m.id !== oldQuestion.id).concat(oldQuestion).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));

// Events posted in channels instead of as Discord events: a bot's card and its listing, and a plain announcement.
const planner: User = { ...person(sid(109), "planner", "Planner", "📅", "#e6e1f5"), bot: true };
const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const cleanup = unix(nextDay(6, 9));
const cleanupCard = say(sid(502), planner, 40, "", {
  embeds: [
    {
      title: ":calendar_spiral:  **Beach cleanup**",
      description: "Gloves and bags provided. Tacos after for everyone who helps.",
      fields: [
        { name: "Time", value: `<t:${cleanup}:F> (<t:${cleanup}:R>)` },
        { name: "Duration", value: "2 hours" },
        { name: "Location", value: "Ocean Beach pier" },
        { name: "Attendees (14)", value: ">>> Noor\nKai\nLena", inline: true },
      ],
    },
  ],
});
const trivia = unix(nextDay(3, 19, 30));
say(sid(502), planner, 20, "", {
  embeds: [
    {
      title: "📃 Event Listings",
      fields: [
        { name: "Saturday", value: `> **[Beach cleanup](https://discord.com/channels/${sid(500)}/${sid(502)}/${cleanupCard.id})** <t:${cleanup}:R>` },
        { name: "Wednesday", value: `> **[Trivia at the taproom](https://discord.com/channels/${sid(500)}/${sid(502)}/${sid(9999)})** <t:${trivia}:R>` },
      ],
    },
  ],
});
const party = unix(nextDay(0, 16));
say(sid(601), P.theo, 180, `**Block party** on Maple St <t:${party}:F> - <t:${party + 4 * 3600}:t>
Bring a dish to share. The street closes to cars from 3.`);

// ---- events -----------------------------------------------------------------------

function nextDay(weekday: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  const ahead = (weekday - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + ahead);
  return d.toISOString();
}
function inDays(days: number, hour: number): string {
  const d = new Date(now + days * 86_400_000);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}
const events: ScheduledEvent[] = [
  { id: sid(1001), guild_id: G.trail.id, name: "Sunrise hike · Torrey Pines", scheduled_start_time: nextDay(6, 6, 30), status: 1, entity_type: 3, entity_metadata: { location: "Torrey Pines State Reserve, south lot" }, user_count: 9, description: "Easy pace, about 3 miles. Coffee after at the beach." },
  { id: sid(1002), guild_id: G.city.id, name: "Night market", scheduled_start_time: nextDay(5, 18), status: 1, entity_type: 3, entity_metadata: { location: "Balboa Park" }, user_count: 214, description: "Food stalls, live music and local makers." },
  { id: sid(1003), guild_id: G.photo.id, name: "Photo walk: harbor at golden hour", scheduled_start_time: nextDay(0, 17, 45), status: 1, entity_type: 3, entity_metadata: { location: "Harbor Drive" }, user_count: 12 },
  { id: sid(1004), guild_id: G.games.id, name: "Board game night", scheduled_start_time: nextDay(3, 19), status: 1, entity_type: 3, entity_metadata: { location: "Mika's place" }, user_count: 7 },
  { id: sid(1005), guild_id: G.books.id, name: "Book club: The Overstory", scheduled_start_time: inDays(12, 15), status: 1, entity_type: 3, entity_metadata: { location: "Café on 30th" }, user_count: 8 },
];
const rsvps = new Set([sid(1001), sid(1004)]);

// ---- READY ------------------------------------------------------------------------

const lastId = (channelId: string) => messages[channelId]?.at(-1)?.id ?? null;
const guilds = Object.values(G) as DemoGuild[];
const presences = [
  { user_id: P.sam.id, status: "online", activities: [{ type: 4, name: "Custom Status", state: "packing snacks for saturday" }] },
  { user_id: P.priya.id, status: "idle", activities: [] },
  { user_id: P.jordan.id, status: "dnd", activities: [{ type: 4, name: "Custom Status", state: "deadline mode" }] },
  { user_id: P.mika.id, status: "online", activities: [{ type: 2, name: "Spotify", details: "Harvest Moon" }] },
  { user_id: P.kai.id, status: "online", activities: [{ type: 0, name: "Stardew Valley" }] },
  { user_id: P.lena.id, status: "online", activities: [] },
  { user_id: P.theo.id, status: "offline", activities: [] },
];

function ready() {
  const channelsOf = (g: DemoGuild) => g.channels.map((c) => ({ ...c, last_message_id: lastId(c.id) }));
  const readState = [
    ...guilds.flatMap((g) => g.channels.filter((c) => lastId(c.id)).map((c) => ({ id: c.id, last_message_id: lastId(c.id), mention_count: 0 }))),
    { id: DM_GROUP, last_message_id: lastId(DM_GROUP), mention_count: 0 },
    { id: sid(802), last_message_id: lastId(sid(802)), mention_count: 0 },
    { id: sid(803), last_message_id: lastId(sid(803)), mention_count: 0 },
    { id: DM_SAM, last_message_id: messages[DM_SAM]![2]!.id, mention_count: 2 },
  ].map((rs) =>
    // Unread: the rest of #trip-planning (with the mention), #general in Trail Crew, Photo Walks.
    rs.id === sid(202) ? { ...rs, last_message_id: readUpTo.id, mention_count: 1 } : rs.id === sid(201) || rs.id === sid(301) ? { ...rs, last_message_id: String(BigInt(rs.last_message_id!) - 1n) } : rs,
  );
  return {
    v: 9,
    session_id: "demo",
    user: { ...me, premium_type: 0 },
    users: Object.values(P),
    guilds: guilds.map((g) => ({
      id: g.id,
      properties: { name: g.name, icon: g.icon, owner_id: P.priya.id },
      roles: [{ id: g.id, name: "@everyone", permissions: perms, position: 0 }, ...(g.roles ?? []).map((r) => ({ ...r, permissions: "0" }))],
      channels: channelsOf(g),
      threads: [],
      emojis: [],
      stickers: [],
      member_count: g.members,
      guild_scheduled_events: events.filter((e) => e.guild_id === g.id),
      ...(g.id === G.trail.id
        ? { voice_states: [{ user_id: P.jordan.id, channel_id: sid(204), self_mute: true }, { user_id: P.kai.id, channel_id: sid(204) }] }
        : {}),
    })),
    merged_members: guilds.map((g) => [
      { user_id: me.id, roles: [] },
      ...(g.id === G.trail.id ? Object.values(P).map((u) => ({ user_id: u.id, user: u, roles: G.trail.member[u.id] ?? [], nick: null })) : []),
    ]),
    private_channels: [
      { id: DM_SAM, type: 1, recipient_ids: [P.sam.id], last_message_id: lastId(DM_SAM) },
      { id: DM_GROUP, type: 3, name: "Weekend crew", recipient_ids: [P.sam.id, P.priya.id, P.mika.id], last_message_id: lastId(DM_GROUP) },
      { id: sid(802), type: 1, recipient_ids: [P.jordan.id], last_message_id: lastId(sid(802)) },
      { id: sid(803), type: 1, recipient_ids: [P.theo.id], last_message_id: lastId(sid(803)) },
    ],
    relationships: [
      ...[P.sam, P.priya, P.jordan, P.mika, P.theo, P.kai, P.lena].map((u) => ({ id: u.id, type: 1, user_id: u.id, nickname: null })),
      { id: P.noor.id, type: 3, user_id: P.noor.id, user: P.noor, nickname: null },
    ],
    read_state: { version: 1, partial: false, entries: readState },
    user_guild_settings: { version: 1, partial: false, entries: [] },
    merged_presences: { friends: presences, guilds: [] },
  };
}

function memberList(guildId: string) {
  if (guildId !== G.trail.id) return null;
  const item = (u: User) => {
    const presence = presences.find((p) => p.user_id === u.id) ?? { status: "online", activities: [] };
    return { member: { user: u, roles: G.trail.member[u.id] ?? [], nick: null, presence: { user: { id: u.id }, ...presence } } };
  };
  const online = [P.mika, P.kai, P.lena, me];
  const items = [
    { group: { id: sid(210), count: 1 } },
    item(P.priya),
    { group: { id: sid(211), count: 2 } },
    item(P.sam),
    item(P.jordan),
    { group: { id: "online", count: online.length } },
    ...online.map(item),
    { group: { id: "offline", count: 1 } },
    item(P.theo),
  ];
  return {
    guild_id: guildId,
    id: "everyone",
    member_count: G.trail.members,
    online_count: 7,
    groups: [
      { id: sid(210), count: 1 },
      { id: sid(211), count: 2 },
      { id: "online", count: online.length },
      { id: "offline", count: 1 },
    ],
    ops: [{ op: "SYNC", range: [0, 99], items }],
  };
}

function profile(userId: string) {
  const user = everyone.find((u) => u.id === userId);
  const bios: Record<string, [string, string]> = {
    [P.priya.id]: ["Trail lead · sunrise person 🌄", "she/her"],
    [P.sam.id]: ["always bringing coffee", "he/him"],
    [P.mika.id]: ["board games, bad puns", "they/them"],
  };
  const [bio, pronouns] = bios[userId] ?? ["", ""];
  return { user: { ...user, bio }, user_profile: { bio, pronouns, accent_color: null } };
}

// ---- platform ---------------------------------------------------------------------------

export function demoPlatform(): Platform {
  let handlers: SessionHandlers | null = null;
  const store = new Map<string, unknown>([
    [
      "rules",
      {
        ...R.initialRulesState(),
        onboarded: true,
        config: {
          ...R.DEFAULT_CONFIG,
          guildModes: { [G.trail.id]: "open", [G.photo.id]: "open", [G.books.id]: "open", [G.games.id]: "open", [G.city.id]: "vault", [G.neighbors.id]: "vault" },
          eventChannels: { [sid(502)]: G.city.id },
        },
      },
    ],
    ["emoji-recent", ["👍", "❤️", "😂", "🔥"]],
  ]);
  const emit = (t: string, d: unknown) => setTimeout(() => handlers?.onEvent({ t, s: null, d } as GatewayDispatch), 40);
  const guildOf = (channelId: string) => guilds.find((g) => g.channels.some((c) => c.id === channelId))?.id;

  return {
    kind: "web",
    appInfo: async () => ({ version: __MINICORD_VERSION__ }),
    auth: {
      status: async () => ({ loggedIn: true }),
      loginWithDiscord: async () => true,
      loginWithToken: async () => true,
      logout: async () => {},
    },
    session: {
      async attach(h) {
        handlers = h;
        // Sam is always about to say something.
        setInterval(() => emit("TYPING_START", { channel_id: DM_SAM, user_id: P.sam.id, timestamp: Math.floor(Date.now() / 1000) }), 7000);
        emit("TYPING_START", { channel_id: DM_SAM, user_id: P.sam.id, timestamp: Math.floor(Date.now() / 1000) });
        return { status: "ready", ready: { t: "READY", s: 1, d: ready() }, supplemental: null, backlog: [] };
      },
      send(op, d) {
        if (op !== 37) return;
        for (const guildId of Object.keys((d as { subscriptions: Record<string, unknown> }).subscriptions)) {
          const list = memberList(guildId);
          if (list) emit("GUILD_MEMBER_LIST_UPDATE", list);
        }
      },
      async request<T>(method: string, path: string, opts?: { json?: unknown; query?: Record<string, unknown> }): Promise<T> {
        let m: RegExpExecArray | null;
        if (method === "GET") {
          if ((m = /^\/channels\/(\d+)\/messages$/.exec(path))) return [...(messages[m[1]!] ?? [])].reverse() as T;
          if (path === "/users/@me/mentions") return [...mentions].reverse() as T;
          if ((m = /^\/guilds\/(\d+)\/scheduled-events$/.exec(path))) return events.filter((e) => e.guild_id === m![1]) as T;
          if (path === "/users/@me/scheduled-events") {
            const ids = String(opts?.query?.guild_ids ?? "").split(",");
            return events.filter((e) => rsvps.has(e.id) && ids.includes(e.guild_id)).map((e) => ({ guild_scheduled_event_id: e.id, user_id: me.id })) as T;
          }
          if ((m = /^\/users\/(\d+)\/profile$/.exec(path))) return profile(m[1]!) as T;
          if (/\/pins$/.test(path)) return [] as T;
          if (/threads\/search$/.test(path)) return { threads: [], has_more: false } as T;
          if (/application-command-index$/.test(path)) return { applications: [], application_commands: [] } as T;
          if (path === "/gifs/trending") return { categories: [], gifs: [] } as T;
          if (path.startsWith("/gifs/")) return [] as T;
          if (/messages\/search$/.test(path)) return { messages: [], total_results: 0 } as T;
          throw new Error(`${path} isn't part of the demo`);
        }
        if (method === "POST" && (m = /^\/channels\/(\d+)\/messages$/.exec(path))) {
          const body = (opts?.json ?? {}) as { content?: string; nonce?: string };
          const channelId = m[1]!;
          const guildId = guildOf(channelId);
          const msg: Message = {
            id: msToSnowflake(Date.now()),
            channel_id: channelId,
            ...(guildId ? { guild_id: guildId } : {}),
            author: me,
            content: body.content ?? "",
            timestamp: new Date().toISOString(),
            mention_everyone: false,
            mentions: [],
            mention_roles: [],
            attachments: [],
            embeds: [],
            type: 0,
            ...(body.nonce ? { nonce: body.nonce } : {}),
          };
          (messages[channelId] ??= []).push(msg);
          emit("MESSAGE_CREATE", msg);
          return msg as T;
        }
        if ((m = /^\/channels\/(\d+)\/messages\/(\d+)\/reactions\/([^/]+)\/@me$/.exec(path))) {
          const [name, id] = decodeURIComponent(m[3]!).split(":");
          emit(method === "PUT" ? "MESSAGE_REACTION_ADD" : "MESSAGE_REACTION_REMOVE", {
            user_id: me.id,
            channel_id: m[1],
            message_id: m[2],
            ...(guildOf(m[1]!) ? { guild_id: guildOf(m[1]!) } : {}),
            emoji: { id: id ?? null, name },
          });
          return undefined as T;
        }
        if (/\/ack$/.test(path)) return { token: null } as T;
        return {} as T;
      },
      setFocused() {},
    },
    storage: {
      load: async <T>(key: string) => (store.get(key) as T) ?? null,
      save: async (key, value) => void store.set(key, value),
    },
    shell: {
      notify() {},
      onNotificationClick: () => () => {},
      openExternal: (url) => void window.open(url, "_blank", "noopener"),
      openDiscord() {},
      setBadge() {},
      hide() {},
      onFocusChange: () => () => {},
      checkForUpdates: async () => ({ state: "none" }),
    },
  };
}
