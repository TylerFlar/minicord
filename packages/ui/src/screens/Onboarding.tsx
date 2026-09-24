import { rules as R } from "@minicord/core";
import { Hash } from "lucide-react";
import { useState } from "react";
import { GuildIcon } from "../components/Avatar.tsx";
import { Button, Card } from "../components/ui.tsx";
import { useSignals, useStore } from "../app/context.tsx";

export function OnboardingScreen() {
  const client = useSignals(["rules"]);
  const store = useStore(["guilds", "channels"]);
  const guilds = store.sortedGuilds();
  const [modes, setModes] = useState<Record<string, R.GuildMode>>(() =>
    Object.fromEntries(guilds.map((g) => [g.id, client.rules.config.guildModes[g.id] ?? "vault"])),
  );
  const openCount = Object.values(modes).filter((m) => m === "open").length;
  const [picked, setPicked] = useState<Set<string>>(() => new Set(Object.keys(client.rules.config.eventChannels)));
  const toggle = (channelId: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (!next.delete(channelId)) next.add(channelId);
      return next;
    });

  const finish = () => {
    for (const [guildId, mode] of Object.entries(modes)) client.requestChange({ kind: "guildMode", guildId, mode });
    // Still onboarding, so these apply now rather than after the cooldown.
    for (const channelId of picked) {
      const channel = store.channels.get(channelId);
      if (channel) client.setEventChannel(channel, true);
    }
    client.finishOnboarding();
  };

  return (
    <div className="h-full overflow-y-auto bg-bg">
      <div className="mx-auto max-w-xl px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-[24px] font-bold">Sort your servers</h1>
        <p className="mt-2 text-[14.5px] text-muted">
          Vaulted servers only show mentions, replies and events. Vaulting is instant; opening back up takes {client.rules.config.cooldownHours}h.
          Tap a channel where a server posts events to keep it readable and on your agenda.
        </p>
        <Card className="mt-6">
          {guilds.map((g) => (
            <div key={g.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
              <GuildIcon guild={g} size={28} muted={modes[g.id] === "vault"} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium">{g.name}</div>
                {g.member_count ? <div className="text-[12px] text-muted">{g.member_count.toLocaleString()} members</div> : null}
                <EventChannelChips guildId={g.id} picked={picked} onToggle={toggle} />
              </div>
              <div className="inline-flex rounded-md border border-line p-0.5 text-[12.5px]">
                {(["open", "vault"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setModes((s) => ({ ...s, [g.id]: m }))}
                    className={`rounded px-2.5 py-0.5 ${modes[g.id] === m ? "bg-sunken font-medium text-text" : "text-muted"}`}
                  >
                    {m === "open" ? "Open" : "Vault"}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Card>
        <div className="mt-6 flex items-center justify-between">
          <span className="text-[13px] text-muted">
            {openCount} open · {guilds.length - openCount} vaulted
          </span>
          <Button tone="accent" onClick={finish}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Suggested event channels for a server, as chips to keep readable. */
function EventChannelChips({ guildId, picked, onToggle }: { guildId: string; picked: Set<string>; onToggle: (channelId: string) => void }) {
  const client = useSignals(["rules"]);
  const store = useStore([`channels:${guildId}`]);
  const chosen = [...picked].map((id) => store.channels.get(id)).filter((c) => c?.guild_id === guildId);
  const channels = [...chosen, ...client.eventChannelSuggestions(guildId).filter((c) => !picked.has(c.id))];
  if (!channels.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {channels.map((c) => (
        <button
          key={c!.id}
          onClick={() => onToggle(c!.id)}
          className={`flex max-w-full items-center gap-0.5 rounded-full px-2 py-0.5 text-[12px] ${picked.has(c!.id) ? "bg-accent-soft font-medium text-accent" : "bg-sunken text-muted hover:text-text"}`}
        >
          <Hash size={11} className="shrink-0" />
          <span className="truncate">{c!.name}</span>
        </button>
      ))}
    </div>
  );
}
