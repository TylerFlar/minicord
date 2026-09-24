import type { Channel, ListMember, MemberListItem, User } from "@minicord/core";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useClient, useSignals, useStore } from "../app/context.tsx";
import { pointFrom } from "../app/overlay.ts";
import { activityText, effectiveStatus } from "../lib/presence.ts";
import { Avatar } from "./Avatar.tsx";
import { Spinner } from "./ui.tsx";

function Row({ user, name, color, sub, status, dim, onOpen }: {
  user: User | undefined;
  name: string;
  color?: string | undefined;
  sub?: string | undefined;
  status: ReturnType<typeof effectiveStatus>;
  dim?: boolean;
  onOpen: (e: MouseEvent) => void;
}) {
  return (
    <button onClick={onOpen} className={`flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-sunken ${dim ? "opacity-40 hover:opacity-100" : ""}`}>
      <Avatar user={user} size={32} status={status} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium leading-tight" style={color ? { color } : undefined}>
          {name}
          {user?.bot && <span className="ml-1.5 rounded bg-accent px-1 align-middle text-[9.5px] font-semibold text-on-accent">APP</span>}
        </span>
        {sub && <span className="block truncate text-[12.5px] leading-tight text-muted">{sub}</span>}
      </span>
    </button>
  );
}

const header = "px-2 pb-1 pt-5 text-[12px] font-semibold uppercase tracking-wide text-muted first:pt-2";

/** Group DMs: the people in it, with their status. */
function GroupMembers({ channel }: { channel: Channel }) {
  const client = useClient();
  const store = useStore(["presences", "dms"]);
  const people = [...store.recipients(channel), ...(store.me ? [store.me] : [])];
  return (
    <div className="p-2">
      <div className={header}>Members — {people.length}</div>
      {people.map((u) => {
        const presence = u.id === store.me?.id ? undefined : store.presenceOf(u.id);
        return (
          <Row
            key={u.id}
            user={u}
            name={store.userName(u)}
            sub={activityText(presence)}
            status={u.id === store.me?.id ? (client.ownStatus() === "invisible" ? "offline" : client.ownStatus()) : effectiveStatus(presence)}
            onOpen={(e) => client.openOverlay({ kind: "profile", ...pointFrom(e, true), userId: u.id })}
          />
        );
      })}
    </div>
  );
}

/** Discord's member sidebar for a server channel, loaded 100 at a time as you scroll (op 37). */
export function MemberList({ channel, sheet = false }: { channel: Channel; sheet?: boolean }) {
  const client = useSignals(["ready"]);
  const guildId = channel.guild_id;
  const store = useStore([`memberlist:${guildId ?? ""}`, "presences"]);
  const scroller = useRef<HTMLDivElement>(null);
  const [through, setThrough] = useState(99);
  const readyVersion = client.signals.version("ready");

  useEffect(() => setThrough(99), [channel.id]);
  useEffect(() => {
    if (guildId) client.subscribeMemberList(channel, through);
  }, [client, channel, guildId, through, readyVersion]);

  const frame = sheet ? "max-h-[70vh] overflow-y-auto" : "w-60 shrink-0 overflow-y-auto border-l border-line bg-bg";
  if (!guildId) {
    return (
      <div className={frame} style={{ ["--avatar-ring" as string]: sheet ? "var(--mc-surface)" : "var(--mc-bg)" }}>
        <GroupMembers channel={channel} />
      </div>
    );
  }

  const list = store.memberListFor(channel);
  const guild = store.guilds.get(guildId);
  const totalRows = list ? list.groups.reduce((n, g) => n + (g.count ? g.count + 1 : 0), 0) : 0;
  const onScroll = () => {
    const el = scroller.current;
    if (!el || !list) return;
    const nearEnd = el.scrollTop + el.clientHeight > el.scrollHeight - 300;
    if (nearEnd && list.items.length >= through - 5 && list.items.length < totalRows) setThrough((t) => t + 100);
  };

  let group = "";
  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      className={frame}
      style={{ ["--avatar-ring" as string]: sheet ? "var(--mc-surface)" : "var(--mc-bg)" }}
    >
      {!list ? (
        <Spinner />
      ) : (
        <div className="p-2">
          {list.items.map((item: MemberListItem | undefined, i) => {
            if (!item) return <div key={i} className="h-[46px]" />;
            if ("group" in item) {
              group = item.group.id;
              const role = guild?.roles.find((r) => r.id === item.group.id);
              const label = role?.name ?? (item.group.id === "online" ? "Online" : item.group.id === "offline" ? "Offline" : item.group.id);
              const count = list.groups.find((g) => g.id === item.group.id)?.count ?? item.group.count;
              return (
                <div key={`g:${item.group.id}`} className={header}>
                  {label}
                  {count ? ` — ${count}` : ""}
                </div>
              );
            }
            const m: ListMember = item.member;
            const userId = m.user?.id ?? m.user_id ?? "";
            const user = m.user ?? store.users.get(userId);
            const presence = store.presenceOf(userId) ?? m.presence;
            return (
              <Row
                key={userId || i}
                user={user}
                name={m.nick || store.userName(user)}
                color={store.roleColor(guildId, userId, m)}
                sub={activityText(presence)}
                status={group === "offline" ? "offline" : effectiveStatus(presence)}
                dim={group === "offline"}
                onOpen={(e) => client.openOverlay({ kind: "profile", ...pointFrom(e, true), userId, guildId })}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
