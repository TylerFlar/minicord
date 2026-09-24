// CI guard: every package carries the same version, and (for a tag build) it matches the tag.
//   node scripts/check-version.mjs [vX.Y.Z]
import { readVersion, VERSION_FILES } from "./release.mjs";

const versions = Object.fromEntries(VERSION_FILES.map((f) => [f, readVersion(f)]));
const unique = [...new Set(Object.values(versions))];
if (unique.length !== 1) {
  console.error("version mismatch:", versions);
  process.exit(1);
}
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
if (tag?.startsWith("v") && tag !== `v${unique[0]}`) {
  console.error(`tag ${tag} doesn't match version ${unique[0]} — run \`pnpm release ${tag.slice(1)}\``);
  process.exit(1);
}
console.log(`version ${unique[0]} ok`);
