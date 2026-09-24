import { app, safeStorage } from "electron";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const stateDir = () => join(app.getPath("userData"), "state");
const tokenFile = () => join(app.getPath("userData"), "session.bin");
const safeKey = (key: string) => key.replace(/[^a-z0-9_-]/gi, "_");

export function loadState<T>(key: string): T | null {
  try {
    return JSON.parse(readFileSync(join(stateDir(), `${safeKey(key)}.json`), "utf8")) as T;
  } catch {
    return null;
  }
}

export function saveState(key: string, value: unknown): void {
  mkdirSync(stateDir(), { recursive: true });
  const file = join(stateDir(), `${safeKey(key)}.json`);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, file);
}

/** The Discord token is encrypted with the OS keystore (DPAPI on Windows). */
export function saveToken(token: string): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("OS encryption is unavailable; refusing to store the token in plain text.");
  writeFileSync(tokenFile(), safeStorage.encryptString(token));
}

export function loadToken(): string | null {
  try {
    return safeStorage.decryptString(readFileSync(tokenFile()));
  } catch {
    return null;
  }
}

export function clearToken(): void {
  rmSync(tokenFile(), { force: true });
}
