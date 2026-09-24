// Try the UI with a made-up account (no Discord connection): builds the UI and opens it in demo mode.
//   pnpm demo            (from the repo root)
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..");
const uiDir = join(desktop, "../../packages/ui");
await viteBuild({ root: uiDir, configFile: join(uiDir, "vite.config.ts"), logLevel: "warn" });

const env = { ...process.env, MINICORD_UI_DIST: join(uiDir, "dist") };
// VS Code-hosted shells export ELECTRON_RUN_AS_NODE, which would make electron.exe behave like plain Node.
delete env.ELECTRON_RUN_AS_NODE;
const electron = createRequire(join(desktop, "package.json"))("electron");
spawn(electron, [join(desktop, "scripts/demo-window.cjs")], { env, stdio: "inherit" }).on("exit", (code) => process.exit(code ?? 0));
