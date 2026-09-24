// Dev loop: Vite dev server for the UI (HMR), esbuild watch for main/preload (restarts Electron), Electron itself.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { context } from "esbuild";
import { createServer } from "vite";
import { esbuildOptions, root, uiDir, writeIcons } from "./build.mjs";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const DEV_URL = "http://localhost:5174";

const vite = await createServer({ root: uiDir, configFile: join(uiDir, "vite.config.ts") });
await vite.listen();
console.log(`[dev] UI at ${DEV_URL}`);

let child = null;
let restarting = false;

/** VS Code-hosted shells export ELECTRON_RUN_AS_NODE, which would make electron.exe behave like plain Node. */
function cleanEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function startElectron() {
  child = spawn(electronPath, [root], {
    stdio: "inherit",
    env: {
      ...cleanEnv(),
      MINICORD_DEV_URL: DEV_URL,
      // The dev app reuses the git-ignored repo .env token (never persisted).
      MINICORD_DEV_ENV: join(root, "../../.env"),
    },
  });
  child.on("exit", (code) => {
    if (restarting) return;
    void vite.close();
    process.exit(code ?? 0);
  });
}

function restartElectron() {
  if (!child) return startElectron();
  restarting = true;
  child.once("exit", () => {
    restarting = false;
    startElectron();
  });
  child.kill();
}

let built = 0;
const restartPlugin = {
  name: "restart-electron",
  setup(b) {
    b.onEnd((result) => {
      if (result.errors.length) return;
      built++;
      // Two initial builds (main + preload); after that, any rebuild restarts Electron.
      if (built > 2) {
        console.log("[dev] main/preload changed — restarting Electron");
        restartElectron();
      }
    });
  },
};

await writeIcons();
const contexts = await Promise.all([
  context({ ...esbuildOptions("src/main/index.ts", "main.cjs"), plugins: [restartPlugin] }),
  context({ ...esbuildOptions("src/preload/index.ts", "preload.cjs"), plugins: [restartPlugin] }),
]);
await Promise.all(contexts.map((c) => c.rebuild()));
await Promise.all(contexts.map((c) => c.watch()));
startElectron();

const shutdown = () => {
  child?.kill();
  void vite.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
