import { ChannelType, rules as R, type Channel } from "@minicord/core";
import { Clock, Hash, Plus, X } from "lucide-react";
import { useNow, useSignals, useStore } from "../app/context.tsx";
import { formatDuration } from "../lib/format.ts";
import { IconButton } from "./ui.tsx";

/**
 * Event channels of one server (on its vault page) or of every server (on Events): the ones
 * chosen, the ones waiting out the cooldown, and suggestions.
 */
export function EventChannels({ guildId }: { guildId?: string }) {
  const client = useSignals(["rules"]);
  const store = useStore(["guilds", "channels"]);
  const now = useNow(60_000);
  const { config } = client.rules;
  const guildIds = guildId ? [guildId] : store.sortedGuilds().map((g) => g.id);
  const inScope = (id: string) => guildIds.includes(id);

  const chosen = Object.entries(config.eventChannels)
    .filter(([, g]) => inScope(g))
    .map(([id]) => store.channels.get(id))
    .filter((c): c is Channel => !!c);
  const pending = R.pendingEventChannels(client.rules).filter((p) => inScope(p.change.guildId));
  const suggestions = guildIds.flatMap((g) => client.eventChannelSuggestions(g, guildId ? 3 : 2));
  const taken = new Set([...chosen.map((c) => c.id), ...pending.map((p) => p.change.channelId), ...suggestions.map((c) => c.id)]);
  const others = guildId
    ? store
        .guildChannelGroups(guildId)
        .flatMap((g) => g.channels)
        .filter((c) => (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement) && !taken.has(c.id))
    : [];

  const where = (c: { guild_id?: string | null }) => (!guildId && c.guild_id ? store.guilds.get(c.guild_id)?.name : undefined);
  const row = "flex min-h-9 items-center gap-2 rounded-md px-2 text-[14px]";

  return (
    <div className="flex flex-col gap-0.5">
      {chosen.map((c) => (
        <div key={c.id} className={`${row} hover:bg-sunken`}>
          <button className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => client.navigate({ view: "server", guildId: c.guild_id!, channelId: c.id })}>
            <Hash size={15} className="shrink-0 text-muted" />
            <span className="truncate font-medium">{c.name}</span>
            {where(c) && <span className="truncate text-[12.5px] text-muted">{where(c)}</span>}
          </button>
          <IconButton label="Remove" onClick={() => client.setEventChannel(c, false)}>
            <X size={15} />
          </IconButton>
        </div>
      ))}
      {pending.map((p) => {
        const c = store.channels.get(p.change.channelId);
        return (
          <div key={p.id} className={`${row} text-muted`}>
            <Hash size={15} className="shrink-0" />
            <span className="truncate">{c?.name ?? "channel"}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1 text-[12.5px] text-warn">
              <Clock size={12} /> {formatDuration(p.effectiveAt - now)}
              <button className="underline" onClick={() => client.cancelPending(p.id)}>
                cancel
              </button>
            </span>
          </div>
        );
      })}
      {suggestions.map((c) => (
        <button key={c.id} className={`${row} text-left text-muted hover:bg-sunken hover:text-text`} onClick={() => client.setEventChannel(c, true)}>
          <Plus size={15} className="shrink-0" />
          <span className="truncate">{c.name}</span>
          {where(c) && <span className="truncate text-[12.5px]">{where(c)}</span>}
        </button>
      ))}
      {others.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            const c = store.channels.get(e.target.value);
            if (c) client.setEventChannel(c, true);
          }}
          className="mt-1 rounded-md bg-sunken px-2 py-1.5 text-[13.5px] text-muted outline-none"
        >
          <option value="">Other channel…</option>
          {others.map((c) => (
            <option key={c.id} value={c.id}>
              #{c.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
