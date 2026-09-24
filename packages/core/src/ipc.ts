/** IPC channel names shared by the Electron main process, its preload, and the UI's Electron adapter. */
export const Ipc = {
  authStatus: "auth:status",
  authLoginDiscord: "auth:login-discord",
  authLoginToken: "auth:login-token",
  authLogout: "auth:logout",
  sessionAttach: "session:attach",
  sessionEvent: "session:event",
  sessionStatus: "session:status",
  sessionFatal: "session:fatal",
  sessionSend: "session:send",
  sessionRequest: "session:request",
  sessionFocus: "session:focus",
  sessionUpload: "session:upload",
  storageLoad: "storage:load",
  storageSave: "storage:save",
  shellNotify: "shell:notify",
  shellNotificationClick: "shell:notification-click",
  shellOpenExternal: "shell:open-external",
  shellOpenDiscord: "shell:open-discord",
  shellBadge: "shell:badge",
  shellHide: "shell:hide",
  shellTheme: "shell:theme",
  appInfo: "app:info",
  updateCheck: "update:check",
  updateInstall: "update:install",
  updateStatus: "update:status",
} as const;

export type IpcChannel = (typeof Ipc)[keyof typeof Ipc];

export const IPC_CHANNELS: readonly string[] = Object.values(Ipc);

/** The minimal surface the preload exposes as `window.minicordNative`. */
export interface NativeBridge {
  invoke(channel: IpcChannel, ...args: unknown[]): Promise<unknown>;
  send(channel: IpcChannel, ...args: unknown[]): void;
  on(channel: IpcChannel, fn: (...args: unknown[]) => void): () => void;
}

export type BridgeResult<T> = { ok: true; value: T } | { ok: false; error: import("./platform.ts").BridgeError };
