import { CalendarDays, Inbox, LayoutGrid, MessageCircle, Settings } from "lucide-react";
import { useSignals } from "../app/context.tsx";
import type { Route } from "../app/route.ts";
import { useNavCounts } from "./Sidebar.tsx";

/** Phone navigation. Five destinations, quiet badges, nothing that pulses. */
export function BottomTabs() {
  const client = useSignals(["route"]);
  const counts = useNavCounts();
  const view = client.route.view;
  const tabs: { view: Route["view"]; label: string; icon: typeof Inbox; badge?: number; strong?: boolean; also?: Route["view"][] }[] = [
    { view: "inbox", label: "Inbox", icon: Inbox, badge: counts.pinged, strong: true },
    { view: "dms", label: "Chats", icon: MessageCircle, badge: counts.unreadDms + counts.pendingFriends, strong: true, also: ["friends"] },
    { view: "servers", label: "Servers", icon: LayoutGrid, also: ["server", "vault"] },
    { view: "events", label: "Events", icon: CalendarDays, badge: counts.weekEvents },
    { view: "settings", label: "You", icon: Settings },
  ];
  return (
    <nav className="flex shrink-0 border-t border-line bg-bg" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      {tabs.map(({ view: target, label, icon: Icon, badge, strong, also }) => {
        const active = view === target || !!also?.includes(view);
        return (
          <button
            key={target}
            onClick={() => client.navigate({ view: target } as Route)}
            className={`relative flex flex-1 flex-col items-center gap-0.5 pb-1.5 pt-2 text-[11px] font-medium ${active ? "text-text" : "text-muted"}`}
          >
            <Icon size={22} strokeWidth={active ? 2.3 : 1.8} />
            {label}
            {!!badge && (
              <span
                className={`absolute left-1/2 top-1 ml-1.5 min-w-[18px] rounded-full border-2 border-bg px-1 text-center text-[10.5px] font-bold leading-[14px] tabular-nums ${
                  strong ? "bg-danger text-white" : "bg-sunken text-muted"
                }`}
              >
                {badge > 99 ? "99+" : badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
