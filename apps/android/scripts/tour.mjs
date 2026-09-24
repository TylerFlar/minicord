// Android visual check: drive the app's WebView over CDP on a device/emulator, save screenshots.
//   node scripts/tour.mjs [outDir] [--write]
// Requires: the debug APK installed, adb on PATH or ANDROID_HOME set, DISCORD_TOKEN in the repo .env.
// The app is launched read-only (debug builds only): no writes except, with --write, in MINICORD_TEST_CHANNEL_ID.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _android as android } from "playwright-core";
import { loadEnv } from "../../../packages/core/scripts/env.ts";

const args = process.argv.slice(2);
const write = args.includes("--write");
const out = args.find((a) => !a.startsWith("--")) ?? join(tmpdir(), "minicord-android-shots");
mkdirSync(out, { recursive: true });
const env = loadEnv();
const adbPath = process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, "platform-tools", "adb") : "adb";
const adb = (...a) => execFileSync(adbPath, a, { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
const PKG = "dev.minicord.app";
const TEST_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGNgYGD4z8DAwMDAwMDAAAANBAECxNUF8QAAAABJRU5ErkJggg==";

let n = 0;
const shot = async (name, delay = 900) => {
  await new Promise((r) => setTimeout(r, delay));
  const file = join(out, `${String(++n).padStart(2, "0")}-${name}.png`);
  writeFileSync(file, adb("exec-out", "screencap", "-p"));
  console.log(`[shot] ${file}`);
};

// Fresh, read-only launch.
adb("shell", "am", "force-stop", PKG);
const extras = ["--ez", "minicord_readonly", "true"];
if (write && env.MINICORD_TEST_CHANNEL_ID) extras.push("--es", "minicord_write_channels", env.MINICORD_TEST_CHANNEL_ID);
adb("shell", "am", "start", "-n", `${PKG}/.MainActivity`, ...extras);
await new Promise((r) => setTimeout(r, 4000));

// Attach to the app's WebView through adb (Playwright's Android support).
const [device] = await android.devices();
if (!device) throw new Error("no Android device/emulator connected");
const webview = await device.webView({ pkg: PKG });
const page = await webview.page();
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") console.log(`[webview:${m.type()}] ${m.text()}`);
});
page.on("pageerror", (e) => console.log(`[webview:exception] ${e.message}`));

