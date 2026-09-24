import { Phone, PhoneOff, X } from "lucide-react";
import { useSignals, useStore } from "../app/context.tsx";
import { Avatar } from "./Avatar.tsx";
import { Button } from "./ui.tsx";

export function Toasts() {
  const client = useSignals(["toasts"]);
  if (!client.toasts.length) return null;
  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 flex flex-col gap-2 sm:bottom-4 sm:left-auto sm:w-80">
      {client.toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-start gap-2 rounded-lg border bg-surface p-3 text-[13.5px] shadow-lg ${
            t.tone === "error" ? "border-danger/40" : t.tone === "warn" ? "border-warn/40" : "border-line"
          }`}
        >
          <span className="flex-1">{t.text}</span>
          {t.action && (
            <button className="font-medium text-accent hover:underline" onClick={() => { t.action!.run(); client.dismissToast(t.id); }}>
              {t.action.label}
            </button>
          )}
          <button onClick={() => client.dismissToast(t.id)} className="text-faint hover:text-text" aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function CallBanner() {
  const client = useSignals(["call"]);
  const store = useStore(["calls", "dms"]);
  const call = client.incomingCall;
  if (!call) return null;
  const channel = store.channels.get(call.channelId);
  const caller = channel ? store.recipients(channel)[0] : undefined;
  return (
    <div className="fixed left-1/2 top-4 z-50 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-xl">
      <Avatar user={caller} size={36} />
      <div className="mr-2">
        <div className="font-semibold">{store.channelName(channel)}</div>
        <div className="text-[12.5px] text-muted">is calling you</div>
      </div>
      <Button tone="accent" onClick={() => client.joinCall(call.channelId)}>
        <Phone size={14} /> Join
      </Button>
      <Button onClick={() => client.dismissCall()}>
        <PhoneOff size={14} /> Not now
      </Button>
    </div>
  );
}
