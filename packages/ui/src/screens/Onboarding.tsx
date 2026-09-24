import { rules as R } from "@minicord/core";
import { useState } from "react";
import { GuildIcon } from "../components/Avatar.tsx";
import { Button, Card } from "../components/ui.tsx";
import { useSignals, useStore } from "../app/context.tsx";

export function OnboardingScreen() {
  const client = useSignals(["rules"]);
  const store = useStore(["guilds"]);
  const guilds = store.sortedGuilds();
  const [modes, setModes] = useState<Record<string, R.GuildMode>>(() =>
    Object.fromEntries(guilds.map((g) => [g.id, client.rules.config.guildModes[g.id] ?? "vault"])),
  );
  const openCount = Object.values(modes).filter((m) => m === "open").length;

  const finish = () => {
    for (const [guildId, mode] of Object.entries(modes)) client.requestChange({ kind: "guildMode", guildId, mode });
    client.finishOnboarding();
  };

  return (
    <div className="h-full overflow-y-auto bg-bg">
      <div className="mx-auto max-w-xl px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-[24px] font-bold">Sort your servers</h1>
        <p className="mt-2 text-[14.5px] text-muted">
          Vaulted servers only show mentions, replies and events. Vaulting is instant; opening back up takes {client.rules.config.cooldownHours}h.
        </p>
        <Card className="mt-6">
          {guilds.map((g) => (
            <div key={g.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
              <GuildIcon guild={g} size={28} muted={modes[g.id] === "vault"} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium">{g.name}</div>
                {g.member_count ? <div className="text-[12px] text-muted">{g.member_count.toLocaleString()} members</div> : null}
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
