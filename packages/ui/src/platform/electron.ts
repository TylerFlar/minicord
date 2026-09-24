import {
  DiscordApiError,
  Ipc,
  type AppNotification,
  type BridgeResult,
  type GatewayDispatch,
  type GatewayStatus,
  type NativeBridge,
  type Platform,
  type RequestOptions,
  type SessionSnapshot,
  type UpdateStatus,
} from "@minicord/core";

/** Adapts the preload's raw IPC bridge to the Platform interface (errors are rebuilt on this side of the bridge). */
export function electronPlatform(native: NativeBridge): Platform {
  let detach: (() => void)[] = [];
  return {
    kind: "electron",
    appInfo: () => native.invoke(Ipc.appInfo) as Promise<{ version: string }>,
    auth: {
      status: () => native.invoke(Ipc.authStatus) as Promise<{ loggedIn: boolean }>,
      loginWithDiscord: () => native.invoke(Ipc.authLoginDiscord) as Promise<boolean>,
      loginWithToken: (token) => native.invoke(Ipc.authLoginToken, token) as Promise<boolean>,
      logout: () => native.invoke(Ipc.authLogout) as Promise<void>,
    },
    session: {
      async attach(handlers) {
        // Re-attaching (e.g. after signing in) replaces the previous listeners instead of doubling events.
        for (const off of detach) off();
        detach = [
          native.on(Ipc.sessionEvent, (e) => handlers.onEvent(e as GatewayDispatch)),
          native.on(Ipc.sessionStatus, (s) => handlers.onStatus(s as GatewayStatus)),
          native.on(Ipc.sessionFatal, (f) => handlers.onFatal(f as { code: number; reason: string })),
        ];
        return (await native.invoke(Ipc.sessionAttach)) as SessionSnapshot | null;
      },
      send: (op, d) => native.send(Ipc.sessionSend, op, d),
      async request<T>(method: string, path: string, opts?: RequestOptions): Promise<T> {
        const result = (await native.invoke(Ipc.sessionRequest, method, path, opts ?? {})) as BridgeResult<T>;
        if (result.ok) return result.value;
        const { error } = result;
        if (error.status) throw new DiscordApiError(error.status, error.body, error.method ?? method, error.path ?? path);
        throw new Error(error.message);
      },
      setFocused: (focused) => native.send(Ipc.sessionFocus, focused),
      upload: (url, data) => native.invoke(Ipc.sessionUpload, url, data) as Promise<number>,
    },
    storage: {
      load: <T>(key: string) => native.invoke(Ipc.storageLoad, key) as Promise<T | null>,
      save: (key, value) => native.invoke(Ipc.storageSave, key, value) as Promise<void>,
    },
    shell: {
      notify: (n: AppNotification) => native.send(Ipc.shellNotify, n),
      onNotificationClick: (fn) => native.on(Ipc.shellNotificationClick, (route) => fn(route)),
      openExternal: (url) => native.send(Ipc.shellOpenExternal, url),
      openDiscord: (path) => native.send(Ipc.shellOpenDiscord, path),
      setBadge: (count) => native.send(Ipc.shellBadge, count),
      hide: () => native.send(Ipc.shellHide),
      checkForUpdates: () => native.invoke(Ipc.updateCheck) as Promise<UpdateStatus>,
      onUpdateStatus: (fn) => native.on(Ipc.updateStatus, (s) => fn(s as UpdateStatus)),
      installUpdate: () => native.send(Ipc.updateInstall),
      onFocusChange(fn) {
        const onFocus = () => fn(true);
        const onBlur = () => fn(false);
        window.addEventListener("focus", onFocus);
        window.addEventListener("blur", onBlur);
        return () => {
          window.removeEventListener("focus", onFocus);
          window.removeEventListener("blur", onBlur);
        };
      },
    },
  };
}
