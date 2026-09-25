/**
 * Live write test in a channel you configure (MINICORD_TEST_CHANNEL_ID in .env). Exercises the
 * real code paths — DiscordApi + gateway + Store — and verifies each step through gateway events:
 * send → react → who reacted → unreact → edit → reply → typing → ack → delete. Refuses to run
 * unless the channel is in a server you own.
 *
 *   pnpm smoke:write
 */
import {
  createSession,
  FALLBACK_BUILD_NUMBER,
  FALLBACK_CHROME_MAJOR,
  fetchBuildNumber,
  fetchChromeMajor,
  fetchHttp,
  GatewayOp,
  makeNonce,
  Store,
  webIdentity,
  type GatewayDispatch,
  type Message,
} from "../src/index.ts";
import { gatewayHeaders, nodeSocketFactory } from "../src/node.ts";
import { loadEnv, requireEnv } from "./env.ts";

const STEP_TIMEOUT = 15_000;
const PAUSE = 1_200; // human pace between writes

const env = loadEnv();
const token = requireEnv(env, "DISCORD_TOKEN", "Add your token to .env.");
const channelId = requireEnv(env, "MINICORD_TEST_CHANNEL_ID", "Pick a text channel in a server you own for write tests.");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const chromeMajor = (await fetchChromeMajor(fetchHttp)) ?? FALLBACK_CHROME_MAJOR;
  const probe = webIdentity({ chromeMajor, buildNumber: FALLBACK_BUILD_NUMBER });
  const identity = webIdentity({ chromeMajor, buildNumber: (await fetchBuildNumber(fetchHttp, probe.userAgent)) ?? FALLBACK_BUILD_NUMBER });
  const session = createSession({
    token,
    identity,
    socketFactory: nodeSocketFactory(() => gatewayHeaders(identity.userAgent, identity.locale)),
    http: fetchHttp,
  });
  const store = new Store();
  const waiters: { match: (e: GatewayDispatch) => boolean; resolve: (e: GatewayDispatch) => void }[] = [];
  session.host.on("event", (e) => {
    store.apply(e);
    for (const w of [...waiters]) {
      if (w.match(e)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(e);
      }
    }
  });
  const waitFor = (label: string, match: (e: GatewayDispatch) => boolean) =>
    new Promise<GatewayDispatch>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), STEP_TIMEOUT);
      waiters.push({ match, resolve: (e) => (clearTimeout(timer), resolve(e)) });
    });

  const ready = waitFor("READY", (e) => e.t === "READY");
  session.host.start();
  await ready;

  const channel = store.channels.get(channelId);
  const guild = channel?.guild_id ? store.guilds.get(channel.guild_id) : undefined;
  if (!channel || !guild) throw new Error("MINICORD_TEST_CHANNEL_ID isn't a server channel you can see.");
  if (guild.owner_id !== store.me?.id) throw new Error(`Refusing to write in "${guild.name}": you don't own that server.`);
  console.log(`writing in #${channel.name} (${guild.name})`);

  const results: [string, boolean, string?][] = [];
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      results.push([name, true]);
      console.log(`  ✓ ${name}`);
    } catch (err) {
      results.push([name, false, err instanceof Error ? err.message : String(err)]);
      console.log(`  ✗ ${name}: ${err instanceof Error ? err.message : err}`);
    }
    await sleep(PAUSE);
  };

  const { api } = session;
  const stamp = new Date().toISOString();
  let sent: Message | undefined;
  let reply: Message | undefined;

  await step("send message (nonce echoed back over the gateway)", async () => {
    const nonce = makeNonce();
    const created = waitFor("MESSAGE_CREATE", (e) => e.t === "MESSAGE_CREATE" && (e.d as Message).nonce === nonce);
    await api.sendMessage(channelId, { content: `minicord write test — ${stamp}`, nonce });
    sent = (await created).d as Message;
  });

  await step("add reaction", async () => {
    if (!sent) throw new Error("no message");
    const added = waitFor("MESSAGE_REACTION_ADD", (e) => e.t === "MESSAGE_REACTION_ADD" && (e.d as { message_id: string }).message_id === sent!.id);
    await api.addReaction(channelId, sent.id, { id: null, name: "👍" });
    await added;
  });

  await step("list who reacted", async () => {
    if (!sent) throw new Error("no message");
    const users = await api.reactions(channelId, sent.id, { id: null, name: "👍" });
    if (!users.some((u) => u.id === store.me?.id)) throw new Error("you're not in the list");
  });

  await step("remove reaction", async () => {
    if (!sent) throw new Error("no message");
    const removed = waitFor("MESSAGE_REACTION_REMOVE", (e) => e.t === "MESSAGE_REACTION_REMOVE" && (e.d as { message_id: string }).message_id === sent!.id);
    await api.removeReaction(channelId, sent.id, { id: null, name: "👍" });
    await removed;
  });

  await step("edit message", async () => {
    if (!sent) throw new Error("no message");
    const updated = waitFor("MESSAGE_UPDATE", (e) => e.t === "MESSAGE_UPDATE" && (e.d as Message).id === sent!.id);
    await api.editMessage(channelId, sent.id, `minicord write test (edited) — ${stamp}`);
    const d = (await updated).d as Message;
    if (!d.content?.includes("(edited)")) throw new Error("edit not reflected");
  });

  await step("reply to it", async () => {
    if (!sent) throw new Error("no message");
    const nonce = makeNonce();
    const created = waitFor("reply MESSAGE_CREATE", (e) => e.t === "MESSAGE_CREATE" && (e.d as Message).nonce === nonce);
    await api.sendMessage(channelId, { content: "minicord reply test", nonce, replyTo: { messageId: sent.id, channelId, guildId: guild.id, ping: false } });
    reply = (await created).d as Message;
    if (reply.referenced_message?.id !== sent.id) throw new Error("reply has no referenced_message");
  });

  await step("typing indicator (servers send it once subscribed, as the UI does on opening one)", async () => {
    session.gateway.send(GatewayOp.GuildSubscriptionsBulk, {
      subscriptions: { [guild.id]: { typing: true, threads: false, activities: true, member_updates: false, members: [], thread_member_lists: [], channels: {} } },
    });
    await sleep(1000);
    const typed = waitFor("TYPING_START", (e) => e.t === "TYPING_START" && (e.d as { channel_id: string }).channel_id === channelId);
    await api.typing(channelId);
    const d = (await typed).d as { member?: { user?: { id: string } } };
    if (d.member?.user?.id !== store.me?.id) throw new Error("TYPING_START came without the member");
  });

  await step("mark read (ack)", async () => {
    const last = reply?.id ?? sent?.id;
    if (!last) throw new Error("no message");
    await api.ack(channelId, last);
  });

  await step("delete both messages", async () => {
    for (const m of [reply, sent]) {
      if (!m) continue;
      const deleted = waitFor("MESSAGE_DELETE", (e) => e.t === "MESSAGE_DELETE" && (e.d as { id: string }).id === m.id);
      await api.deleteMessage(channelId, m.id);
      await deleted;
      await sleep(600);
    }
  });

  session.gateway.close(1000);
  const failed = results.filter(([, ok]) => !ok);
  console.log(failed.length ? `${failed.length} step(s) failed` : "all write steps passed");
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error("smoke:write failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
