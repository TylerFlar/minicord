import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Minimal .env reader for the repo-root .env (see .env.example). Process env wins over the file. */
export function loadEnv(): Record<string, string> {
  const file = resolve(import.meta.dirname, "../../../.env");
  const values: Record<string, string> = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match && !line.trimStart().startsWith("#")) values[match[1]!] = match[2]!;
    }
  }
  for (const key of Object.keys(values)) {
    const override = process.env[key];
    if (override) values[key] = override;
  }
  return values;
}

export function requireEnv(env: Record<string, string>, key: string, hint: string): string {
  const value = env[key];
  if (!value) {
    console.error(`${key} is not set. ${hint} (see .env.example)`);
    process.exit(2);
  }
  return value;
}
