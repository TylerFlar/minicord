import type { NativeBridge, Platform } from "@minicord/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { MinicordClient } from "./app/client.ts";
import { ClientProvider } from "./app/context.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { applyTheme, savedTheme } from "./lib/theme.ts";
import { electronPlatform } from "./platform/electron.ts";
import "./styles.css";

// Before anything paints, so a chosen theme never flashes the other one.
applyTheme(savedTheme());

declare global {
  interface Window {
    /** Raw IPC bridge from the Electron preload. */
    minicordNative?: NativeBridge;
    /** A ready-made Platform (the Android shell provides one directly). */
    minicord?: Platform;
  }
}

async function detectPlatform(): Promise<Platform | undefined> {
  // ?demo: a made-up account (screenshots, trying the UI); nothing connects to Discord.
  if (new URLSearchParams(location.search).has("demo")) return (await import("./platform/demo.ts")).demoPlatform();
  if (window.minicord) return window.minicord;
  if (window.minicordNative) return electronPlatform(window.minicordNative);
  const capacitor = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (capacitor?.isNativePlatform?.()) return (await import("./platform/capacitor.ts")).capacitorPlatform();
  return undefined;
}

const platform = await detectPlatform();
const root = createRoot(document.getElementById("root")!);

if (!platform) {
  root.render(
    <div style={{ padding: 32, fontFamily: "system-ui" }}>
      minicord needs its desktop or Android shell. Run <code>pnpm dev</code> from the repo root.
    </div>,
  );
} else {
  const client = new MinicordClient(platform);
  platform.shell.setTheme?.(savedTheme());
  // Handy from DevTools and used by the automated UI tours.
  (window as unknown as { __minicord: MinicordClient }).__minicord = client;
  void client.start();
  root.render(
    <StrictMode>
      <ClientProvider client={client}>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </ClientProvider>
    </StrictMode>,
  );
}
