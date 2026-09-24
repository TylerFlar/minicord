import { useEffect } from "react";
import { BottomTabs } from "./components/BottomTabs.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { OverlayHost } from "./components/Overlay.tsx";
import { CallBanner, Toasts } from "./components/Overlays.tsx";
import { Rail } from "./components/Sidebar.tsx";
import { Spinner } from "./components/ui.tsx";
import { useSignals, useStore } from "./app/context.tsx";
import type { Route } from "./app/route.ts";
import { useIsMobile } from "./lib/responsive.ts";
import { DirectMessagesScreen, FriendsScreen } from "./screens/DirectMessages.tsx";
import { EventsScreen } from "./screens/Events.tsx";
import { InboxScreen } from "./screens/Inbox.tsx";
import { LoginScreen } from "./screens/Login.tsx";
import { OnboardingScreen } from "./screens/Onboarding.tsx";
import { ServerScreen } from "./screens/Server.tsx";
import { ServersScreen } from "./screens/Servers.tsx";
import { SettingsScreen } from "./screens/Settings.tsx";
import { VaultScreen } from "./screens/Vault.tsx";

function Screen({ route }: { route: Route }) {
  switch (route.view) {
    case "inbox":
      return <InboxScreen />;
    case "dms":
      return <DirectMessagesScreen {...(route.channelId ? { channelId: route.channelId } : {})} {...(route.anchor ? { anchor: route.anchor } : {})} />;
    case "friends":
      return <FriendsScreen />;
    case "server":
      return (
        <ServerScreen
          key={route.guildId}
          guildId={route.guildId}
          {...(route.channelId ? { channelId: route.channelId } : {})}
          {...(route.anchor ? { anchor: route.anchor } : {})}
          list={!!route.list}
        />
      );
    case "vault":
      return <VaultScreen key={route.guildId} guildId={route.guildId} />;
    case "servers":
      return <ServersScreen />;
    case "events":
      return <EventsScreen />;
    case "settings":
      return <SettingsScreen />;
    case "onboarding":
      return <OnboardingScreen />;
  }
}

export function App() {
  const client = useSignals(["status", "route"]);
  const store = useStore(["me"]);
  const mobile = useIsMobile();
  const { route, status } = client;

  useEffect(() => client.platform.shell.onBack?.(() => client.back()), [client]);

  // Ctrl/Cmd+K: quick switcher, like Discord.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!client.store.ready) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (client.overlay?.kind === "switcher") client.closeOverlay();
        else client.openOverlay({ kind: "switcher" });
      } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && !client.overlay) {
        e.preventDefault();
        client.stepChannel(e.key === "ArrowUp" ? -1 : 1, e.shiftKey);
      } else if (e.shiftKey && e.key === "Escape" && !client.overlay && client.route.view === "server") {
        void client.markGuildRead(client.route.guildId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [client]);

  const safeTop = { paddingTop: "env(safe-area-inset-top)" };
  if (status === "starting") return <Spinner />;
  if (status === "loggedOut")
    return (
      <div className="h-full" style={safeTop}>
        <LoginScreen />
        <Toasts />
      </div>
    );
  if (!store.ready) return <Spinner label="Connecting…" />;
  if (route.view === "onboarding")
    return (
      <div className="h-full" style={safeTop}>
        <OnboardingScreen />
        <Toasts />
      </div>
    );

  if (mobile) {
    // Inside a conversation the composer needs the room; tabs come back on the way out.
    const focused =
      (route.view === "dms" && !!route.channelId) || route.view === "friends" || (route.view === "server" && !!route.channelId && !route.list);
    return (
      <div className="flex h-full flex-col bg-surface" style={{ ...safeTop, ...(focused ? { paddingBottom: "env(safe-area-inset-bottom)" } : {}) }}>
        <main className="flex min-h-0 flex-1">
          <ErrorBoundary key={route.view} onHome={() => client.navigate({ view: "inbox" })}>
            <Screen route={route} />
          </ErrorBoundary>
        </main>
        {!focused && <BottomTabs />}
        <Toasts />
        <CallBanner />
        <OverlayHost />
      </div>
    );
  }

  return (
    <div className="flex h-full bg-bg">
      <Rail />
      <main className="flex min-w-0 flex-1 overflow-hidden rounded-tl-xl border-l border-t border-line">
        <ErrorBoundary key={route.view} onHome={() => client.navigate({ view: "inbox" })}>
          <Screen route={route} />
        </ErrorBoundary>
      </main>
      <Toasts />
      <CallBanner />
      <OverlayHost />
    </div>
  );
}
