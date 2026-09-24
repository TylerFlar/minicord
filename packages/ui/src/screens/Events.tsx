import {
  agendaBucketAt,
  eventEnd,
  eventStart,
  isInPerson,
  isPhysicalLocation,
  isUpcomingOrLive,
  ScheduledEventStatus,
  type AgendaBucket,
  type PostedEvent,
  type ScheduledEvent,
} from "@minicord/core";
import { CalendarDays, Hash } from "lucide-react";
import { useEffect, useState } from "react";
import { EventCard } from "../components/EventCard.tsx";
import { EventChannels } from "../components/EventChannels.tsx";
import { PostedEventCard, usePostedEvents } from "../components/PostedEventCard.tsx";
import { Card, Empty, SectionTitle } from "../components/ui.tsx";
import { useClient, useNow, useStore } from "../app/context.tsx";

const BUCKETS: { key: AgendaBucket; label: string }[] = [
  { key: "live", label: "Happening now" },
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "this-week", label: "This week" },
  { key: "later", label: "Later" },
];

type Filter = "all" | "in-person" | "interested";

/** Discord events and events posted in event channels, on one timeline. */
export type AgendaItem =
  | { kind: "discord"; id: string; guildId: string; start: number; end: number; live: boolean; event: ScheduledEvent }
  | { kind: "posted"; id: string; guildId: string; start: number; end: number; live: boolean; event: PostedEvent };

export function agendaItems(events: ScheduledEvent[], posted: PostedEvent[], now: number): AgendaItem[] {
  const discord: AgendaItem[] = events
    .filter((e) => isUpcomingOrLive(e, now))
    .map((e) => ({ kind: "discord", id: e.id, guildId: e.guild_id, start: eventStart(e), end: eventEnd(e), live: e.status === ScheduledEventStatus.Active, event: e }));
  const fromPosts: AgendaItem[] = posted
    .filter((e) => e.end > now)
    .map((e) => ({ kind: "posted", id: e.id, guildId: e.guildId, start: e.start, end: e.end, live: false, event: e }));
  return [...discord, ...fromPosts].sort((a, b) => a.start - b.start);
}

export function AgendaCard({ item, compact = false }: { item: AgendaItem; compact?: boolean }) {
  return item.kind === "discord" ? <EventCard event={item.event} compact={compact} /> : <PostedEventCard event={item.event} compact={compact} />;
}

export function EventsScreen() {
  const client = useClient();
  const store = useStore(["events", "guilds"]);
  const posted = usePostedEvents();
  const now = useNow(60_000);
  const [filter, setFilter] = useState<Filter>("all");
  const [guildId, setGuildId] = useState("");
  // Nothing chosen yet: open the suggestions on the first visit.
  const [managing, setManaging] = useState(
    () => Object.keys(client.rules.config.eventChannels).length === 0 && store.sortedGuilds().some((g) => client.eventChannelSuggestions(g.id, 1).length > 0),
  );

  useEffect(() => {
    void client.refreshEventCounts();
  }, [client]);

  const all = agendaItems([...store.events.values()], posted, now);
  const shown = all.filter(
    (i) =>
      (filter === "all" ||
        (filter === "in-person"
          ? i.kind === "discord"
            ? isInPerson(i.event)
            : isPhysicalLocation(i.event.location)
          : i.kind === "discord" && store.myRsvps.has(i.event.id))) &&
      (!guildId || i.guildId === guildId),
  );
  const guildsWithEvents = [...new Set(all.map((i) => i.guildId))].map((id) => store.guilds.get(id)).filter((g) => !!g);

  return (
    <div className="flex-1 overflow-y-auto bg-surface">
      <div className="mx-auto max-w-2xl px-4 py-5 sm:px-6 sm:py-8">
        <h1 className="mb-4 text-[22px] font-bold">Events</h1>
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {(["all", "in-person", "interested"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-[13.5px] font-medium ${filter === f ? "bg-text text-bg" : "bg-sunken text-muted hover:text-text"}`}
            >
              {f === "all" ? "All" : f === "in-person" ? "In person" : "Interested"}
            </button>
          ))}
          <button
            onClick={() => setManaging((m) => !m)}
            className={`flex items-center gap-1 rounded-full px-3 py-1 text-[13.5px] font-medium ${managing ? "bg-accent-soft text-accent" : "bg-sunken text-muted hover:text-text"}`}
          >
            <Hash size={13} /> Event channels
          </button>
          {guildsWithEvents.length > 1 && (
            <select value={guildId} onChange={(e) => setGuildId(e.target.value)} className="ml-auto rounded-md bg-sunken px-2 py-1 text-[13.5px] outline-none">
              <option value="">All servers</option>
              {guildsWithEvents.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {managing && (
          <Card className="mb-6 p-2">
            <p className="px-2 pb-1.5 pt-1 text-[12.5px] text-muted">Where servers post events: readable even when vaulted, and dated posts show up here.</p>
            <EventChannels />
          </Card>
        )}
        {shown.length === 0 ? (
          <Empty icon={<CalendarDays size={28} />} title="Nothing scheduled" />
        ) : (
          BUCKETS.map(({ key, label }) => {
            const items = shown.filter((i) => agendaBucketAt(i.start, i.end, now, i.live) === key);
            if (!items.length) return null;
            return (
              <section key={key}>
                <SectionTitle>{label}</SectionTitle>
                <div className="flex flex-col gap-2">
                  {items.map((i) => (
                    <AgendaCard key={`${i.kind}:${i.id}`} item={i} />
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
