import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { MinicordClient } from "./client.ts";

const ClientContext = createContext<MinicordClient | null>(null);

export function ClientProvider({ client, children }: { client: MinicordClient; children: ReactNode }) {
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

export function useClient(): MinicordClient {
  const client = useContext(ClientContext);
  if (!client) throw new Error("useClient outside ClientProvider");
  return client;
}

/** Re-render when any of these Store keys change (e.g. "guilds", `messages:${id}`). */
export function useStore(keys: string[]): MinicordClient["store"] {
  const client = useClient();
  useSyncExternalStore(
    (fn) => client.store.subscribe(keys, fn),
    () => keys.map((k) => client.store.version(k)).join(","),
  );
  return client.store;
}

/** Re-render when any of these app-state keys change ("route", "rules", "inbox", ...). */
export function useSignals(keys: string[]): MinicordClient {
  const client = useClient();
  useSyncExternalStore(
    (fn) => client.signals.subscribe(keys, fn),
    () => keys.map((k) => client.signals.version(k)).join(","),
  );
  return client;
}

/** A clock that ticks every `intervalMs` (for countdowns and relative times). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
