// Visual check: launch the built app (read-only, dev profile), walk the main screens, save screenshots.
//   node scripts/build.mjs && node scripts/shoot.mjs [outDir] [--write]
// --write also exercises sending, editing, reacting, uploading and deleting through the UI in
// MINICORD_TEST_CHANNEL_ID (from .env); every other write stays blocked.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron } from "playwright-core";
import { loadEnv } from "../../../packages/core/scripts/env.ts";
import { root } from "./build.mjs";

const args = process.argv.slice(2);
const write = args.includes("--write");
const out = args.find((a) => !a.startsWith("--")) ?? join(tmpdir(), "minicord-shots");
mkdirSync(out, { recursive: true });
const testChannel = loadEnv().MINICORD_TEST_CHANNEL_ID;
if (write && !testChannel) {
  console.error("--write needs MINICORD_TEST_CHANNEL_ID in .env (see .env.example)");
  process.exit(2);
}

// Seed the *dev* profile so the tour can show an open server: flip the first sorted server to open.
const rulesFile = join(process.env.APPDATA ?? "", "minicord-dev", "state", "rules.json");
if (existsSync(rulesFile)) {
  const rules = JSON.parse(readFileSync(rulesFile, "utf8"));
  const first = Object.keys(rules.config?.guildModes ?? {})[0];
  if (first) {
    rules.config.guildModes[first] = "open";
    rules.pending = [];
    writeFileSync(rulesFile, JSON.stringify(rules));
  }
}

const app = await electron.launch({
  args: [root],
  env: (() => {
    const env = { ...process.env, MINICORD_DEV_ENV: join(root, "../../.env"), MINICORD_READONLY: "1" };
    if (write) env.MINICORD_WRITE_CHANNELS = testChannel;
    // VS Code-hosted shells export ELECTRON_RUN_AS_NODE, which would make electron.exe behave like plain Node.
    delete env.ELECTRON_RUN_AS_NODE;
    return env;
  })(),
  timeout: 60_000,
});
app.process().stdout?.on("data", (d) => process.stdout.write(`[main] ${d}`));
app.process().stderr?.on("data", (d) => process.stdout.write(`[main!] ${d}`));

const win = await app.firstWindow();
win.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") console.log(`[renderer:${m.type()}] ${m.text()}`);
});
win.on("pageerror", (e) => console.log(`[renderer:exception] ${e.message}`));
const resize = (w, h) => app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]?.setSize(w, h), [w, h]);
await resize(1280, 820);