const tab = (label) => page.locator("nav button", { hasText: label }).first().click();
const back = () => page.evaluate(() => window.__minicord.back());
const waitForMessages = () =>
  page
    .locator('[id^="msg-"]')
    .or(page.getByText(/Load older messages|Welcome to #/))
    .first()
    .waitFor({ timeout: 20_000 })
    .catch(() => {});
/** A touch long-press (the phone's right-click), dispatched in the page. */
const longPress = (locator) =>
  locator.evaluate(async (el) => {
    const r = el.getBoundingClientRect();
    const touch = new Touch({ identifier: 1, target: el, clientX: r.left + Math.min(120, r.width / 2), clientY: r.top + Math.min(24, r.height / 2) });
    const init = (touches) => ({ touches, targetTouches: touches, changedTouches: [touch], bubbles: true, cancelable: true });
    el.dispatchEvent(new TouchEvent("touchstart", init([touch])));
    await new Promise((done) => setTimeout(done, 650));
    el.dispatchEvent(new TouchEvent("touchend", init([])));
  });
const has = (t) => [...document.querySelectorAll('[id^="msg-"]')].some((el) => !el.id.startsWith("msg-pending-") && el.textContent?.includes(t));

async function tour() {
  await tab("Chats");
  await shot("chats");
  await page.locator("[data-dm]").first().click();
  await waitForMessages();
  await shot("conversation", 1500);
  const message = page.locator('[id^="msg-"]').last();
  if (await message.count()) {
    await longPress(message);
    await shot("message-sheet");
    const more = page.getByRole("button", { name: "More reactions" });
    if (await more.count()) {
      await more.click();
      await shot("emoji-sheet", 1500);
    }
    await page.evaluate(() => window.__minicord.closeOverlay());
    const avatar = page.locator('[id^="msg-"] button:has(img)').last();
    if (await avatar.count()) {
      await avatar.click();
      await shot("profile-sheet", 1500);
      await page.evaluate(() => window.__minicord.closeOverlay());
    }
  }
  await back();

  await tab("Events");
  await shot("events");
  await tab("Servers");
  await shot("servers");
  const openName = await page.evaluate(() => {
    const client = window.__minicord;
    return client.store.sortedGuilds().find((g) => client.rules.config.guildModes[g.id] === "open")?.name ?? null;
  });
  if (openName) {
    await page.getByText(openName, { exact: true }).first().click();
    await shot("channels");
    await back();
  }
  const vaulted = page.locator("button:has(svg.lucide-lock)").first();
  if (await vaulted.count()) {
    await vaulted.click();
    await shot("vault");
    await back();
  }
}

/** Send, upload (through the native bridge) and delete in the configured test channel. */
async function writeTour() {
  await page.evaluate((channelId) => {
    const client = window.__minicord;
    const channel = client.store.channels.get(channelId);
    if (!channel?.guild_id) throw new Error("test channel not found");
    if (client.accessOf(channel).allowed) client.navigate({ view: "server", guildId: channel.guild_id, channelId });
    // Manual passes wait out a pause; the harness uses the instant kind (dev profile only).
    else client.openPass({ guildId: channel.guild_id, channelId, kind: "event" });
  }, env.MINICORD_TEST_CHANNEL_ID);
  const stamp = new Date().toISOString();
  const text = `minicord Android test ${stamp}`;
  await page.locator("textarea").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForFunction(has, text, { timeout: 15_000 });
  await shot("write-sent");

  const upload = `minicord Android upload ${stamp}`;
  await page.evaluate(
    async ([channelId, content, b64]) => {
      const png = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([png], "minicord-test.png", { type: "image/png" });
      if (!(await window.__minicord.send(channelId, content, undefined, { files: [file] }))) throw new Error("upload send failed");
    },
    [env.MINICORD_TEST_CHANNEL_ID, upload, TEST_PNG],
  );
  await page.waitForFunction(
    (t) => [...document.querySelectorAll('[id^="msg-"]')].some((el) => !el.id.startsWith("msg-pending-") && el.textContent?.includes(t) && el.querySelector("img[src*='minicord-test']")),
    upload,
    { timeout: 30_000 },
  );
  await shot("write-uploaded");

  for (const t of [upload, text]) {
    await page.evaluate(
      async ([channelId, needle]) => {
        const client = window.__minicord;
        const msg = client.store.messagesOf(channelId)?.messages.find((m) => m.content?.includes(needle) && !m.id.startsWith("pending-"));
        if (msg) await client.deleteMessage(msg);
      },
      [env.MINICORD_TEST_CHANNEL_ID, t],
    );
    await page.waitForFunction((x) => ![...document.querySelectorAll('[id^="msg-"]')].some((el) => el.textContent?.includes(x)), t, { timeout: 15_000 });
  }
  await shot("write-deleted");
  console.log("[tour] Android write test passed");
  // Conversations hide the tabs; step back out before using them again.
  await back();
}

try {
  if (await page.locator("text=Sign in with Discord").count()) {
    await shot("login");
    if (!env.DISCORD_TOKEN) throw new Error("DISCORD_TOKEN missing from .env");
    const ok = await page.evaluate((token) => window.__minicord.login(token), env.DISCORD_TOKEN);
    if (!ok) throw new Error("token login failed");
  }
  await page.locator("nav").getByText("Inbox").or(page.getByText("Sort your servers")).first().waitFor({ timeout: 45_000 });
  if (await page.locator("text=Sort your servers").count()) {
    await shot("onboarding");
    await page.getByRole("button", { name: "Done", exact: true }).click();
  }
  await page.locator("nav").getByText("Inbox").waitFor();
  await shot("inbox", 2500);
  if (write && env.MINICORD_TEST_CHANNEL_ID) await writeTour();
  else await tour();
  await tab("You");
  await shot("settings");
} catch (err) {
  console.error("[tour] failed:", err.message);
  await shot("failure", 0);
  process.exitCode = 1;
} finally {
  await device.close().catch(() => {});
}
