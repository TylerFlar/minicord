import type { Channel, User } from "@minicord/core";
import { useEffect, useState } from "react";
import { useClient, useStore } from "../app/context.tsx";
import { NameList } from "./ui.tsx";

/** People typing in a channel right now (not you, not people you've blocked); re-renders as they start and stop. */
export function useTyping(channelId: string): User[] {
  const store = useStore([`typing:${channelId}`, "relationships"]);
  const [, expire] = useState(0);
  const until = store.typingUntil(channelId);
  useEffect(() => {
    if (until === undefined) return;
    const timer = setTimeout(() => expire((n) => n + 1), Math.max(0, until - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [until]);
  return store.typingIn(channelId);
}

/** Discord's bouncing dots; `badge` sizes them for an avatar's status badge. */
export function TypingDots({ badge = false }: { badge?: boolean }) {
  return (
    <span className={badge ? "typing-dots badge" : "typing-dots"} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

/** "Sam is typing…" under the composer. */
export function TypingIndicator({ channel }: { channel: Channel }) {
  const store = useClient().store;
  const typing = useTyping(channel.id);
  const strong = (text: string) => <span className="font-semibold text-text/80">{text}</span>;
  return (
    <div className="flex h-6 shrink-0 items-center gap-1.5 px-4 text-[12.5px] text-muted">
      {typing.length > 0 && (
        <>
          <TypingDots />
          <span className="truncate">
            {typing.length > 3 ? (
              <>{strong("Several people")} are typing…</>
            ) : (
              <>
                <NameList names={typing.map((u) => strong(store.displayName(u.id, channel.guild_id)))} /> {typing.length === 1 ? "is" : "are"} typing…
              </>
            )}
          </span>
        </>
      )}
    </div>
  );
}
