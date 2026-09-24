// Builds src/lib/emoji-data.json from emojibase: [emoji, shortcodes, keywords, group][] in Discord-ish order.
// `shortcodes` is space-separated; the first is the display name.
// Shortcodes follow GitHub's set, which matches Discord's names for nearly all emoji (:thumbsup:, :joy:, :sob:).
//   node scripts/gen-emoji.mjs
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const data = require("emojibase-data/en/compact.json");
const github = require("emojibase-data/en/shortcodes/github.json");
const iamcal = require("emojibase-data/en/shortcodes/iamcal.json");

const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const rows = data
  .filter((e) => typeof e.group === "number" && e.group !== 2) // skip skin-tone components and loose regional letters
  .sort((a, b) => a.order - b.order)
  .map((e) => {
    const all = [...new Set([...list(github[e.hexcode]), ...list(iamcal[e.hexcode])])];
    // Prefer word-like names (Discord shows :thumbsup:, not :+1:).
    const codes = [...all.filter((c) => /^[a-z0-9_]+$/.test(c)), ...all.filter((c) => !/^[a-z0-9_]+$/.test(c))];
    if (!codes.length) codes.push(e.label.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
    const keywords = [e.label, ...(e.tags ?? [])].join(" ").toLowerCase();
    // Fully-qualified form (with U+FE0F): what Discord uses for reactions.
    return [e.unicode, codes.join(" "), keywords, e.group];
  });

const out = join(dirname(fileURLToPath(import.meta.url)), "../src/lib/emoji-data.json");
writeFileSync(out, JSON.stringify(rows));
console.log(`wrote ${rows.length} emoji → ${out}`);
