// README screenshots from the demo account (made-up people and servers; nothing real is shown).
//   pnpm screenshots        → .github/assets/*.png (light + dark), from the repo root
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";
import { build as viteBuild } from "vite";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const uiDir = join(root, "packages/ui");
const out = join(root, ".github/assets");
mkdirSync(out, { recursive: true });

await viteBuild({ root: uiDir, configFile: join(uiDir, "vite.config.ts"), logLevel: "warn" });
const { appIconPng } = await import("../src/main/icons.ts");
writeFileSync(join(out, "icon.png"), appIconPng(256));

const require = createRequire(join(root, "apps/desktop/package.json"));
const env = { ...process.env, MINICORD_UI_DIST: join(uiDir, "dist") };
// VS Code-hosted shells export ELECTRON_RUN_AS_NODE, which would make electron.exe behave like plain Node.
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: require("electron"), args: [join(root, "apps/desktop/scripts/demo-window.cjs")], env });
const page = await app.firstWindow();
page.on("pageerror", (e) => console.log(`[page] ${e.message}`));
await page.waitForSelector("nav [aria-label='Inbox']", { timeout: 30_000 });

// Same ids as packages/ui/src/platform/demo.ts.
const sid = (n) => String(1_150_000_000_000_000_000n + BigInt(n));
const size = (w, h) => app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h]);
const go = (route) => page.evaluate((r) => window.__minicord.navigate(r), route);
const settle = (ms = 900) => page.waitForTimeout(ms);
const shot = async (name) => {
  await settle();
  await page.screenshot({ path: join(out, name) });
  console.log(`[shot] ${name}`);
};

for (const scheme of ["light", "dark"]) {
  await page.emulateMedia({ colorScheme: scheme });
  await size(1280, 800);

  await go({ view: "server", guildId: sid(200), channelId: sid(202) });
  await page.waitForSelector("text=Trail leads", { timeout: 10_000 });
  await shot(`server-${scheme}.png`);

  await go({ view: "inbox" });
  await shot(`inbox-${scheme}.png`);

  await go({ view: "vault", guildId: sid(500) });
  await page.evaluate(([g, c]) => window.__minicord.requestPass(g, c), [sid(500), sid(501)]);
  await settle(2500); // let the breathing circle grow a bit
  await shot(`vault-${scheme}.png`);
  await page.evaluate(() => window.__minicord.cancelPassRequest());

  await go({ view: "events" });
  await shot(`events-${scheme}.png`);

  // Phone layout.
  await size(390, 844);
  await go({ view: "inbox" });
  await shot(`phone-inbox-${scheme}.png`);
  await go({ view: "dms", channelId: sid(800) });
  await shot(`phone-chat-${scheme}.png`);
}

await app.close();
