import { isUpcomingOrLive, RelationshipType, rules as R, type Guild } from "@minicord/core";
import { BellOff, CalendarDays, Check, CheckCheck, DoorOpen, ExternalLink, Inbox, Lock, MessageCircle, Settings } from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";
import type { MinicordClient, OwnStatus } from "../app/client.ts";
import { useClient, useNow, useSignals, useStore } from "../app/context.tsx";
import type { MenuEntry } from "../app/overlay.ts";
import type { Route } from "../app/route.ts";
import { guildIconUrl, initials } from "../lib/cdn.ts";
import { STATUS_LABEL } from "../lib/presence.ts";
import { Avatar, GuildIcon, StatusDot } from "./Avatar.tsx";

export function Count({ n, strong }: { n: number; strong?: boolean }) {
  if (n <= 0) return null;
  return (
    <span className={`min-w-[18px] rounded-full px-1.5 text-center text-[11.5px] font-bold leading-[18px] tabular-nums ${strong ? "bg-danger text-white" : "bg-sunken text-muted"}`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

function isActive(route: Route, guildId: string): boolean {
  return (route.view === "server" || route.view === "vault") && route.guildId === guildId;
}

/** Right-click menu for a server (rail, phone list). */
export function guildMenu(client: MinicordClient, guild: Guild): MenuEntry[] {
  const vaulted = R.modeOf(client.rules.config, guild.id) === "vault";
  if (vaulted) {
    return [
      {
        label: `Unvault (takes ${client.rules.config.cooldownHours}h)`,
        icon: <DoorOpen size={16} />,
        onSelect: () => client.requestChange({ kind: "guildMode", guildId: guild.id, mode: "open" }),
      },
    ];
  }
  const muted = client.isMuted({ guildId: guild.id });
  return [
    { label: "Mark as read", icon: <CheckCheck size={16} />, onSelect: () => void client.markGuildRead(guild.id) },
    { label: muted ? "Unmute server" : "Mute server", icon: <BellOff size={16} />, onSelect: () => void client.setMuted({ guildId: guild.id }, !muted) },
    { label: "Vault server", icon: <Lock size={16} />, onSelect: () => client.requestChange({ kind: "guildMode", guildId: guild.id, mode: "vault" }) },
    { separator: true },
    { label: "Open in Discord", icon: <ExternalLink size={16} />, onSelect: () => client.platform.shell.openDiscord(`/channels/${guild.id}`) },
  ];
}

/** Your status choices, as a menu (rail avatar; the phone's You tab uses the same list). */
export function statusMenu(client: MinicordClient, extra: MenuEntry[] = []): MenuEntry[] {
  const current = client.ownStatus();
  const item = (s: OwnStatus): MenuEntry => ({
    label: STATUS_LABEL[s],
    leading: <StatusDot status={s} size={10} />,
    checked: s === current,
    onSelect: () => void client.setStatus(s),
  });
  return [item("online"), item("idle"), item("dnd"), item("invisible"), ...extra];
}

/** Unread state as the server list shows it: vaulted servers only surface pings meant for you. */
function useGuildBadges(): (guildId: string) => { unread: boolean; mentions: number } {
  const client = useSignals(["rules", "inbox"]);
  const store = useStore(["guilds", "readstates", "settings", "channels", ...[...client.store.guilds.keys()].map((id) => `channels:${id}`)]);
  const inbox = client.visibleInbox();
  return (guildId) => {
    if (R.modeOf(client.rules.config, guildId) === "vault") return { unread: false, mentions: inbox.filter((i) => i.guildId === guildId && i.pings).length };
    return store.guildUnread(guildId);
  };
}

/** Counts shown on the Inbox / Messages / Events entries (rail and bottom tabs). */
export function useNavCounts(): { pinged: number; unreadDms: number; weekEvents: number; pendingFriends: number } {
  const client = useSignals(["inbox", "rules"]);
  const store = useStore(["dms", "readstates", "events", "settings", "relationships"]);
  const now = useNow(60_000);
  return {
    pinged: client.visibleInbox().filter((i) => i.pings).length,
    unreadDms: store.unreadDms().length,
    weekEvents: [...store.events.values()].filter((e) => isUpcomingOrLive(e, now) && Date.parse(e.scheduled_start_time) - now < 7 * 86_400_000).length,
    pendingFriends: [...store.relationships.values()].filter((r) => r.type === RelationshipType.IncomingRequest).length,
  };
}

function Badge({ n, strong = true }: { n: number; strong?: boolean }) {
  if (n <= 0) return null;
  return (
    <span
      className={`absolute -bottom-0.5 right-2.5 min-w-[22px] rounded-full border-[3px] border-bg px-1 text-center text-[11px] font-bold leading-[16px] tabular-nums ${
        strong ? "bg-danger text-white" : "bg-sunken text-muted"
      }`}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

function RailItem({
  label,
  active,
  unread,
  badge,
  softBadge,
  onClick,
  onPointer,
  onContextMenu,
  onTip,
  children,
  tone = "nav",
}: {
  label: string;
  active: boolean;
  unread?: boolean;
  badge?: number;
  softBadge?: boolean;
  onClick: () => void;
  /** Gets the click event (for anchoring a menu to the button). */
  onPointer?: (e: MouseEvent<HTMLButtonElement>) => void;
  onContextMenu?: (e: MouseEvent) => void;
  onTip: (tip: { label: string; top: number } | null) => void;
  children: ReactNode;
  tone?: "nav" | "guild";
}) {
  return (
    <div className="group relative flex w-full shrink-0 justify-center">
      <span
        className={`absolute left-0 top-1/2 w-1 -translate-y-1/2 rounded-r-full bg-text transition-all duration-150 ${
          active ? "h-10" : unread ? "h-2 group-hover:h-5" : "h-0 group-hover:h-5"
        }`}
      />
      <button
        aria-label={label}
        onClick={(e) => (onPointer ? onPointer(e) : onClick())}
        onContextMenu={onContextMenu}
        onMouseEnter={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onTip({ label, top: r.top + r.height / 2 });
        }}
        onMouseLeave={() => onTip(null)}
        className={`flex h-12 w-12 items-center justify-center overflow-hidden transition-all duration-150 ${active ? "rounded-2xl" : "rounded-3xl group-hover:rounded-2xl"} ${
          tone === "nav" ? (active ? "bg-accent text-on-accent" : "bg-surface text-muted group-hover:bg-accent group-hover:text-on-accent") : "bg-surface"
        }`}
      >
        {children}
      </button>
      {!!badge && <Badge n={badge} strong={!softBadge} />}
    </div>
  );
}

function GuildGlyph({ guild, vaulted }: { guild: Guild; vaulted: boolean }) {
  const url = guildIconUrl(guild, 96);
  const filter = vaulted ? "grayscale opacity-55" : "";
  return url ? (
    <img src={url} alt="" className={`h-full w-full object-cover ${filter}`} loading="lazy" />
  ) : (
    <span className={`text-[15px] font-semibold text-muted ${filter}`}>{initials(guild.name)}</span>
  );
}

/** Desktop navigation: Discord's server rail, with Inbox, Messages and Events on top and vaulted servers last. */
export function Rail() {
  const client = useSignals(["route", "rules", "status"]);
  const store = useStore(["guilds", "me"]);
  const counts = useNavCounts();
  const badges = useGuildBadges();
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null);
  const { route, rules } = client;
  const guilds = store.sortedGuilds();
  const open = guilds.filter((g) => R.modeOf(rules.config, g.id) === "open");
  const vault = guilds.filter((g) => R.modeOf(rules.config, g.id) === "vault");
  const menu = (g: Guild) => (e: MouseEvent) => {
    e.preventDefault();
    setTip(null);
    client.openOverlay({ kind: "menu", x: e.clientX, y: e.clientY, items: guildMenu(client, g) });
  };
  const offline = client.status !== "ready";

  const guildItem = (g: Guild, vaulted: boolean) => {
    const { unread, mentions } = badges(g.id);
    return (
      <RailItem
        key={g.id}
        tone="guild"
        label={vaulted ? `${g.name} (vaulted)` : g.name}
        active={isActive(route, g.id)}
        unread={unread}
        badge={mentions}
        onClick={() => client.navigate(vaulted ? { view: "vault", guildId: g.id } : { view: "server", guildId: g.id })}
        onContextMenu={menu(g)}
        onTip={setTip}
      >
        <GuildGlyph guild={g} vaulted={vaulted} />
      </RailItem>
    );
  };

  return (
    <nav className="flex w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto bg-bg py-3 [scrollbar-width:none]">
      <RailItem label="Inbox" active={route.view === "inbox"} badge={counts.pinged} onClick={() => client.navigate({ view: "inbox" })} onTip={setTip}>
        <Inbox size={22} />
      </RailItem>
      <RailItem
        label="Direct Messages"
        active={route.view === "dms" || route.view === "friends"}
        badge={counts.unreadDms + counts.pendingFriends}
        onClick={() => client.navigate({ view: "dms" })}
        onTip={setTip}
      >
        <MessageCircle size={22} />
      </RailItem>
      <RailItem label="Events" active={route.view === "events"} badge={counts.weekEvents} softBadge onClick={() => client.navigate({ view: "events" })} onTip={setTip}>
        <CalendarDays size={22} />
      </RailItem>
      {open.length > 0 && <div className="h-0.5 w-8 shrink-0 rounded-full bg-line" />}
      {open.map((g) => guildItem(g, false))}
      {vault.length > 0 && <div className="h-0.5 w-8 shrink-0 rounded-full bg-line" />}
      {vault.map((g) => guildItem(g, true))}
      <div className="mt-auto flex w-full flex-col items-center gap-2 pt-2">
        <RailItem label="Done for now" active={false} onClick={() => client.done()} onTip={setTip}>
          <Check size={22} />
        </RailItem>
        <RailItem
          tone="guild"
          label={offline ? `You · ${client.status}` : `You · ${STATUS_LABEL[client.ownStatus()]}`}
          active={route.view === "settings"}
          onClick={() => undefined}
          onPointer={(e) => {
            setTip(null);
            const r = e.currentTarget.getBoundingClientRect();
            client.openOverlay({
              kind: "menu",
              x: r.right + 8,
              y: r.bottom - 230,
              items: statusMenu(client, [{ separator: true }, { label: "Settings", icon: <Settings size={16} />, onSelect: () => client.navigate({ view: "settings" }) }]),
            });
          }}
          onTip={setTip}
        >
          <Avatar user={store.me ?? undefined} size={48} />
        </RailItem>
        <span className="pointer-events-none -mt-5 ml-8 rounded-full bg-bg p-[3px]">
          <StatusDot status={client.ownStatus() === "invisible" ? "invisible" : client.ownStatus()} size={12} />
        </span>
        {offline && <span className="-mt-1 h-1.5 w-6 rounded-full bg-warn" title={client.status} />}
      </div>
      {tip && (
        <div
          className="pointer-events-none fixed left-[78px] z-50 max-w-[240px] -translate-y-1/2 rounded-md bg-text px-3 py-1.5 text-[14px] font-semibold text-bg shadow-lg"
          style={{ top: tip.top }}
        >
          {tip.label}
        </div>
      )}
    </nav>
  );
}

/** Phone: the server list (the rail's job on desktop), with names since there's room. */
export function GuildList() {
  const client = useSignals(["route", "rules"]);
  const store = useStore(["guilds"]);
  const badges = useGuildBadges();
  const now = useNow(30_000);
  const guilds = store.sortedGuilds();
  const open = guilds.filter((g) => R.modeOf(client.rules.config, g.id) === "open");
  const vault = guilds.filter((g) => R.modeOf(client.rules.config, g.id) === "vault");
  const heading = "mb-1 mt-5 px-2 text-[12px] font-semibold uppercase tracking-wide text-muted first:mt-0";

  const row = (g: Guild, vaulted: boolean) => {
    const { unread, mentions } = badges(g.id);
    const passOpen = vaulted && R.activePasses(client.rules, now).some((p) => p.guildId === g.id);
    return (
      <button
        key={g.id}
        onClick={() => client.navigate(vaulted ? { view: "vault", guildId: g.id } : { view: "server", guildId: g.id, list: true })}
        onContextMenu={(e) => {
          e.preventDefault();
          client.openOverlay({ kind: "menu", x: e.clientX, y: e.clientY, items: guildMenu(client, g) });
        }}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left active:bg-sunken"
      >
        <GuildIcon guild={g} size={40} muted={vaulted} />
        <span className={`min-w-0 flex-1 truncate text-[15.5px] ${unread ? "font-semibold text-text" : vaulted ? "text-muted" : "text-text/85"}`}>{g.name}</span>
        {passOpen ? <span className="h-2 w-2 rounded-full bg-accent" title="Pass open" /> : <Count n={mentions} strong />}
        {vaulted && !mentions && !passOpen && <Lock size={13} className="text-faint" />}
      </button>
    );
  };

  return (
    <>
      {open.length > 0 && <div className={heading}>Servers</div>}
      {open.map((g) => row(g, false))}
      {vault.length > 0 && <div className={heading}>Vault</div>}
      {vault.map((g) => row(g, true))}
    </>
  );
}

export function DoneButton({ className = "" }: { className?: string }) {
  const client = useClient();
  return (
    <button
      onClick={() => client.done()}
      className={`flex items-center justify-center gap-2 rounded-lg border border-line bg-surface py-2 text-[14px] font-medium text-muted hover:bg-sunken hover:text-text ${className}`}
    >
      <Check size={16} /> Done for now
    </button>
  );
}
