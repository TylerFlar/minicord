import { agendaBucket, isInPerson, isUpcomingOrLive, sortByStart, type AgendaBucket } from "@minicord/core";
import { CalendarDays } from "lucide-react";
import { useEffect, useState } from "react";
import { EventCard } from "../components/EventCard.tsx";
import { Empty, SectionTitle } from "../components/ui.tsx";
import { useClient, useNow, useStore } from "../app/context.tsx";

const BUCKETS: { key: AgendaBucket; label: string }[] = [
  { key: "live", label: "Happening now" },
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "this-week", label: "This week" },
  { key: "later", label: "Later" },
];

type Filter = "all" | "in-person" | "interested";

export function EventsScreen() {
  const client = useClient();
  const store = useStore(["events", "guilds"]);
  const now = useNow(60_000);
  const [filter, setFilter] = useState<Filter>("all");
  const [guildId, setGuildId] = useState("");

  useEffect(() => {
    void client.refreshEventCounts();
  }, [client]);

  const all = sortByStart([...store.events.values()].filter((e) => isUpcomingOrLive(e, now)));
  const shown = all.filter(
    (e) => (filter === "all" || (filter === "in-person" ? isInPerson(e) : store.myRsvps.has(e.id))) && (!guildId || e.guild_id === guildId),
  );
  const guildsWithEvents = [...new Set(all.map((e) => e.guild_id))].map((id) => store.guilds.get(id)).filter((g) => !!g);

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
        {shown.length === 0 ? (
          <Empty icon={<CalendarDays size={28} />} title="Nothing scheduled" />
        ) : (
          BUCKETS.map(({ key, label }) => {
            const events = shown.filter((e) => agendaBucket(e, now) === key);
            if (!events.length) return null;
            return (
              <section key={key}>
                <SectionTitle>{label}</SectionTitle>
                <div className="flex flex-col gap-2">
                  {events.map((e) => (
                    <EventCard key={e.id} event={e} />
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
