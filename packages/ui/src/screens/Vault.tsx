import { ChannelType, isUpcomingOrLive, rules as R, sortByStart } from "@minicord/core";
import { ArrowLeft, Clock, DoorOpen, Hourglass, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { GuildIcon } from "../components/Avatar.tsx";
import { EventCard } from "../components/EventCard.tsx";
import { Button, IconButton, SectionTitle } from "../components/ui.tsx";
import { useNow, useSignals, useStore } from "../app/context.tsx";
import { formatCountdown, formatDuration, formatPause, formatStamp } from "../lib/format.ts";
import { useIsMobile } from "../lib/responsive.ts";
import { InboxRow } from "./Inbox.tsx";

export function VaultScreen({ guildId }: { guildId: string }) {
  const client = useSignals(["rules", "inbox"]);
  const store = useStore(["guilds", `channels:${guildId}`, "events"]);
  const now = useNow(1000);
  const guild = store.guilds.get(guildId);
  const mobile = useIsMobile();
  const [channelId, setChannelId] = useState("");
  const mode = R.modeOf(client.rules.config, guildId);
  useEffect(() => {
    if (mode !== "vault") client.navigate({ view: "server", guildId });
  }, [client, mode, guildId]);
  if (!guild || mode !== "vault") return null;

  const { rules } = client;
  const pending = R.pendingFor(rules, guildId);
  const items = client.visibleInbox().filter((i) => i.guildId === guildId);
  const events = sortByStart([...store.events.values()].filter((e) => e.guild_id === guildId && isUpcomingOrLive(e, now)));
  const textChannels = store
    .guildChannelGroups(guildId)
    .flatMap((g) => g.channels)
    .filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement);
  const left = R.manualPassesLeft(rules, now);
  const active = R.activePasses(rules, now).filter((p) => p.guildId === guildId);
  const history = rules.passes.filter((p) => p.guildId === guildId && p.endedAt !== undefined).slice(-5).reverse();
  const waiting = rules.passRequest?.guildId === guildId ? rules.passRequest : undefined;
  const field = "w-full rounded-md bg-sunken px-3 py-2 text-[14.5px] outline-none focus:ring-2 focus:ring-accent/40";

  return (
    <div className="flex-1 overflow-y-auto bg-surface">
      <div className="mx-auto max-w-2xl px-4 py-5 sm:px-6 sm:py-8">
        <div className="mb-6 flex items-center gap-3">
          {mobile && (
            <IconButton label="Back" onClick={() => client.back()} className="-ml-2">
              <ArrowLeft size={19} />
            </IconButton>
          )}
          <GuildIcon guild={guild} size={mobile ? 40 : 48} muted />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[21px] font-bold leading-tight">{guild.name}</h1>
            <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted">
              <Lock size={12} /> Vaulted
              {pending && (
                <span className="ml-2 flex items-center gap-1 text-warn">
                  <Clock size={12} /> opens in {formatDuration(pending.effectiveAt - now)}
                  <button className="underline" onClick={() => client.cancelPending(pending.id)}>
                    cancel
                  </button>
                </span>
              )}
            </div>
          </div>
          {!pending && (
            <Button size="sm" tone="quiet" onClick={() => client.requestChange({ kind: "guildMode", guildId, mode: "open" })} title={`Takes ${rules.config.cooldownHours}h`}>
              <DoorOpen size={15} /> Unvault
            </Button>
          )}
        </div>

        {active.map((p) => (
          <div key={p.id} className="mb-4 flex items-center justify-between gap-3 rounded-lg bg-accent-soft px-4 py-3 text-accent">
            <span className="flex min-w-0 items-center gap-2 text-[14.5px]">
              <Hourglass size={15} className="shrink-0" />
              <span className="truncate font-medium">#{store.channels.get(p.channelId)?.name}</span>
              <span className="tabular-nums opacity-80">{formatCountdown(p.endsAt - now)}</span>
            </span>
            <Button size="sm" tone="accent" onClick={() => client.navigate({ view: "server", guildId, channelId: p.channelId })}>
              Go back in
            </Button>
          </div>
        ))}

        {items.length > 0 && (
          <>
            <SectionTitle>Mentions</SectionTitle>
            <div className="flex flex-col gap-0.5">
              {items.map((item) => (
                <InboxRow key={item.id} item={item} showGuild={false} />
              ))}
            </div>
          </>
        )}

        {events.length > 0 && (
          <>
            <SectionTitle>Events</SectionTitle>
            <div className="flex flex-col gap-2">
              {events.map((e) => (
                <EventCard key={e.id} event={e} />
              ))}
            </div>
          </>
        )}

        {!items.length && !events.length && <div className="rounded-lg bg-bg px-4 py-6 text-center text-[14px] text-muted">Nothing for you here.</div>}

        <SectionTitle
          action={
            <span className={`text-[12.5px] ${left === 0 ? "text-warn" : "text-muted"}`}>
              {left}/{rules.config.manualPassesPerDay} today
            </span>
          }
        >
          Pass
        </SectionTitle>
        {waiting ? (
          now < waiting.readyAt ? (
            // The pause: long enough for an impulse to pass, not so long that a real need does.
            <div className="flex flex-col items-center rounded-xl bg-bg px-6 py-8 text-center">
              <div className="relative flex h-36 w-36 items-center justify-center">
                <span className="breathe absolute inset-0 rounded-full bg-accent-soft" />
                <span className="relative text-[24px] font-semibold tabular-nums text-accent">{formatCountdown(waiting.readyAt - now)}</span>
              </div>
              <div className="mt-4 text-[14px] text-muted">#{store.channels.get(waiting.channelId)?.name ?? "channel"}</div>
              <Button tone="quiet" className="mt-2" onClick={() => client.cancelPassRequest()}>
                Never mind
              </Button>
            </div>
          ) : (
            <div className="rounded-xl bg-bg px-6 py-7 text-center">
              <div className="text-[18px] font-semibold">Still want to go in?</div>
              <div className="mt-1 text-[13.5px] text-muted">
                #{store.channels.get(waiting.channelId)?.name ?? "channel"} · {rules.config.passMinutes} min
              </div>
              <div className="mt-5 flex justify-center gap-2">
                <Button tone="accent" onClick={() => client.cancelPassRequest()}>
                  Not now
                </Button>
                <Button onClick={() => client.claimPass()}>Go in</Button>
              </div>
            </div>
          )
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <select value={channelId} onChange={(e) => setChannelId(e.target.value)} className={`${field} sm:flex-1`}>
              <option value="">Channel…</option>
              {textChannels.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))}
            </select>
            <Button
              tone="accent"
              className="shrink-0 justify-center"
              disabled={!channelId || left === 0}
              title={`Waits ${formatPause(R.passPause(rules, now))} first, then asks again`}
              onClick={() => client.requestPass(guildId, channelId)}
            >
              <Hourglass size={14} /> Open pass · {formatPause(R.passPause(rules, now))} pause
            </Button>
          </div>
        )}

        {history.length > 0 && (
          <div className="mt-6 flex flex-col gap-0.5 text-[12.5px] text-muted">
            {history.map((p) => (
              <div key={p.id} className="flex justify-between gap-3 px-1 py-0.5">
                <span className="truncate">
                  #{store.channels.get(p.channelId)?.name ?? "channel"}
                  {p.reason ? ` · ${p.reason}` : ""}
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatDuration((p.endedAt ?? p.endsAt) - p.startedAt)} · {p.messagesSent} sent · {formatStamp(p.startedAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
