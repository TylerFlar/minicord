// Writes minicord's launcher icons into the Android project (same generator as the desktop icon).
//   node scripts/icons.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { adaptiveForegroundPng, appIconPng, roundIconPng } from "../../desktop/src/main/icons.ts";

const res = join(dirname(fileURLToPath(import.meta.url)), "../android/app/src/main/res");
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [name, scale] of Object.entries(densities)) {
  const dir = join(res, `mipmap-${name}`);
  writeFileSync(join(dir, "ic_launcher.png"), appIconPng(Math.round(48 * scale)));
  writeFileSync(join(dir, "ic_launcher_round.png"), roundIconPng(Math.round(48 * scale)));
  writeFileSync(join(dir, "ic_launcher_foreground.png"), adaptiveForegroundPng(Math.round(108 * scale)));
}
console.log("wrote launcher icons");
