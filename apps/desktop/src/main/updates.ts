import type { UpdateStatus } from "@minicord/core";
import { app } from "electron";
import electronUpdater from "electron-updater";

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * Updates from GitHub releases (electron-updater reads latest.yml there). They download
 * quietly in the background and install when you quit, or right away via "Restart".
 * Only installed builds update; dev runs report "none".
 */
export function setupUpdates(broadcast: (status: UpdateStatus) => void) {
  let status: UpdateStatus = { state: "idle" };
  const set = (next: UpdateStatus) => {
    status = next;
    broadcast(next);
  };
  if (!app.isPackaged) {
    return { check: async (): Promise<UpdateStatus> => ({ state: "none", message: "Updates run in installed builds" }), install: () => {} };
  }

  const { autoUpdater } = electronUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  autoUpdater.on("checking-for-update", () => set({ state: "checking" }));
  autoUpdater.on("update-available", (info) => set({ state: "downloading", version: info.version }));
  autoUpdater.on("update-not-available", () => set({ state: "none" }));
  autoUpdater.on("update-downloaded", (info) => set({ state: "ready", version: info.version }));
  autoUpdater.on("error", (err) => set({ state: "error", message: err.message }));

  const check = async (): Promise<UpdateStatus> => {
    if (status.state === "ready" || status.state === "downloading") return status;
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      set({ state: "error", message: err instanceof Error ? err.message : String(err) });
    }
    return status;
  };
  setTimeout(() => void check(), 30_000);
  setInterval(() => void check(), CHECK_EVERY_MS);
  return { check, install: () => autoUpdater.quitAndInstall(false, true) };
}
