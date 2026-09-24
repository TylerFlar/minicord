/**
 * End-to-end notification check: posts a message that pings you in MINICORD_TEST_CHANNEL_ID from a
 * temporary webhook (your own messages never notify), then removes the webhook. Run it while
 * minicord is in the background and watch for the notification.
 *
 *   pnpm smoke:notify
 */
import {
  DiscordApiError,
  FALLBACK_BUILD_NUMBER,
  FALLBACK_CHROME_MAJOR,
  fetchBuildNumber,
  fetchChromeMajor,
  fetchHttp,
  ClientProperties,
  RestClient,
  webIdentity,
  type Channel,
  type Guild,
  type User,
} from "../src/index.ts";
import { loadEnv, requireEnv } from "./env.ts";

const env = loadEnv();
const token = requireEnv(env, "DISCORD_TOKEN", "Add your token to .env.");
const channelId = requireEnv(env, "MINICORD_TEST_CHANNEL_ID", "Pick a text channel in a server you own for write tests.");

async function main() {
  const chromeMajor = (await fetchChromeMajor(fetchHttp)) ?? FALLBACK_CHROME_MAJOR;
  const probe = webIdentity({ chromeMajor, buildNumber: FALLBACK_BUILD_NUMBER });
  const props = new ClientProperties(webIdentity({ chromeMajor, buildNumber: (await fetchBuildNumber(fetchHttp, probe.userAgent)) ?? FALLBACK_BUILD_NUMBER }));
  const rest = new RestClient({ token, http: fetchHttp, baseHeaders: () => props.headers() });

  const me = await rest.get<User>("/users/@me");
  const channel = await rest.get<Channel>(`/channels/${channelId}`);
  const guild = channel.guild_id ? await rest.get<Guild>(`/guilds/${channel.guild_id}`) : null;
  if (!guild || guild.owner_id !== me.id) throw new Error("MINICORD_TEST_CHANNEL_ID must be in a server you own.");
  console.log(`pinging you in #${channel.name} (${guild.name}) from a temporary webhook`);

  const hook = await rest.post<{ id: string; token: string }>(`/channels/${channelId}/webhooks`, { name: "minicord notify test" });
  try {
    const res = await fetchHttp({
      method: "POST",
      url: `https://discord.com/api/v9/webhooks/${hook.id}/${hook.token}?wait=true`,
      headers: { "Content-Type": "application/json", "User-Agent": props.identity.userAgent },
      body: JSON.stringify({ content: `<@${me.id}> minicord notification test — ${new Date().toLocaleTimeString()}`, allowed_mentions: { users: [me.id] } }),
    });
    if (res.status >= 400) throw new Error(`webhook post failed: ${res.status} ${res.text.slice(0, 200)}`);
    const message = JSON.parse(res.text) as { id: string };
    console.log(`posted message ${message.id}; waiting 20s before cleaning up`);
    await new Promise((r) => setTimeout(r, 20_000));
    await rest.delete(`/channels/${channelId}/messages/${message.id}`).catch(() => {});
  } finally {
    await rest.delete(`/webhooks/${hook.id}`);
    console.log("removed the webhook");
  }
}

main().catch((err) => {
  console.error("smoke:notify failed:", err instanceof DiscordApiError ? `${err.status} ${JSON.stringify(err.body)}` : err instanceof Error ? err.message : err);
  process.exit(1);
});
