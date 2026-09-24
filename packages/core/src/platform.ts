import type { GatewayStatus } from "./gateway/client.ts";
import type { SessionSnapshot } from "./host/session-host.ts";
import type { RequestOptions } from "./rest/client.ts";
import type { GatewayDispatch } from "./types.ts";

/**
 * What the UI needs from the platform shell. The Electron preload implements it
 * over IPC (token and connection live in the main process); the Android app will
 * implement it over a Capacitor plugin backed by the native gateway service.
 */
export interface SessionHandlers {
  onEvent(event: GatewayDispatch): void;
  onStatus(status: GatewayStatus): void;
  onFatal(info: { code: number; reason: string }): void;
}

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  /** Opaque value handed back to the UI when the notification is clicked. */
  route?: unknown;
  urgent?: boolean;
  silent?: boolean;
}

/** Android: what the background service needs to deliver messages reliably. */
export interface PermissionState {
  notifications: boolean;
  batteryUnrestricted: boolean;
  exactAlarms: boolean;
}

/** App updates: the desktop app downloads and installs from GitHub releases; Android links the new APK. */
export interface UpdateStatus {
  state: "idle" | "checking" | "none" | "available" | "downloading" | "ready" | "error";
  version?: string;
  /** Where to get it when the shell can't install by itself (Android: the APK). */
  url?: string;
  message?: string;
}

export interface Platform {
  readonly kind: "electron" | "android" | "web";
  /** The app's own version (from the shell, which knows what's installed). */
  appInfo?(): Promise<{ version: string }>;
  /**
   * The shell decides message and call notifications itself (the Android service, which keeps
   * running when the UI doesn't); the UI must not post its own for those.
   */
  readonly nativeNotifications?: boolean;
  auth: {
    status(): Promise<{ loggedIn: boolean }>;
    /** Sign in on Discord's own login page in an embedded window; resolves true once a session exists. */
    loginWithDiscord(): Promise<boolean>;
    loginWithToken(token: string): Promise<boolean>;
    logout(): Promise<void>;
  };
  session: {
    /** Subscribe to the host's gateway stream; returns READY + backlog to hydrate from, or null if logged out. */
    attach(handlers: SessionHandlers): Promise<SessionSnapshot | null>;
    send(op: number, d: unknown): void;
    request<T>(method: string, path: string, opts?: RequestOptions): Promise<T>;
    /** Lets the host report focus in its QoS heartbeat, like the web client. */
    setFocused(focused: boolean): void;
    /** Tells a native notifier which conversation is on screen, so it isn't notified about it. */
    setViewing?(channelId: string | null): void;
    /** PUT file bytes to a signed upload URL from Discord's attachment flow; resolves to the HTTP status. */
    upload?(url: string, data: Uint8Array): Promise<number>;
  };
  storage: {
    load<T>(key: string): Promise<T | null>;
    save(key: string, value: unknown): Promise<void>;
  };
  shell: {
    notify(notification: AppNotification): void;
    onNotificationClick(fn: (route: unknown) => void): () => void;
    openExternal(url: string): void;
    /** Open Discord's own web client at a path (e.g. /channels/@me/123) — used for calls. */
    openDiscord(path: string): void;
    setBadge(count: number): void;
    /** "Done for now": get out of the way (hide to tray / background). */
    hide(): void;
    /** Match native chrome (window, menus, system bars) to the chosen theme. */
    setTheme?(theme: "system" | "light" | "dark"): void;
    onFocusChange(fn: (focused: boolean) => void): () => void;
    /** Hardware/gesture back (Android). The handler returns false when there's nowhere to go back to. */
    onBack?(fn: () => boolean): () => void;
    permissions?(): Promise<PermissionState>;
    requestPermissions?(): Promise<PermissionState>;
    checkForUpdates?(): Promise<UpdateStatus>;
    /** Pushed status changes (desktop: download progress/ready). Shells without it are polled via checkForUpdates. */
    onUpdateStatus?(fn: (status: UpdateStatus) => void): () => void;
    /** Desktop: restart into the downloaded update. Android: download the APK and open the installer. */
    installUpdate?(status: UpdateStatus): void | Promise<void>;
  };
}

/** Serialized REST failure crossing a process boundary. */
export interface BridgeError {
  message: string;
  status?: number;
  body?: unknown;
  method?: string;
  path?: string;
}
