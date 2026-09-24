// Runs the Gradle wrapper for the native project on any OS: node scripts/gradle.mjs <tasks...>
// Needs JAVA_HOME (JDK 21) and ANDROID_HOME (Android SDK).
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

for (const key of ["JAVA_HOME", "ANDROID_HOME"]) {
  if (!process.env[key]) {
    console.error(`${key} is not set. Install JDK 21 and the Android SDK, then set ${key}.`);
    process.exit(2);
  }
}
const cwd = join(dirname(fileURLToPath(import.meta.url)), "..", "android");
const windows = process.platform === "win32";
// Windows can only run .bat files through a shell; quote the absolute path in case it has spaces.
const wrapper = windows ? `"${join(cwd, "gradlew.bat")}"` : "./gradlew";
const result = spawnSync(wrapper, process.argv.slice(2), { cwd, stdio: "inherit", shell: windows });
process.exit(result.status ?? 1);