let n = 0;
const shot = async (name) => {
  await win.waitForTimeout(700);
  const file = join(out, `${String(++n).padStart(2, "0")}-${name}.png`);
  await win.screenshot({ path: file });
  console.log(`[shot] ${file}`);
};
const rail = (label) => win.locator("nav").getByRole("button", { name: label, exact: true });
const waitForMessages = () =>
  win
    .locator('[id^="msg-"]')
    .or(win.getByText(/Welcome to #|Load older messages|Passes only reach/))
    .first()
    .waitFor({ timeout: 20_000 })
    .catch(() => {});
const escape = () => win.keyboard.press("Escape");

/** Open-server extras: context menu, emoji picker, profile card, pins, threads, quick switcher. */
async function conversationExtras() {
  const last = win.locator('[id^="msg-"]').last();
  if (!(await last.count())) return;
  await last.click({ button: "right", position: { x: 200, y: 12 } });
  await shot("message-menu");
  await escape();
  await last.hover();
  const react = last.getByRole("button", { name: "Add reaction" });
  if (await react.count()) {
    await react.click();
    await win.waitForSelector("text=Find the perfect emoji", { timeout: 5000 }).catch(() => {});
    await shot("emoji-picker");
    await escape();
  }
  const author = win.locator('[id^="msg-"] button.font-semibold').last();
  if (await author.count()) {
    await author.click();
    await shot("profile");
    await escape();
  }
  await win.getByRole("button", { name: "Pinned messages" }).click();
  await shot("pins");
  await escape();
  const threads = win.getByRole("button", { name: "Threads" });
  if (await threads.count()) {
    await threads.click();
    await shot("threads");
    await escape();
  }
  await win.getByRole("button", { name: "Search", exact: true }).click();
  await win.keyboard.type("the");
  await win.keyboard.press("Enter");
  await win.getByText(/\d+ results?|No results|Still indexing/).first().waitFor({ timeout: 15_000 }).catch(() => {});
  await shot("search");
  await escape();
  await last.click({ button: "right", position: { x: 200, y: 12 } });
  await win.getByRole("button", { name: "Forward", exact: true }).click();
  await shot("forward");
  await escape();
  await win.keyboard.press("Control+K");
  await win.keyboard.type("gen");
  await shot("switcher");
  await escape();
}

async function tour() {
  const labels = await win.locator("nav button[aria-label]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  const fixed = new Set(["Inbox", "Direct Messages", "Events"]);
  const openGuild = labels.find((l) => !fixed.has(l) && !l.endsWith("(vaulted)") && !l.startsWith("Settings"));
  const vaultGuild = labels.find((l) => l.endsWith("(vaulted)"));

  // Pass flow: reply to a vaulted mention from the inbox.
  const replyPass = win.locator('button[title^="Opens a"]').first();
  if (await replyPass.count()) {
    await replyPass.click();
    await waitForMessages();
    await shot("pass");
    await win.getByRole("button", { name: "Done", exact: true }).click();
    await shot("vault-after-pass");
  }

  if (openGuild) {
    await rail(openGuild).click();
    await waitForMessages();
    await shot("server");
    await rail(openGuild).click({ button: "right" });
    await shot("server-menu");
    await escape();
    await conversationExtras();
  }

  await rail("Events").click();
  await shot("events");

  await rail("Direct Messages").click();
  await shot("friends");
  const dm = win.locator("[data-dm]").first();
  if (await dm.count()) {
    await dm.click();
    await waitForMessages();
    await shot("dm-conversation");
    const box = win.locator("textarea").first();
    if (await box.count()) {
      await box.fill("/");
      await win.waitForTimeout(1500);
      await shot("slash-commands");
      await box.fill("");
      await win.getByRole("button", { name: "GIFs" }).click();
      await win.waitForTimeout(2500);
      await shot("gif-picker");
      await escape();
      await win.getByRole("button", { name: "Stickers" }).click();
      await shot("sticker-picker");
      await escape();
    }
  }

  if (vaultGuild) {
    await rail(vaultGuild).click();
    await shot("vault");
    // The pass pause (local rules only; nothing is sent to Discord), in the first vaulted server with text channels.
    for (const label of labels.filter((l) => l.endsWith("(vaulted)")).slice(0, 6)) {
      await rail(label).click();
      const select = win.locator("select").first();
      if (!(await select.count()) || (await select.locator("option").count()) < 2) continue;
      await select.selectOption({ index: 1 });
      await win.getByRole("button", { name: /Open pass/ }).click();
      await shot("pass-pause");
      await win.getByRole("button", { name: "Never mind" }).click();
      break;
    }
  }

  await win.locator("nav button[aria-label^='You']").click();
  await shot("status-menu");
  await win.getByRole("button", { name: "Settings", exact: true }).click();
  await shot("settings");

}

/** A tiny PNG so the upload path can be exercised without shipping a fixture file. */
function testPng() {
  return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGNgYGD4z8DAwMDAwMDAAAANBAECxNUF8QAAAABJRU5ErkJggg==", "base64");
}

/** Send, edit, react, upload and delete through the UI in the configured test channel (via a pass if it's vaulted). */
async function writeTour() {
  await win.evaluate((channelId) => {
    const client = window.__minicord;
    const channel = client.store.channels.get(channelId);
    if (!channel?.guild_id) throw new Error("test channel not found");
    if (client.accessOf(channel).allowed) client.navigate({ view: "server", guildId: channel.guild_id, channelId });
    // Manual passes wait out a pause; the harness uses the instant kind (dev profile only).
    else client.openPass({ guildId: channel.guild_id, channelId, kind: "event" });
  }, testChannel);
  await win.waitForSelector("textarea", { timeout: 15_000 });
  const box = win.locator("textarea").first();
  const stamp = new Date().toISOString();
  const text = `minicord UI test ${stamp} :wave:`;
  const has = (t) => [...document.querySelectorAll('[id^="msg-"]')].some((el) => !el.id.startsWith("msg-pending-") && el.textContent?.includes(t));

  // Send (the :wave: shortcode should arrive as 👋).
  await box.fill(text);
  await win.keyboard.press("Enter");
  await win.waitForFunction(has, `minicord UI test ${stamp} 👋`, { timeout: 15_000 });
  await shot("ui-write-sent");

  // Edit with the Up arrow.
  await box.focus();
  await win.keyboard.press("ArrowUp");
  await win.waitForSelector("text=escape to", { timeout: 5000 });
  await win.keyboard.press("End");
  await win.keyboard.type(" (edited in minicord)");
  await win.keyboard.press("Enter");
  await win.waitForFunction(has, "(edited in minicord)", { timeout: 15_000 });

  // React with a quick reaction, then remove it.
  const message = win.locator('[id^="msg-"]', { hasText: stamp }).last();
  await message.hover();
  await message.locator("div.absolute button").first().click();
  await win.waitForFunction((t) => [...document.querySelectorAll('[id^="msg-"]')].some((el) => el.textContent?.includes(t) && el.querySelector('button[title^=":"]')), stamp, { timeout: 15_000 });
  await shot("ui-write-reacted");
  await message.locator('button[title^=":"]').first().click();

  // Upload an image.
  await win.locator('input[type="file"]').setInputFiles({ name: "minicord-test.png", mimeType: "image/png", buffer: testPng() });
  await box.fill(`minicord upload test ${stamp}`);
  await win.keyboard.press("Enter");
  await win.waitForFunction(
    (t) => [...document.querySelectorAll('[id^="msg-"]')].some((el) => !el.id.startsWith("msg-pending-") && el.textContent?.includes(t) && el.querySelector("img[src*='minicord-test']")),
    `minicord upload test ${stamp}`,
    { timeout: 30_000 },
  );
  await shot("ui-write-uploaded");

  // A sticker from the test channel's own server (stickers go out as sticker_ids).
  const stickerSent = await win.evaluate(async (channelId) => {
    const client = window.__minicord;
    const channel = client.store.channels.get(channelId);
    const sticker = client.store.guilds.get(channel.guild_id)?.stickers?.find((s) => s.format_type !== 3 && s.available !== false);
    if (!sticker) return null;
    return (await client.send(channelId, "", undefined, { stickers: [sticker] })) ? sticker.id : null;
  }, testChannel);
  if (stickerSent) {
    await win.waitForFunction((id) => [...document.querySelectorAll('[id^="msg-"]')].some((el) => !el.id.startsWith("msg-pending-") && el.querySelector(`img[src*="${id}"]`)), stickerSent, { timeout: 15_000 });
    await shot("ui-write-sticker");
    await win.evaluate(async ([channelId, stickerId]) => {
      const client = window.__minicord;
      const msg = client.store.messagesOf(channelId)?.messages.findLast((m) => m.sticker_items?.some((s) => s.id === stickerId) && !m.id.startsWith("pending-"));
      if (msg) await client.deleteMessage(msg);
    }, [testChannel, stickerSent]);
  }

  // Delete both through the context menu and the confirm dialog.
  for (const t of [`minicord upload test ${stamp}`, `minicord UI test ${stamp}`]) {
    const m = win.locator('[id^="msg-"]', { hasText: t }).last();
    await m.click({ button: "right", position: { x: 200, y: 12 } });
    await win.getByRole("button", { name: "Delete message" }).click();
    await win.getByRole("button", { name: "Delete", exact: true }).click();
    await win.waitForFunction((x) => ![...document.querySelectorAll('[id^="msg-"]')].some((el) => el.textContent?.includes(x)), t, { timeout: 15_000 });
  }
  await shot("ui-write-deleted");
  console.log("[shoot] UI write tour passed");
}

try {
  await win.locator("nav [aria-label='Inbox']").or(win.getByText(/Sort your servers|Sign in with Discord/)).first().waitFor({ timeout: 45_000 });
  if (await win.locator("text=Sort your servers").count()) {
    await shot("onboarding");
    await win.getByRole("button", { name: "Done", exact: true }).click();
  }
  await win.waitForSelector("nav [aria-label='Inbox']");
  await shot("inbox");
  if (write) await writeTour();
  else await tour();
} catch (err) {
  console.error("[shoot] failed:", err.message);
  await shot("failure");
  process.exitCode = 1;
} finally {
  await app.close();
}
