import { googleCalendarUrl, isPhysicalLocation, postedCalendarEntry, toICS, type PostedEvent } from "@minicord/core";
import { CalendarPlus, Download, ExternalLink, Hash, MapPin, MessageSquare } from "lucide-react";
import { useState } from "react";
import { useClient, useSignals, useStore } from "../app/context.tsx";
import { eventDateParts, formatRelative } from "../lib/format.ts";
import { Markdown } from "./Markdown.tsx";
import { IconButton } from "./ui.tsx";

const DISCORD_MESSAGE = /^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/channels\/\d+\/(\d+)\/(\d+)/;

/** Dated posts from event channels; re-renders when those channels get new or edited posts. */
export function usePostedEvents(): PostedEvent[] {
  const client = useSignals(["rules"]);
  useStore(["events", ...Object.keys(client.rules.config.eventChannels).map((id) => `messages:${id}`)]);
  return client.postedEvents();
}

/** An event posted in a channel (a bot's card, a listing line, an announcement), shown like a Discord event. */
export function PostedEventCard({ event, compact = false }: { event: PostedEvent; compact?: boolean }) {
  const client = useClient();
  const store = useStore(["guilds", "channels"]);
  const [expanded, setExpanded] = useState(false);
  const guild = store.guilds.get(event.guildId);
  const channel = store.channels.get(event.channelId);
  const parts = eventDateParts(event.start);
  const now = Date.now();
  const live = event.start <= now && event.end > now;
  const linked = event.link ? DISCORD_MESSAGE.exec(event.link) : null;
  const outside = event.link && !linked && /^https?:\/\//i.test(event.link) ? event.link : undefined;

  // A listing line that points at the card in the same channel opens the card itself.
  const openPost = () =>
    client.navigate({
      view: "server",
      guildId: event.guildId,
      channelId: event.channelId,
      anchor: linked && linked[1] === event.channelId ? linked[2]! : event.messageId,
    });

  const downloadIcs = () => {
    const blob = new Blob([toICS(postedCalendarEntry(event), guild?.name)], { type: "text/calendar" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${event.title.replace(/[^\w\s-]/g, "").slice(0, 60) || "event"}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="flex gap-3 rounded-lg border border-line bg-bg p-3">
      <div className="flex w-12 shrink-0 flex-col items-center self-start rounded-md bg-surface py-1.5">
        <span className="text-[10.5px] font-bold tracking-wide text-danger">{parts.month}</span>
        <span className="text-[19px] font-bold leading-tight">{parts.day}</span>
        <span className="text-[10.5px] text-muted">{parts.weekday}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] font-semibold">
          {live ? <span className="text-accent">Happening now</span> : <span className="text-muted">{parts.time} · {formatRelative(event.start)}</span>}
          {isPhysicalLocation(event.location) && <span className="rounded bg-accent-soft px-1.5 text-[11px] text-accent">In person</span>}
        </div>
        <button onClick={openPost} className="mt-0.5 block text-left text-[15.5px] font-semibold leading-snug hover:underline">
          {event.title}
        </button>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-muted">
          {event.location && (
            <span className="flex min-w-0 items-center gap-1">
              <MapPin size={12} className="shrink-0" /> <span className="truncate">{event.location}</span>
            </span>
          )}
          <span className="flex min-w-0 items-center gap-1">
            {guild && <span className="truncate">{guild.name}</span>}
            {channel && (
              <span className="flex shrink-0 items-center">
                <Hash size={11} />
                {channel.name}
              </span>
            )}
          </span>
        </div>
        {!compact && event.description && (
          <div onClick={() => setExpanded((x) => !x)} className={`mt-1.5 cursor-pointer text-[13.5px] text-text/85 ${expanded ? "" : "line-clamp-2"}`}>
            <Markdown content={event.description} guildId={event.guildId} />
          </div>
        )}
        {!compact && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <IconButton label="Open post" onClick={openPost}>
              <MessageSquare size={16} />
            </IconButton>
            <IconButton label="Add to Google Calendar" onClick={() => client.platform.shell.openExternal(googleCalendarUrl(postedCalendarEntry(event), guild?.name))}>
              <CalendarPlus size={16} />
            </IconButton>
            <IconButton label="Download .ics" onClick={downloadIcs}>
              <Download size={16} />
            </IconButton>
            {outside && (
              <IconButton label="Open link" onClick={() => client.platform.shell.openExternal(outside)}>
                <ExternalLink size={16} />
              </IconButton>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
