import { describe, expect, it } from "vitest";
import { agendaBucketAt, googleCalendarUrl, toICS } from "../src/events.ts";
import { dedupePostedEvents, eventChannelScore, postedCalendarEntry, postedEvents } from "../src/posted.ts";
import { ChannelType, type Channel, type Embed, type Message } from "../src/types.ts";

const GUILD = "1100000000000000001";
const CHANNEL = "1100000000000000002";
const FRIDAY_6PM = 1790384400; // unix seconds
const SATURDAY_6PM = 1790470800;

function msg(id: string, patch: { content?: string; embeds?: Embed[] } = {}): Message {
  return {
    id,
    channel_id: CHANNEL,
    author: { id: "1100000000000000009", username: "bot", discriminator: "0", global_name: null, avatar: null },
    content: patch.content ?? "",
    timestamp: new Date(0).toISOString(),
    edited_timestamp: null,
    tts: false,
    mention_everyone: false,
    mentions: [],
    mention_roles: [],
    attachments: [],
    embeds: patch.embeds ?? [],
    pinned: false,
    type: 0,
  } as Message;
}

// Shaped like a Sesh event card.
const card = msg("1100000000000000100", {
  content: "<@&1100000000000000050>",
  embeds: [
    {
      title: ":calendar_spiral:  **Board game night**",
      description: "Beginners welcome!",
      fields: [
        { name: "Time", value: `<t:${FRIDAY_6PM}:F> (<t:${FRIDAY_6PM}:R>) [[+]](https://www.google.com/calendar/event?action=TEMPLATE)` },
        { name: "Duration", value: "3 hours, 30 minutes" },
        { name: "Location", value: "Some Cafe\n[30th Street, San Diego](https://www.google.com/maps/search/?api=1)" },
        { name: "Attendees (2)", value: ">>> someone\nsomeone else", inline: true },
      ],
    },
  ],
});

// Shaped like Sesh's listing, which links back to the cards.
const listing = msg("1100000000000000200", {
  embeds: [
    {
      title: "📃 Event Listings",
      description: "Times displayed in server timezone",
      fields: [
        { name: "Friday", value: `> \`06:00pm\` **[Board game night](https://discord.com/channels/${GUILD}/${CHANNEL}/1100000000000000100)** <t:${FRIDAY_6PM}:R>` },
        { name: "Saturday", value: `> \`06:00pm\` **[Brewery meetup](https://discord.com/channels/${GUILD}/${CHANNEL}/1100000000000000099)** <t:${SATURDAY_6PM}:R>` },
      ],
    },
  ],
});

