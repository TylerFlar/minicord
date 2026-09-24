import { App } from "@capacitor/app";
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import {
  DiscordApiError,
  type AppNotification,
  type GatewayDispatch,
  type GatewayStatus,
  type PermissionState,
  type Platform,
  type RequestOptions,
  type SessionSnapshot,
  type UpdateStatus,
} from "@minicord/core";

/** The native side lives in apps/android/android/app/src/main/java/dev/minicord/app/MinicordPlugin.kt. */
interface MinicordNative {
  authStatus(): Promise<{ loggedIn: boolean }>;
  loginWithDiscord(): Promise<{ ok: boolean }>;
  loginWithToken(o: { token: string }): Promise<{ ok: boolean }>;
  logout(): Promise<void>;
  attach(): Promise<{ path: string }>;
  send(o: { op: number; d: unknown }): Promise<void>;
  request(o: { method: string; path: string; opts: RequestOptions }): Promise<{ status: number; body?: string; error?: string }>;
  setFocused(o: { focused: boolean }): Promise<void>;
  setViewing(o: { channelId: string | null }): Promise<void>;
  upload(o: { url: string; data: string }): Promise<{ status: number }>;
  storageLoad(o: { key: string }): Promise<{ value: string }>;
  storageSave(o: { key: string; value: string }): Promise<void>;
  notify(n: AppNotification): Promise<void>;
  openExternal(o: { url: string }): Promise<void>;
  openDiscord(o: { path: string }): Promise<void>;
  hide(): Promise<void>;
  permissionStatus(): Promise<PermissionState>;
  appInfo(): Promise<{ version: string }>;
  checkForUpdate(): Promise<UpdateStatus>;
  requestAppPermissions(): Promise<PermissionState>;
  addListener(event: "gatewayEvent", fn: (e: { raw: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: "gatewayStatus", fn: (e: { status: GatewayStatus }) => void): Promise<PluginListenerHandle>;
  addListener(event: "gatewayFatal", fn: (e: { code: number; reason: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: "notificationClick", fn: (e: { route: string }) => void): Promise<PluginListenerHandle>;
}

const Native = registerPlugin<MinicordNative>("Minicord");

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Platform over the native plugin; the gateway and token live in the Android runtime, not the WebView. */
export function capacitorPlatform(): Platform {
  let session: PluginListenerHandle[] = [];
  const later = (p: Promise<PluginListenerHandle>) => () => void p.then((h) => h.remove());

  return {
    kind: "android",
    nativeNotifications: true,
    appInfo: () => Native.appInfo(),
    auth: {
      status: () => Native.authStatus(),
      loginWithDiscord: async () => (await Native.loginWithDiscord()).ok,
      loginWithToken: async (token) => (await Native.loginWithToken({ token })).ok,
      logout: () => Native.logout(),
    },
    session: {
      async attach(handlers) {
        for (const h of session) await h.remove();
        session = await Promise.all([
          Native.addListener("gatewayEvent", (e) => handlers.onEvent(JSON.parse(e.raw) as GatewayDispatch)),
          Native.addListener("gatewayStatus", (e) => handlers.onStatus(e.status)),
          Native.addListener("gatewayFatal", (e) => handlers.onFatal(e)),
        ]);
        const { path } = await Native.attach();
        if (!path) return null;
        // READY can be megabytes; the native side writes it to a file instead of pushing it through the bridge.
        const res = await fetch(Capacitor.convertFileSrc(path));
        return (await res.json()) as SessionSnapshot;
      },
      send: (op, d) => void Native.send({ op, d }),
      async request<T>(method: string, path: string, opts?: RequestOptions): Promise<T> {
        const result = await Native.request({ method, path, opts: opts ?? {} });
        if (!result.status) throw new Error(result.error ?? "Network error");
        const body = result.body ? JSON.parse(result.body) : null;
        if (result.status >= 400) throw new DiscordApiError(result.status, body, method, path);
        return body as T;
      },
      setFocused: (focused) => void Native.setFocused({ focused }),
      setViewing: (channelId) => void Native.setViewing({ channelId }),
      upload: async (url, data) => (await Native.upload({ url, data: toBase64(data) })).status,
    },
    storage: {
      async load<T>(key: string) {
        const { value } = await Native.storageLoad({ key });
        return value ? (JSON.parse(value) as T) : null;
      },
      save: (key, value) => Native.storageSave({ key, value: JSON.stringify(value) }),
    },
    shell: {
      notify: (n) => void Native.notify(n),
      onNotificationClick: (fn) => later(Native.addListener("notificationClick", (e) => fn(e.route ? JSON.parse(e.route) : null))),
      openExternal: (url) => void Native.openExternal({ url }),
      openDiscord: (path) => void Native.openDiscord({ path }),
      setBadge: () => {},
      hide: () => void Native.hide(),
      onFocusChange: (fn) => later(App.addListener("appStateChange", ({ isActive }) => fn(isActive))),
      onBack: (fn) =>
        later(
          App.addListener("backButton", () => {
            if (!fn()) void App.minimizeApp();
          }),
        ),
      permissions: () => Native.permissionStatus(),
      requestPermissions: () => Native.requestAppPermissions(),
      checkForUpdates: () => Native.checkForUpdate(),
      installUpdate: (status) => void (status.url && Native.openExternal({ url: status.url })),
    },
  };
}
