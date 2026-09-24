import { eventStart, eventUrl, googleCalendarUrl, isInPerson, rules as R, ScheduledEventStatus, toICS, type ScheduledEvent } from "@minicord/core";
import { CalendarPlus, Download, ExternalLink, MapPin, MessageSquare, Star, Users, Volume2 } from "lucide-react";
import { useState } from "react";
import { useClient, useStore } from "../app/context.tsx";
import { eventDateParts, formatRelative } from "../lib/format.ts";
import { Button, IconButton } from "./ui.tsx";

export function EventCard({ event, compact = false }: { event: ScheduledEvent; compact?: boolean }) {
  const client = useClient();
  const store = useStore(["events", "guilds"]);
  const [expanded, setExpanded] = useState(false);
  const guild = store.guilds.get(event.guild_id);
  const start = eventStart(event);
  const parts = eventDateParts(start);
  const interested = store.myRsvps.has(event.id);
  const live = event.status === ScheduledEventStatus.Active;
  const location = event.entity_metadata?.location;
  const voiceChannel = event.channel_id ? store.channels.get(event.channel_id) : undefined;
  const vaulted = guild ? R.modeOf(client.rules.config, guild.id) === "vault" : false;

  const downloadIcs = () => {
    const blob = new Blob([toICS(event, guild?.name)], { type: "text/calendar" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${event.name.replace(/[^\w\s-]/g, "").slice(0, 60) || "event"}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const discuss = () => {
    if (!guild) return;
    const target = event.channel_id && voiceChannel && voiceChannel.type !== 2 && voiceChannel.type !== 13 ? event.channel_id : undefined;
    if (vaulted) client.navigate({ view: "vault", guildId: guild.id });
    else client.navigate({ view: "server", guildId: guild.id, ...(target ? { channelId: target } : {}) });
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
          {live ? <span className="text-accent">Happening now</span> : <span className="text-muted">{parts.time} · {formatRelative(start)}</span>}
          {isInPerson(event) && <span className="rounded bg-accent-soft px-1.5 text-[11px] text-accent">In person</span>}
        </div>
        <div className="mt-0.5 text-[15.5px] font-semibold leading-snug">{event.name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-muted">
          {location && (
            <span className="flex min-w-0 items-center gap-1">
              <MapPin size={12} className="shrink-0" /> <span className="truncate">{location}</span>
            </span>
          )}
          {!location && voiceChannel && (
            <span className="flex items-center gap-1">
              <Volume2 size={12} /> {voiceChannel.name}
            </span>
          )}
          {guild && <span>{guild.name}</span>}
          {typeof event.user_count === "number" && (
            <span className="flex items-center gap-1">
              <Users size={12} /> {event.user_count}
            </span>
          )}
        </div>
        {!compact && event.description && (
          <p onClick={() => setExpanded((x) => !x)} className={`mt-1.5 cursor-pointer whitespace-pre-wrap text-[13.5px] text-text/85 ${expanded ? "" : "line-clamp-2"}`}>
            {event.description}
          </p>
        )}
        {!compact && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <Button size="sm" tone={interested ? "accent" : "default"} onClick={() => void client.setInterested(event, !interested)}>
              <Star size={13} fill={interested ? "currentColor" : "none"} /> Interested
            </Button>
            <IconButton label="Add to Google Calendar" onClick={() => client.platform.shell.openExternal(googleCalendarUrl(event, guild?.name))}>
              <CalendarPlus size={16} />
            </IconButton>
            <IconButton label="Download .ics" onClick={downloadIcs}>
              <Download size={16} />
            </IconButton>
            <IconButton label="Discuss" onClick={discuss}>
              <MessageSquare size={16} />
            </IconButton>
            <IconButton label="Open in Discord" onClick={() => client.platform.shell.openExternal(eventUrl(event))}>
              <ExternalLink size={16} />
            </IconButton>
          </div>
        )}
      </div>
    </div>
  );
}
