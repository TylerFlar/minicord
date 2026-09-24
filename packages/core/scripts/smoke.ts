/**
 * Read-only smoke test against a real account: connect once, inspect READY, watch
 * ~20s of events, make three GET requests, disconnect. Prints counts and shapes only.
 *
 *   DISCORD_TOKEN in ../../.env  →  pnpm smoke
 */
import {
  createSession,
  FALLBACK_BUILD_NUMBER,
  FALLBACK_CHROME_MAJOR,
  fetchBuildNumber,
  fetchChromeMajor,
  fetchHttp,
  isUpcomingOrLive,
  Store,
  webIdentity,
  type GatewayDispatch,
} from "../src/index.ts";
import { gatewayHeaders, nodeSocketFactory } from "../src/node.ts";
import { loadEnv, requireEnv } from "./env.ts";

const WATCH_MS = 20_000;

async function main() {
  const token = requireEnv(loadEnv(), "DISCORD_TOKEN", "Add your token to .env.");
  const chromeMajor = (await fetchChromeMajor(fetchHttp)) ?? FALLBACK_CHROME_MAJOR;
  const probe = webIdentity({ chromeMajor, buildNumber: FALLBACK_BUILD_NUMBER });
  const buildNumber = (await fetchBuildNumber(fetchHttp, probe.userAgent)) ?? FALLBACK_BUILD_NUMBER;
  const identity = webIdentity({ chromeMajor, buildNumber });
  console.log(`identity: Chrome ${chromeMajor}, build ${buildNumber}, tz ${identity.timezone}`);

  const session = createSession({
    token,
    identity,
    socketFactory: nodeSocketFactory(() => gatewayHeaders(identity.userAgent, identity.locale)),
    http: fetchHttp,
    logger: (m) => console.log(m),
  });

  const counts = new Map<string, number>();
  let ready: GatewayDispatch | null = null;
  let supplemental: GatewayDispatch | null = null;
  const readyAt = new Promise<void>((res, rej) => {
    const timer = setTimeout(() => rej(new Error("no READY within 30s")), 30_000);
    session.host.on("event", (e) => {
      counts.set(e.t, (counts.get(e.t) ?? 0) + 1);
      if (e.t === "READY") {
        ready = e;
        clearTimeout(timer);
        res();
      }
      if (e.t === "READY_SUPPLEMENTAL") supplemental = e;
    });
    session.host.on("fatal", (f) => rej(new Error(`fatal close ${f.code} ${f.reason}`)));
  });

  const started = Date.now();
  session.host.start();
  await readyAt;
  console.log(`READY after ${Date.now() - started}ms`);

  const d = (ready as unknown as GatewayDispatch).d as Record<string, any>;
  console.log("READY keys:", Object.keys(d).sort().join(", "));
  const firstGuild = (d.guilds as any[]).find((g) => !g.unavailable);
  console.log("guild keys:", Object.keys(firstGuild ?? {}).sort().join(", "));
  console.log("guild.properties?:", !!firstGuild?.properties, "data_mode:", firstGuild?.data_mode);
  console.log("read_state shape:", Array.isArray(d.read_state) ? "array" : Object.keys(d.read_state ?? {}).join("/"));
  if (d.auth_token) console.log("!! READY contained auth_token (token refresh) — should not happen");

  const store = new Store();
  store.hydrate(d, (supplemental as GatewayDispatch | null)?.d as Record<string, unknown> | undefined);
  const now = Date.now();
  const upcoming = [...store.events.values()].filter((e) => isUpcomingOrLive(e, now));
  console.log(
    `store: ${store.guilds.size} guilds (${(d.guilds as any[]).filter((g) => g.unavailable).length} unavailable), ` +
      `${store.channels.size} channels, ${store.privateChannelIds.size} DMs (${store.unreadDms().length} unread), ` +
      `${store.friends().length} friends, ${store.readStates.size} read states, ${store.guildSettings.size} guild settings, ` +
      `${upcoming.length} upcoming events across ${new Set(upcoming.map((e) => e.guild_id)).size} servers`,
  );
  const visible = [...store.guilds.keys()].reduce((n, g) => n + store.guildChannelGroups(g).flatMap((x) => x.channels).length, 0);
  console.log(`visible guild channels after permission filtering: ${visible}`);

  // Three read-only requests, spaced like a person opening the app.
  const mentions = await session.api.recentMentions({ limit: 10 });
  console.log(`recent mentions (last 7 days, up to 10): ${mentions.length}`);
  const guildWithEvents = upcoming[0]?.guild_id;
  if (guildWithEvents) {
    const events = await session.api.scheduledEvents(guildWithEvents);
    console.log(`scheduled events in one server (with user counts): ${events.length}, first has user_count=${events[0]?.user_count}`);
    const mine = await session.api.myScheduledEvents(guildWithEvents);
    console.log(`my RSVPs in that server: ${Array.isArray(mine) ? mine.length : JSON.stringify(mine).slice(0, 120)}`);
  }

  console.log(`watching events for ${WATCH_MS / 1000}s...`);
  await new Promise((r) => setTimeout(r, WATCH_MS));
  const summary = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}×${n}`);
  console.log("dispatch counts:", summary.join(", "));
  const snap = session.host.snapshot();
  console.log(`replay snapshot: backlog ${snap.backlog.length} events`);

  session.gateway.close(1000);
  console.log("closed");
}

main().catch((err) => {
  console.error("smoke failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
