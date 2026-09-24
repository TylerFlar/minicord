import { Ipc, type AppNotification, type RequestOptions } from "@minicord/core";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  Notification,
  protocol,
  shell,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import { readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { chromiumHttp, clearDiscordSession, configureDiscordSession, loginWithDiscord, openDiscord, userAgent } from "./discord-web.ts";
import { appIconPng, dotPng } from "./icons.ts";
import { DesktopSession } from "./session.ts";
import { clearToken, loadState, loadToken, saveState, saveToken } from "./storage.ts";
import { setupUpdates } from "./updates.ts";

const DEV_URL = process.env.MINICORD_DEV_URL;
const APP_URL = DEV_URL ?? "minicord://app/index.html";
// Unpackaged runs (dev, automated tests) get their own profile so they never touch the real one.
if (!app.isPackaged) app.setPath("userData", join(app.getPath("appData"), "minicord-dev"));
// Windows gives an app ID one taskbar icon, and Electron makes a Start menu shortcut for it the first
// time it notifies. Dev runs get their own ID so the dev electron.exe can't take over the installed app's icon.
app.setAppUserModelId(app.isPackaged ? "dev.minicord.app" : "dev.minicord.app.dev");

protocol.registerSchemesAsPrivileged([{ scheme: "minicord", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
const http = chromiumHttp();
const icon = nativeImage.createFromBuffer(appIconPng(256));
const badgeDot = nativeImage.createFromBuffer(dotPng(32));
const liveNotifications = new Set<Notification>();

const session = new DesktopSession(() => clearToken());

/** Dev convenience: reuse the token from the repo's git-ignored .env without persisting it. */
function devToken(): string | null {
  const file = process.env.MINICORD_DEV_ENV;
  if (app.isPackaged || !file) return null;
  try {
    return /^DISCORD_TOKEN=(.+)$/m.exec(readFileSync(file, "utf8"))?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

function isTrusted(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? "";
  return url.startsWith(DEV_URL ?? "minicord://");
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1220,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: "minicord",
    icon,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1b1b1d" : "#f6f4f0",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      // The renderer runs the notifier; keep its timers honest while hidden in the tray.
      backgroundThrottling: false,
      spellcheck: true,
    },
  });
  win.once("ready-to-show", () => win?.show());
  win.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      win?.hide();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(DEV_URL ?? "minicord://")) e.preventDefault();
  });
  void win.loadURL(APP_URL);
}

function showWindow(): void {
  if (!win || win.isDestroyed()) createWindow();
  if (win!.isMinimized()) win!.restore();
  win!.show();
  win!.focus();
}

function createTray(): void {
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip("minicord");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open minicord", click: showWindow },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", showWindow);
}

function notify(sender: WebContents, n: AppNotification): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({
    title: n.title,
    body: n.body,
    silent: !!n.silent,
    icon,
    urgency: n.urgent ? "critical" : "normal",
    timeoutType: n.urgent ? "never" : "default",
  });
  // Keep a reference: on Windows a collected Notification loses its click handler.
  liveNotifications.add(notification);
  notification.on("click", () => {
    showWindow();
    if (!sender.isDestroyed()) sender.send(Ipc.shellNotificationClick, n.route);
  });
  notification.on("close", () => liveNotifications.delete(notification));
  notification.show();
  setTimeout(() => liveNotifications.delete(notification), 15 * 60_000);
}

function setBadge(count: number): void {
  if (!win || win.isDestroyed()) return;
  if (process.platform === "win32") win.setOverlayIcon(count > 0 ? badgeDot : null, count > 0 ? `${count} unread` : "");
  else app.setBadgeCount(count);
}

async function validateToken(token: string): Promise<boolean> {
  try {
    const res = await http({
      method: "GET",
      url: "https://discord.com/api/v9/users/@me",
      headers: { Authorization: token, "User-Agent": userAgent() },
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

function registerIpc(): void {
  const handle = (channel: string, fn: (e: IpcMainInvokeEvent, ...args: any[]) => unknown) =>
    ipcMain.handle(channel, (e, ...args) => {
      if (!isTrusted(e)) throw new Error("untrusted sender");
      return fn(e, ...args);
    });
  const on = (channel: string, fn: (e: IpcMainEvent, ...args: any[]) => void) =>
    ipcMain.on(channel, (e, ...args) => {
      if (isTrusted(e)) fn(e, ...args);
    });

  handle(Ipc.authStatus, () => ({ loggedIn: session.active }));
  handle(Ipc.authLoginDiscord, async () => {
    const token = await loginWithDiscord(icon);
    if (!token) return false;
    saveToken(token);
    await session.start(token, http);
    return true;
  });
  handle(Ipc.authLoginToken, async (_e, token: string) => {
    if (!(await validateToken(token))) return false;
    saveToken(token);
    await session.start(token, http);
    return true;
  });
  // Forget the session locally. Deliberately does NOT call Discord's logout endpoint,
  // which would invalidate the token everywhere.
  handle(Ipc.authLogout, async () => {
    session.stop();
    clearToken();
    await clearDiscordSession();
  });
  handle(Ipc.sessionAttach, (e) => session.attach(e.sender));
  on(Ipc.sessionSend, (_e, op: number, d: unknown) => session.send(op, d));
  handle(Ipc.sessionRequest, (_e, method: string, path: string, opts: RequestOptions) => session.request(method, path, opts));
  on(Ipc.sessionFocus, (_e, focused: boolean) => session.setFocused(focused));
  handle(Ipc.sessionUpload, async (_e, url: string, data: Uint8Array) => {
    if (!/^https:\/\/[\w.-]+\.(googleapis\.com|discord\.com|discordapp\.net)\//.test(url)) throw new Error("unexpected upload host");
    const res = await http({ method: "PUT", url, headers: {}, body: data });
    return res.status;
  });
  handle(Ipc.storageLoad, (_e, key: string) => loadState(key));
  handle(Ipc.storageSave, (_e, key: string, value: unknown) => saveState(key, value));
  on(Ipc.shellNotify, (e, n: AppNotification) => notify(e.sender, n));
  on(Ipc.shellOpenExternal, (_e, url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
  on(Ipc.shellOpenDiscord, (_e, path: string) => openDiscord(path, icon));
  on(Ipc.shellBadge, (_e, count: number) => setBadge(count));
  on(Ipc.shellHide, () => win?.hide());
  on(Ipc.shellTheme, (_e, theme: unknown) => {
    if (theme === "system" || theme === "light" || theme === "dark") nativeTheme.themeSource = theme;
  });
  handle(Ipc.appInfo, () => ({ version: app.getVersion() }));
  handle(Ipc.updateCheck, () => updates.check());
  on(Ipc.updateInstall, () => updates.install());
}

const updates = setupUpdates((status) => win?.webContents.send(Ipc.updateStatus, status));

app.on("second-instance", showWindow);
app.on("before-quit", () => {
  quitting = true;
  session.stop();
});
// Closing windows keeps minicord in the tray; quit from the tray menu.
app.on("window-all-closed", () => {});

void app.whenReady().then(async () => {
  const rendererDir = join(__dirname, "renderer");
  protocol.handle("minicord", (req) => {
    const file = normalize(join(rendererDir, decodeURIComponent(new URL(req.url).pathname)));
    if (!file.startsWith(rendererDir)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  configureDiscordSession();
  if (!DEV_URL) Menu.setApplicationMenu(null);
  registerIpc();

  const token = loadToken() ?? devToken();
  if (token) await session.start(token, http);
  createWindow();
  createTray();
});
