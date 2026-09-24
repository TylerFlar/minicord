import { ChannelType, RelationshipType, type Channel, type User } from "@minicord/core";
import { ArrowLeft, BellOff, Check, CheckCheck, MessageCircle, MoreVertical, Plus, Search, UserMinus, Users, X } from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";
import { Avatar } from "../components/Avatar.tsx";
import { Conversation } from "../components/Conversation.tsx";
import { Empty, IconButton, Modal } from "../components/ui.tsx";
import type { MinicordClient } from "../app/client.ts";
import { useClient, useStore } from "../app/context.tsx";
import type { MenuEntry } from "../app/overlay.ts";
import { activityText, effectiveStatus, STATUS_LABEL } from "../lib/presence.ts";
import { useIsMobile } from "../lib/responsive.ts";
import { Count } from "../components/Sidebar.tsx";

function dmMenu(client: MinicordClient, c: Channel): MenuEntry[] {
  const muted = client.isMuted({ channel: c });
  const user = c.type === ChannelType.DM ? c.recipient_ids?.[0] : undefined;
  return [
    { label: "Mark as read", icon: <CheckCheck size={16} />, onSelect: () => client.markChannelRead(c.id) },
    { label: muted ? "Unmute conversation" : "Mute conversation", icon: <BellOff size={16} />, onSelect: () => void client.setMuted({ channel: c }, !muted) },
    ...(user ? [{ label: "Profile", icon: <Users size={16} />, onSelect: () => client.openOverlay({ kind: "profile", x: 320, y: 120, userId: user }) }] : []),
  ];
}

