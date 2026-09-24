import { ChannelType } from "@minicord/core";
import { useState } from "react";
import { useClient, useStore } from "../app/context.tsx";
import { Button } from "./ui.tsx";

const pad = (n: number) => String(n).padStart(2, "0");
const dateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Create a Discord event (somewhere, or in a voice channel) in a server that lets you. */
export function NewEventForm({ guildId: preferred }: { guildId?: string }) {
  const client = useClient();
  const store = useStore(["guilds", "channels"]);
  const guilds = client.eventGuilds();
  const [guildId, setGuildId] = useState(() => (preferred && guilds.some((g) => g.id === preferred) ? preferred : (guilds[0]?.id ?? "")));
  const [name, setName] = useState("");
  const [where, setWhere] = useState<"place" | "voice">("place");
  const [location, setLocation] = useState("");
  const [channelId, setChannelId] = useState("");
  const [date, setDate] = useState(() => dateValue(new Date(Date.now() + 86_400_000)));
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("20:00");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const voiceChannels = guildId
    ? store
        .guildChannelGroups(guildId)
        .flatMap((g) => g.channels)
        .filter((c) => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice)
    : [];
  // "YYYY-MM-DDTHH:MM" parses as local time; an end before the start means it runs past midnight.
  const startMs = Date.parse(`${date}T${start}`);
  const endParsed = Date.parse(`${date}T${end}`);
  const endMs = endParsed > startMs ? endParsed : endParsed + 86_400_000;
  const past = startMs <= Date.now();
  const ready = !!guildId && !!name.trim() && !Number.isNaN(startMs) && !past && (where === "place" ? !!location.trim() : !!channelId);
  const field = "w-full rounded-md bg-sunken px-3 py-2 text-[14.5px] outline-none focus:ring-2 focus:ring-accent/40";
  const label = "mb-1 block text-[12.5px] font-semibold text-muted";

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    const base = { name: name.trim(), description: description.trim(), start: startMs, end: endMs };
    const ok = await client.createEvent(guildId, where === "place" ? { ...base, location: location.trim() } : { ...base, channelId });
    setBusy(false);
    if (ok) client.closeOverlay();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => client.closeOverlay()}>
      <form
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h3 className="px-5 pb-2 pt-5 text-[18px] font-semibold">New event</h3>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-3">
          {guilds.length > 1 && (
            <div>
              <label htmlFor="new-event-server" className={label}>
                Server
              </label>
              <select id="new-event-server" value={guildId} onChange={(e) => (setGuildId(e.target.value), setChannelId(""))} className={field}>
                {guilds.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="new-event-title" className={label}>
              Title
            </label>
            <input id="new-event-title" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus className={field} />
          </div>
          <div>
            <div className="mb-1 inline-flex rounded-md border border-line p-0.5 text-[12.5px]">
              {(["place", "voice"] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWhere(w)}
                  className={`rounded px-2.5 py-0.5 ${where === w ? "bg-sunken font-medium text-text" : "text-muted"}`}
                  disabled={w === "voice" && !voiceChannels.length}
                >
                  {w === "place" ? "Somewhere else" : "Voice channel"}
                </button>
              ))}
            </div>
            {where === "place" ? (
              <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={100} placeholder="Where" aria-label="Where" className={field} />
            ) : (
              <select value={channelId} onChange={(e) => setChannelId(e.target.value)} aria-label="Voice channel" className={field}>
                <option value="">Channel…</option>
                {voiceChannels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-2">
            <div>
              <label htmlFor="new-event-date" className={label}>
                Date
              </label>
              <input id="new-event-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="new-event-start" className={label}>
                Starts
              </label>
              <input id="new-event-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="new-event-end" className={label}>
                Ends
              </label>
              <input id="new-event-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={field} />
            </div>
          </div>
          {past && <p className="text-[12.5px] text-warn">That's in the past.</p>}
          <div>
            <label htmlFor="new-event-description" className={label}>
              Description
            </label>
            <textarea id="new-event-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={3} className={`${field} resize-none`} />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <Button type="button" tone="quiet" onClick={() => client.closeOverlay()}>
            Cancel
          </Button>
          <Button type="submit" tone="accent" disabled={!ready || busy}>
            {busy ? "Creating…" : "Create event"}
          </Button>
        </div>
      </form>
    </div>
  );
}