describe("posted events", () => {
  it("reads a bot's event card: title, time, duration, location", () => {
    const [e] = postedEvents(card, GUILD);
    expect(e).toMatchObject({
      id: card.id,
      title: "Board game night",
      start: FRIDAY_6PM * 1000,
      end: FRIDAY_6PM * 1000 + 3.5 * 3_600_000,
      location: "Some Cafe, 30th Street, San Diego",
      description: "Beginners welcome!",
    });
  });

  it("reads each line of a listing, and drops lines pointing at a card it already has", () => {
    const lines = postedEvents(listing, GUILD);
    expect(lines.map((e) => e.title)).toEqual(["Board game night", "Brewery meetup"]);
    const all = dedupePostedEvents([...postedEvents(card, GUILD), ...lines], () => false);
    expect(all.map((e) => [e.title, e.messageId])).toEqual([
      ["Board game night", card.id],
      ["Brewery meetup", listing.id],
    ]);
  });

  it("reads start–end ranges, and skips Discord events it already knows", () => {
    const chronicle = msg("1100000000000000300", {
      embeds: [
        {
          title: "Club: Events",
          description: "**Events for the next 30 days**",
          fields: [
            {
              name: "Friday",
              value: `<:card:1100000000000000060> [\`Aquarium day            \`](https://www.google.com/calendar/event?eid=abc "Club: Events") <t:${FRIDAY_6PM}:t> - <t:${FRIDAY_6PM + 7200}:t>`,
            },
            {
              name: "Saturday",
              value: `<:card:1100000000000000060> [\`VR meetup    \`](https://discord.com/events/${GUILD}/1100000000000000777 "Club: Events") <t:${SATURDAY_6PM}:t> - <t:${SATURDAY_6PM + 3600}:t>`,
            },
          ],
        },
      ],
    });
    const events = postedEvents(chronicle, GUILD);
    expect(events.map((e) => [e.title, e.end - e.start])).toEqual([
      ["Aquarium day", 7_200_000],
      ["VR meetup", 3_600_000],
    ]);
    const kept = dedupePostedEvents(events, (id) => id === "1100000000000000777");
    expect(kept.map((e) => e.title)).toEqual(["Aquarium day"]);
  });

  it("keeps only the newest post when listings repeat an event", () => {
    const older = postedEvents({ ...listing, id: "1100000000000000150" }, GUILD);
    const newer = postedEvents(listing, GUILD);
    const kept = dedupePostedEvents([...older, ...newer], () => false);
    expect(kept.every((e) => e.messageId === listing.id)).toBe(true);
    expect(kept).toHaveLength(2);
  });

  it("reads plain posts with a timestamp, and leaves undated ones alone", () => {
    const post = msg("1100000000000000400", {
      content: `<@&1100000000000000050>\n# Movie night <t:${FRIDAY_6PM}:F> - <t:${FRIDAY_6PM + 9000}:t>\nBring snacks!`,
    });
    expect(postedEvents(post, GUILD)).toMatchObject([
      { title: "Movie night", start: FRIDAY_6PM * 1000, end: FRIDAY_6PM * 1000 + 9_000_000, description: "Bring snacks!" },
    ]);
    const at = msg("1100000000000000402", { content: `Picnic at the park at <t:${FRIDAY_6PM}:t> (<t:${FRIDAY_6PM}:R>)` });
    expect(postedEvents(at, GUILD)[0]?.title).toBe("Picnic at the park");
    expect(postedEvents(msg("1100000000000000401", { content: "Group photo at 6PM at the pier!" }), GUILD)).toEqual([]);
  });

  it("feeds calendars and the agenda", () => {
    const [e] = postedEvents(card, GUILD);
    const entry = postedCalendarEntry(e!);
    const url = new URL(googleCalendarUrl(entry, "A server"));
    expect(url.searchParams.get("text")).toBe("Board game night");
    expect(url.searchParams.get("details")).toContain(`https://discord.com/channels/${GUILD}/${CHANNEL}/${card.id}`);
    expect(toICS(entry, "A server", 0)).toContain("SUMMARY:Board game night");
    expect(agendaBucketAt(e!.start, e!.end, e!.start + 60_000)).toBe("live");
  });
});

describe("event channel suggestions", () => {
  const channel = (name: string, patch: Partial<Channel> = {}): Channel => ({ id: name, type: ChannelType.GuildText, name, ...patch }) as Channel;

  it("suggests channels named or described like event channels", () => {
    expect(eventChannelScore(channel("event-calendar"))).toBeGreaterThan(0);
    expect(eventChannelScore(channel("🗓-upcoming-events", { type: ChannelType.GuildAnnouncement }))).toBeGreaterThan(0);
    expect(eventChannelScore(channel("announcements", { topic: "Upcoming hangouts will be posted here!" }))).toBeGreaterThan(0);
    expect(eventChannelScore(channel("announcements", { type: ChannelType.GuildAnnouncement }))).toBeGreaterThan(0);
  });

  it("skips chat, staff and log channels, and forums", () => {
    expect(eventChannelScore(channel("general"))).toBe(0);
    expect(eventChannelScore(channel("💬-general", { topic: "Say hi. Plans go in #trip-planning." }))).toBe(0);
    expect(eventChannelScore(channel("staff-announcements"))).toBe(0);
    expect(eventChannelScore(channel("event-planning-tips"))).toBe(0);
    expect(eventChannelScore(channel("meetups", { type: ChannelType.GuildForum }))).toBe(0);
  });
});
