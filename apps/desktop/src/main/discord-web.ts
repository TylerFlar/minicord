import { chromeUserAgent, type HttpFn } from "@minicord/core";
import { BrowserWindow, desktopCapturer, dialog, session, shell, type NativeImage, type Session } from "electron";

/**
 * Discord's own web client runs in this partition: once for sign-in (captcha and 2FA
 * handled by Discord itself), and afterwards for calls, which gives full voice, video
 * and screen share (DAVE included) without minicord implementing any of it.
 */
export const DISCORD_PARTITION = "persist:discord";

export function discordSession(): Session {
  return session.fromPartition(DISCORD_PARTITION);
}

export function chromeMajor(): number {
  return Number(process.versions.chrome.split(".")[0]);
}

/** Same UA string the core puts in X-Super-Properties, so both always agree. */
export function userAgent(): string {
  const os = process.platform === "darwin" ? "Mac OS X" : process.platform === "linux" ? "Linux" : "Windows";
  return chromeUserAgent(chromeMajor(), os);
}

/** REST over Chromium's network stack (browser TLS fingerprint + Discord's cookies), falling back to Node fetch. */
export function chromiumHttp(): HttpFn {
  let useNode = false;
  return async (req) => {
    const init = { method: req.method, headers: req.headers, body: req.body as BodyInit | undefined };
    let res: Response;
    if (!useNode) {
      try {
        res = await discordSession().fetch(req.url, { ...init, credentials: "include" } as RequestInit);
      } catch (err) {
        console.warn("[http] Chromium fetch failed, falling back to Node fetch:", err);
        useNode = true;
        res = await fetch(req.url, init);
      }
    } else {
      res = await fetch(req.url, init);
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => (headers[key.toLowerCase()] = value));
    return { status: res.status, headers, text: await res.text() };
  };
}

const ALLOWED_PERMISSIONS = new Set(["media", "display-capture", "clipboard-sanitized-write", "fullscreen", "speaker-selection"]);

export function configureDiscordSession(): void {
  const ses = discordSession();
  ses.setUserAgent(userAgent());
  // Mic/camera/screen for calls; no web notifications (minicord already notifies).
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  ses.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = (await desktopCapturer.getSources({ types: ["screen", "window"] })).slice(0, 9);
    const { response } = await dialog.showMessageBox({
      type: "question",
      title: "Share your screen",
      message: "What would you like to share?",
      buttons: [...sources.map((s) => s.name.slice(0, 40)), "Cancel"],
      cancelId: sources.length,
    });
    const source = sources[response];
    if (!source) return callback({});
    callback({ video: source, audio: "loopback" });
  });
}

/** Hide the server rail in the call window so it stays a call window. */
const CALL_CSS = `nav[aria-label="Servers sidebar"], [data-list-id="guildsnav"] { display: none !important; }`;

let discordWindow: BrowserWindow | null = null;

export function openDiscord(path: string, icon: NativeImage): void {
  const url = `https://discord.com${path.startsWith("/") ? path : `/${path}`}`;
  if (discordWindow && !discordWindow.isDestroyed()) {
    void discordWindow.loadURL(url);
    discordWindow.show();
    discordWindow.focus();
    return;
  }
  discordWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    title: "Discord",
    icon,
    autoHideMenuBar: true,
    webPreferences: { partition: DISCORD_PARTITION, contextIsolation: true, sandbox: true },
  });
  discordWindow.webContents.on("dom-ready", () => void discordWindow?.webContents.insertCSS(CALL_CSS));
  discordWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//.test(target)) void shell.openExternal(target);
    return { action: "deny" };
  });
  discordWindow.on("closed", () => (discordWindow = null));
  void discordWindow.loadURL(url);
}

const TOKEN_SHAPE = /^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/;

/**
 * Show Discord's real login page and pick up the session token from the web
 * client's own authenticated requests. If the partition is already signed in,
 * this resolves almost immediately.
 */
export function loginWithDiscord(icon: NativeImage): Promise<string | null> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 480,
      height: 760,
      title: "Sign in to Discord",
      icon,
      autoHideMenuBar: true,
      webPreferences: { partition: DISCORD_PARTITION, contextIsolation: true, sandbox: true },
    });
    const ses = win.webContents.session;
    let done = false;
    ses.webRequest.onBeforeSendHeaders({ urls: ["https://discord.com/api/*"] }, (details, callback) => {
      const auth = details.requestHeaders.Authorization ?? details.requestHeaders.authorization;
      if (!done && auth && TOKEN_SHAPE.test(auth)) {
        done = true;
        resolve(auth);
        setTimeout(() => win.close(), 400);
      }
      callback({ requestHeaders: details.requestHeaders });
    });
    win.on("closed", () => {
      ses.webRequest.onBeforeSendHeaders(null);
      if (!done) resolve(null);
    });
    void win.loadURL("https://discord.com/login");
  });
}

export async function clearDiscordSession(): Promise<void> {
  await discordSession().clearStorageData();
}
