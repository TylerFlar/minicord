import { isInPerson, isUpcomingOrLive, rules as R, snowflakeToMs, sortByStart, type PermissionState } from "@minicord/core";
import { BellRing, Hourglass, Lock, Sun, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar } from "../components/Avatar.tsx";
import { EventCard } from "../components/EventCard.tsx";
import { Count } from "../components/Sidebar.tsx";
import { Button, SectionTitle } from "../components/ui.tsx";
import type { InboxItem } from "../app/client.ts";
import { useClient, useNow, useSignals, useStore } from "../app/context.tsx";
import { formatStamp } from "../lib/format.ts";
import { messagePreview } from "../lib/preview.ts";

export function InboxScreen() {
  const client = useSignals(["inbox", "rules"]);
  const store = useStore(["dms", "readstates", "events", "guilds", "channels"]);
  const now = useNow(60_000);
  const unread = store.unreadDms();
  const items = client.visibleInbox();
  const upcoming = sortByStart([...store.events.values()].filter((e) => isUpcomingOrLive(e, now)));
  const soon = upcoming.filter((e) => Date.parse(e.scheduled_start_time) - now < 7 * 86_400_000);
  const caughtUp = unread.length === 0 && items.length === 0;
  const nextInPerson = upcoming.find(isInPerson);

  return (
    <div className="flex-1 overflow-y-auto bg-surface">
      <div className="mx-auto max-w-2xl px-4 py-5 sm:px-6 sm:py-8">
        <div className="mb-5 flex items-center justify-between">
          <h1 className="text-[22px] font-bold">Inbox</h1>
          {items.length > 0 && (
            <Button size="sm" tone="quiet" onClick={() => client.dismissAll(items)}>
              Clear all
            </Button>
          )}
        </div>

        <BackgroundPermissions />

        {caughtUp && (
          <div className="mb-8 rounded-xl bg-bg px-6 py-8 text-center">
            <Sun className="mx-auto mb-2 text-warn" size={28} />
            <div className="text-[17px] font-semibold">You're caught up</div>
            {nextInPerson && (
              <div className="mt-4 text-left">
                <EventCard event={nextInPerson} compact />
              </div>
            )}
            <Button className="mt-5" onClick={() => client.done()}>
              Done for now
            </Button>
          </div>
        )}

        {unread.length > 0 && (
          <>
            <SectionTitle>Messages</SectionTitle>
            <div className="flex flex-col">
              {unread.map((c) => (
                <button
                  key={c.id}
                  onClick={() => client.navigate({ view: "dms", channelId: c.id })}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-sunken"
                >
                  <Avatar user={store.recipients(c)[0]} size={36} />
                  <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{store.channelName(c)}</span>
                  <span className="text-[12px] text-faint">{c.last_message_id ? formatStamp(snowflakeToMs(c.last_message_id)) : ""}</span>
                  {store.mentionCount(c.id) > 0 ? <Count n={store.mentionCount(c.id)} strong /> : <span className="h-2 w-2 rounded-full bg-text" />}
                </button>
              ))}
            </div>
          </>
        )}

        {items.length > 0 && (
          <>
            <SectionTitle>Mentions</SectionTitle>
            <div className="flex flex-col gap-0.5">
              {items.map((item) => (
                <InboxRow key={item.id} item={item} />
              ))}
            </div>
          </>
        )}

        {soon.length > 0 && (
          <>
            <SectionTitle
              action={
                <Button size="sm" tone="quiet" onClick={() => client.navigate({ view: "events" })}>
                  All events
                </Button>
              }
            >
              This week
            </SectionTitle>
            <div className="flex flex-col gap-2">
              {soon.slice(0, 4).map((e) => (
                <EventCard key={e.id} event={e} compact />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Android: without these, the background service can't reliably deliver DMs and pings. */
function BackgroundPermissions() {
  const client = useClient();
  const [state, setState] = useState<PermissionState | null>(null);
  useEffect(() => {
    const shell = client.platform.shell;
    if (!shell.permissions) return;
    const refresh = () => void shell.permissions?.().then(setState);
    refresh();
    return shell.onFocusChange((focused) => focused && refresh());
  }, [client]);
  if (!state || (state.notifications && state.batteryUnrestricted)) return null;
  return (
    <div className="mb-6 flex items-center gap-3 rounded-xl bg-bg p-3.5">
      <BellRing size={20} className="shrink-0 text-accent" />
      <div className="min-w-0 flex-1 text-[14px] font-medium">{!state.notifications ? "Notifications are off" : "Background delivery is restricted"}</div>
      <Button size="sm" tone="accent" onClick={() => void client.platform.shell.requestPermissions?.().then(setState)}>
        {!state.notifications ? "Allow" : "Fix"}
      </Button>
    </div>
  );
}

export function InboxRow({ item, showGuild = true }: { item: InboxItem; showGuild?: boolean }) {
  const client = useClient();
  const store = client.store;
  const m = item.message;
  const channel = store.channels.get(item.channelId);
  const guild = item.guildId ? store.guilds.get(item.guildId) : undefined;
  const vaulted = guild ? R.modeOf(client.rules.config, guild.id) === "vault" : false;

  const open = () => {
    if (!guild) return client.navigate({ view: "dms", channelId: item.channelId, anchor: m.id });
    if (vaulted) client.openPass({ guildId: guild.id, channelId: item.channelId, kind: "mention", anchorMessageId: m.id });
    else client.navigate({ view: "server", guildId: guild.id, channelId: item.channelId, anchor: m.id });
  };

  return (
    <div className="group flex items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-sunken">
      <Avatar user={store.users.get(m.author.id) ?? m.author} size={36} />
      <button onClick={vaulted ? undefined : open} className={`min-w-0 flex-1 text-left ${vaulted ? "cursor-default" : ""}`}>
        <div className="flex min-w-0 items-baseline gap-1.5 text-[13px] text-muted">
          <span className="shrink-0 text-[14.5px] font-semibold text-text" style={{ color: store.roleColor(item.guildId, m.author.id, m.member) }}>
            {store.authorName(m)}
          </span>
          <span className="truncate">
            #{channel?.name ?? "channel"}
            {showGuild && guild ? ` · ${guild.name}` : ""}
          </span>
          {vaulted && showGuild && <Lock size={11} className="shrink-0 self-center" />}
          <span className="ml-auto shrink-0 text-[11.5px] text-faint">{formatStamp(item.at)}</span>
        </div>
        <div className="mt-0.5 line-clamp-2 text-[14.5px] leading-snug">{messagePreview(m, store, 220)}</div>
      </button>
      {vaulted && (
        <Button size="sm" className="self-center" onClick={open} title={`Opens a ${client.rules.config.passMinutes}-minute pass`}>
          <Hourglass size={13} /> Reply
        </Button>
      )}
      <button
        onClick={() => client.dismiss(item)}
        className="self-center rounded-md p-1 text-faint hover:bg-bg hover:text-text sm:opacity-0 sm:group-hover:opacity-100 [@media(hover:none)]:opacity-100"
        aria-label="Dismiss"
        title="Dismiss"
      >
        <X size={16} />
      </button>
    </div>
  );
}
