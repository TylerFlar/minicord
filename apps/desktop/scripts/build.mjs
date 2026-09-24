// Production build: UI (Vite) → dist/renderer, main + preload (esbuild) → dist/*.cjs, icons → dist/icons.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const uiDir = resolve(root, "../../packages/ui");
const dist = join(root, "dist");

export const esbuildOptions = (entry, outfile) => ({
  entryPoints: [join(root, entry)],
  outfile: join(dist, outfile),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: true,
  external: ["electron", "bufferutil", "utf-8-validate"],
  logLevel: "warning",
});

/** App icon (PNG + multi-size ICO) and the installer's sidebar/header images, all generated from icons.ts. */
export async function writeIcons() {
  const { appIconIco, appIconPng, installerHeaderBmp, installerSidebarBmp } = await import("../src/main/icons.ts");
  const dir = join(dist, "icons");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "icon.png"), appIconPng(512));
  writeFileSync(join(dir, "icon.ico"), appIconIco());
  writeFileSync(join(dir, "installerSidebar.bmp"), installerSidebarBmp());
  writeFileSync(join(dir, "installerHeader.bmp"), installerHeaderBmp());
}

async function main() {
  rmSync(dist, { recursive: true, force: true });
  await viteBuild({ root: uiDir, configFile: join(uiDir, "vite.config.ts"), logLevel: "warn" });
  cpSync(join(uiDir, "dist"), join(dist, "renderer"), { recursive: true });
  await build(esbuildOptions("src/main/index.ts", "main.cjs"));
  await build(esbuildOptions("src/preload/index.ts", "preload.cjs"));
  await writeIcons();
  console.log("built apps/desktop/dist");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
