import type { rules } from "@minicord/core";
import { Hourglass } from "lucide-react";
import { useEffect } from "react";
import { useClient, useNow, useSignals } from "../app/context.tsx";
import { formatCountdown } from "../lib/format.ts";
import { Button } from "./ui.tsx";

export function PassBanner({ pass, grace }: { pass: rules.Pass; grace?: boolean }) {
  const client = useSignals(["rules"]);
  const now = useNow(1000);
  const left = pass.endsAt - now;
  const urgent = left < 60_000;

  if (grace || left <= 0) {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-line bg-warn-soft px-4 py-2 text-[13px] text-warn">
        <span>Pass ended</span>
        <Button size="sm" onClick={() => client.navigate({ view: "vault", guildId: pass.guildId })}>
          Back to vault
        </Button>
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-between gap-3 border-b border-line px-4 py-2 text-[13px] ${urgent ? "bg-warn-soft text-warn" : "bg-accent-soft text-accent"}`}>
      <span className="flex min-w-0 items-center gap-2">
        <Hourglass size={14} className="shrink-0" />
        <span className="font-semibold tabular-nums">{formatCountdown(left)}</span>
        {pass.reason && <span className="truncate opacity-80">· {pass.reason}</span>}
      </span>
      <span className="flex shrink-0 gap-1.5">
        {!pass.extended && (
          <Button size="sm" tone="quiet" onClick={() => client.extendPass(pass.id)}>
            +{client.rules.config.passExtensionMinutes} min
          </Button>
        )}
        <Button size="sm" onClick={() => client.endPass(pass.id)}>
          Done
        </Button>
      </span>
    </div>
  );
}

/** Watches for a pass running out while you're in the channel, and sends you back to the vault card. */
export function usePassExpiry(pass: rules.Pass | undefined, grace: boolean | undefined): void {
  const client = useClient();
  const now = useNow(1000);
  const expired = !!pass && !!grace && pass.endedAt !== undefined && now - pass.endedAt > 60_000;
  const guildId = pass?.guildId;
  useEffect(() => {
    if (expired && guildId) client.navigate({ view: "vault", guildId });
  }, [client, expired, guildId]);
}