function DmList({ selected, mobile }: { selected?: string; mobile: boolean }) {
  const client = useClient();
  const store = useStore(["dms", "readstates", "relationships", "settings", "presences"]);
  const [picking, setPicking] = useState(false);
  const pending = [...store.relationships.values()].filter((r) => r.type === RelationshipType.IncomingRequest).length;
  const context = (c: Channel) => (e: MouseEvent) => {
    e.preventDefault();
    client.openOverlay({ kind: "menu", x: e.clientX, y: e.clientY, items: dmMenu(client, c) });
  };

  return (
    <div className={`flex shrink-0 flex-col bg-bg ${mobile ? "w-full" : "w-60 border-r border-line"}`} style={{ ["--avatar-ring" as string]: "var(--mc-bg)" }}>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-2.5">
        <button onClick={() => client.openOverlay({ kind: "switcher" })} className="flex h-8 flex-1 items-center gap-2 rounded-md bg-sunken px-2.5 text-left text-[13.5px] text-faint">
          <Search size={15} /> Find a conversation
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <button
          onClick={() => client.navigate({ view: "friends" })}
          className="mb-3 flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-[15px] text-muted hover:bg-sunken/70 hover:text-text"
        >
          <Users size={20} /> <span className="flex-1">Friends</span>
          <Count n={pending} strong />
        </button>
        <div className="flex items-center justify-between px-2 pb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">
          Direct Messages
          <button aria-label="New message" title="New message" onClick={() => setPicking(true)} className="hover:text-text">
            <Plus size={16} />
          </button>
        </div>
        {store.dmChannels().map((c) => {
          const muted = store.mutedByDiscord(c);
          const unread = store.isUnread(c.id) && !muted;
          const mentions = store.mentionCount(c.id);
          const group = c.type === ChannelType.GroupDM;
          const active = c.id === selected;
          return (
            <div key={c.id} className="relative">
              {unread && !active && <span className="absolute -left-2 top-1/2 h-2 w-1 -translate-y-1/2 rounded-r-full bg-text" />}
              <button
                data-dm={c.id}
                onClick={() => client.navigate({ view: "dms", channelId: c.id })}
                onContextMenu={context(c)}
                className={`flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left ${active ? "bg-sunken" : "hover:bg-sunken/70"} ${muted ? "opacity-50" : ""}`}
              >
                {group ? (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                    <Users size={16} />
                  </span>
                ) : (
                  <DmAvatar userId={c.recipient_ids?.[0]} />
                )}
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[15px] ${unread || active ? "font-semibold text-text" : "text-muted"}`}>{store.channelName(c)}</span>
                  {group ? (
                    <span className="block text-[12px] text-faint">
                      {(c.recipient_ids?.length ?? 0) + 1} {(c.recipient_ids?.length ?? 0) + 1 === 1 ? "Member" : "Members"}
                    </span>
                  ) : (
                    <DmSubline userId={c.recipient_ids?.[0]} />
                  )}
                </span>
                {mentions > 0 && <Count n={mentions} strong />}
              </button>
            </div>
          );
        })}
      </div>
      {picking && <FriendPicker onClose={() => setPicking(false)} />}
    </div>
  );
}

/** A DM avatar with the person's status when we know it (friends). */
function DmAvatar({ userId }: { userId: string | undefined }) {
  const store = useClient().store;
  const user = userId ? store.users.get(userId) : undefined;
  const presence = userId ? store.presenceOf(userId) : undefined;
  const friend = !!userId && store.relationships.get(userId)?.type === RelationshipType.Friend;
  return <Avatar user={user} size={32} {...(presence || friend ? { status: effectiveStatus(presence) } : {})} />;
}

function DmSubline({ userId }: { userId: string | undefined }) {
  const store = useClient().store;
  const text = activityText(userId ? store.presenceOf(userId) : undefined);
  return text ? <span className="block truncate text-[12px] text-faint">{text}</span> : null;
}

export function DirectMessagesScreen({ channelId, anchor }: { channelId?: string; anchor?: string }) {
  const client = useClient();
  const mobile = useIsMobile();
  if (mobile && channelId) {
    return <Conversation key={channelId} channelId={channelId} {...(anchor ? { anchor } : {})} onBack={() => client.navigate({ view: "dms" })} />;
  }
  return (
    <div className="flex min-w-0 flex-1">
      <DmList {...(channelId ? { selected: channelId } : {})} mobile={mobile} />
      {mobile ? null : channelId ? <Conversation key={channelId} channelId={channelId} {...(anchor ? { anchor } : {})} /> : <FriendsView />}
    </div>
  );
}

/** Desktop: friends sit next to the DM list; phone: their own screen. */
export function FriendsScreen() {
  const mobile = useIsMobile();
  if (mobile) return <FriendsView />;
  return (
    <div className="flex min-w-0 flex-1">
      <DmList mobile={false} />
      <FriendsView />
    </div>
  );
}

function RoundAction({ label, onClick, children, tone = "default" }: { label: string; onClick: (e: MouseEvent) => void; children: ReactNode; tone?: "default" | "good" | "bad" }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className={`flex h-9 w-9 items-center justify-center rounded-full bg-sunken text-muted ${tone === "good" ? "hover:text-accent" : tone === "bad" ? "hover:text-danger" : "hover:text-text"}`}
    >
      {children}
    </button>
  );
}

function FriendsView() {
  const client = useClient();
  const store = useStore(["relationships", "dms", "presences"]);
  const mobile = useIsMobile();
  const [tab, setTab] = useState<"online" | "all" | "pending">("online");
  const rels = [...store.relationships.values()];
  const pending = rels.filter((r) => r.type === RelationshipType.IncomingRequest || r.type === RelationshipType.OutgoingRequest);
  const all = store.friends();
  const online = all.filter((u) => effectiveStatus(store.presenceOf(u.id)) !== "offline");
  const friends = tab === "online" ? online : all;
  const statusLine = (u: User) => {
    const presence = store.presenceOf(u.id);
    return activityText(presence) ?? STATUS_LABEL[effectiveStatus(presence)];
  };
  const userOf = (id: string) => store.users.get(id);

  const row = (user: User, sub: string, actions: ReactNode) => (
    <div
      key={user.id}
      onClick={(e) => client.openOverlay({ kind: "profile", x: e.clientX, y: e.clientY, userId: user.id })}
      className="group flex cursor-pointer items-center gap-3 border-t border-line px-2 py-2.5 first:border-t-0 hover:rounded-lg hover:border-transparent hover:bg-sunken/60"
    >
      <Avatar user={user} size={36} {...(tab === "pending" ? {} : { status: effectiveStatus(store.presenceOf(user.id)) })} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{store.userName(user)}</span>
        <span className="block truncate text-[12.5px] text-muted">{sub}</span>
      </span>
      <span className="flex gap-2">{actions}</span>
    </div>
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-surface">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-3 sm:px-4">
        {mobile && (
          <IconButton label="Back" onClick={() => client.back()} className="-ml-1.5">
            <ArrowLeft size={19} />
          </IconButton>
        )}
        <Users size={20} className="text-muted" />
        <span className="font-semibold">Friends</span>
        <span className="h-5 w-px bg-line" />
        {(["online", "all", "pending"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[14.5px] ${tab === t ? "bg-sunken font-medium text-text" : "text-muted hover:bg-sunken/60 hover:text-text"}`}>
            {t === "online" ? "Online" : t === "all" ? "All" : "Pending"}
            {t === "pending" && <Count n={pending.filter((r) => r.type === RelationshipType.IncomingRequest).length} strong />}
          </button>
        ))}
      </header>
      <div className="flex-1 overflow-y-auto px-3 py-3 sm:px-6">
        {tab !== "pending" ? (
          friends.length ? (
            <>
              <div className="px-2 pb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
                {tab === "online" ? "Online" : "All friends"} — {friends.length}
              </div>
              {friends.map((u) =>
                row(
                  u,
                  statusLine(u),
                  <>
                    <RoundAction label="Message" onClick={() => void client.openDmWith(u.id)}>
                      <MessageCircle size={17} />
                    </RoundAction>
                    <RoundAction
                      label="More"
                      onClick={(e) =>
                        client.openOverlay({
                          kind: "menu",
                          x: e.clientX,
                          y: e.clientY,
                          items: [
                            {
                              label: "Remove friend",
                              icon: <UserMinus size={16} />,
                              danger: true,
                              onSelect: () =>
                                client.confirm({
                                  title: `Remove ${store.userName(u)}`,
                                  body: "They won't be notified.",
                                  action: "Remove friend",
                                  danger: true,
                                  run: () => void client.respondToFriend(u.id, false),
                                }),
                            },
                          ],
                        })
                      }
                    >
                      <MoreVertical size={17} />
                    </RoundAction>
                  </>,
                ),
              )}
            </>
          ) : (
            <Empty icon={<Users size={28} />} title={tab === "online" ? "No one's around" : "No friends yet"} />
          )
        ) : pending.length ? (
          <>
            <div className="px-2 pb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Pending — {pending.length}</div>
            {pending.map((r) => {
              const user = r.user ?? userOf(r.user_id ?? r.id);
              if (!user) return null;
              const incoming = r.type === RelationshipType.IncomingRequest;
              return row(
                user,
                incoming ? "Incoming friend request" : "Outgoing friend request",
                <>
                  {incoming && (
                    <RoundAction label="Accept" tone="good" onClick={() => void client.respondToFriend(user.id, true)}>
                      <Check size={18} />
                    </RoundAction>
                  )}
                  <RoundAction label={incoming ? "Ignore" : "Cancel"} tone="bad" onClick={() => void client.respondToFriend(user.id, false)}>
                    <X size={18} />
                  </RoundAction>
                </>,
              );
            })}
          </>
        ) : (
          <Empty icon={<Users size={28} />} title="No pending requests" />
        )}
      </div>
    </div>
  );
}

function FriendPicker({ onClose }: { onClose: () => void }) {
  const client = useClient();
  const store = client.store;
  const [q, setQ] = useState("");
  const friends = store.friends().filter((u) => `${store.userName(u)} ${u.username}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal title="New message" onClose={onClose}>
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Type the name of a friend"
        className="mb-2 w-full rounded-md bg-sunken px-2.5 py-2 text-[14px] outline-none"
      />
      <div className="max-h-80 overflow-y-auto">
        {friends.map((u) => (
          <button
            key={u.id}
            onClick={() => {
              onClose();
              void client.openDmWith(u.id);
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-sunken"
          >
            <Avatar user={u} size={32} />
            <span className="text-[14.5px] font-medium">{store.userName(u)}</span>
            <span className="text-[12.5px] text-faint">{u.username}</span>
          </button>
        ))}
        {!friends.length && <div className="p-3 text-[13px] text-muted">No friends match.</div>}
      </div>
    </Modal>
  );
}
