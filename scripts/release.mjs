// Cut a release: bump the version everywhere, commit, and tag.
//   pnpm release <x.y.z | patch | minor | major> [--no-git]
//
// The version lives in package.json (root) and is mirrored into apps/desktop (electron-builder) and
// apps/android (Gradle reads versionName/versionCode from it). Pushing the tag starts the release
// workflow, which builds the Windows installer and the Android APK and publishes a GitHub release:
//   git push --follow-tags
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const VERSION_FILES = ["package.json", "apps/desktop/package.json", "apps/android/package.json"];
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/;

export function readVersion(file = "package.json") {
  return JSON.parse(readFileSync(join(root, file), "utf8")).version;
}

function bump(current, arg) {
  const m = SEMVER.exec(current);
  if (!m) throw new Error(`current version "${current}" isn't semver`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (arg === "major") return `${major + 1}.0.0`;
  if (arg === "minor") return `${major}.${minor + 1}.0`;
  if (arg === "patch") return `${major}.${minor}.${patch + 1}`;
  if (SEMVER.test(arg ?? "")) return arg;
  throw new Error("usage: pnpm release <x.y.z | patch | minor | major> [--no-git]");
}

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function main() {
  const args = process.argv.slice(2);
  const useGit = !args.includes("--no-git");
  const current = readVersion();
  const next = bump(current, args.find((a) => !a.startsWith("--")));
  const [, major, minor, patch] = SEMVER.exec(next).map(Number);
  if (major > 99 || minor > 99 || patch > 99) throw new Error("keep each part under 100 (Android versionCode is major*10000 + minor*100 + patch)");

  if (useGit) {
    if (git("status", "--porcelain")) throw new Error("commit or stash your changes first");
    if (git("tag", "--list", `v${next}`)) throw new Error(`tag v${next} already exists`);
  }

  for (const file of VERSION_FILES) {
    const path = join(root, file);
    const pkg = JSON.parse(readFileSync(path, "utf8"));
    pkg.version = next;
    writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  console.log(`version ${current} → ${next}`);

  if (useGit) {
    git("add", ...VERSION_FILES);
    git("commit", "-m", `Release v${next}`);
    git("tag", "-a", `v${next}`, "-m", `minicord ${next}`);
    console.log(`committed and tagged v${next}. Publish it with:\n  git push --follow-tags`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
