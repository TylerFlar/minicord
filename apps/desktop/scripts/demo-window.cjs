// A bare Electron window that serves the built UI (packages/ui/dist) in demo mode.
// Used by scripts/readme-shots.mjs; no Discord session, no preload.
const { app, BrowserWindow, net, protocol } = require("electron");
const { join, normalize } = require("node:path");
const { pathToFileURL } = require("node:url");

const dist = process.env.MINICORD_UI_DIST;
protocol.registerSchemesAsPrivileged([{ scheme: "minicord", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

app.whenReady().then(() => {
  protocol.handle("minicord", (req) => {
    const file = normalize(join(dist, decodeURIComponent(new URL(req.url).pathname)));
    if (!file.startsWith(dist)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  const win = new BrowserWindow({ width: 1280, height: 800, useContentSize: true, backgroundColor: "#f6f4f0", autoHideMenuBar: true });
  void win.loadURL("minicord://app/index.html?demo");
});
