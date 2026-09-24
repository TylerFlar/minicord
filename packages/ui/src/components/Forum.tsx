import { ChannelType, snowflakeToMs, type Channel, type Message } from "@minicord/core";
import { ArrowLeft, MessageSquare, MessagesSquare, Paperclip, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useClient, useStore } from "../app/context.tsx";
import { formatRelative } from "../lib/format.ts";
import { messagePreview } from "../lib/preview.ts";
import { Button, Empty, IconButton, Spinner } from "./ui.tsx";

const REQUIRE_TAG = 1 << 4;

/** Title, tags, text and files for a new post (Discord's "New Post" form). */
function NewPost({ channel, onCancel }: { channel: Channel; onCancel: () => void }) {
  const client = useClient();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const available = channel.available_tags ?? [];
  const needsTag = !!((channel.flags ?? 0) & REQUIRE_TAG) && available.length > 0;
  const needsMedia = channel.type === ChannelType.GuildMedia;
  const ready = title.trim() && (content.trim() || files.length) && (!needsTag || tags.length) && (!needsMedia || files.length);
  const field = "w-full rounded-md bg-sunken px-3 py-2 outline-none focus:ring-2 focus:ring-accent/40";

  const post = async () => {
    if (!ready || busy) return;
    setBusy(true);
    const ok = await client.createForumPost(channel, { title, content, tags, files });
    setBusy(false);
    if (ok) onCancel();
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-bg p-3">
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="Post title" className={`${field} text-[16px] font-semibold`} />
      {available.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {available.map((t) => {
            const on = tags.includes(t.id);
            return (
              <button
                key={t.id}
                onClick={() => setTags(on ? tags.filter((x) => x !== t.id) : [...tags, t.id].slice(0, 5))}
                className={`rounded-full px-2.5 py-0.5 text-[12.5px] font-medium ${on ? "bg-accent text-on-accent" : "bg-sunken text-muted hover:text-text"}`}
              >
                {t.emoji_name ? `${t.emoji_name} ` : ""}
                {t.name}
              </button>
            );
          })}
        </div>
      )}
      <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={4} placeholder="Write something" className={`${field} resize-y text-[15px]`} />
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="flex items-center gap-1.5 rounded-md bg-sunken px-2 py-1 text-[12.5px]">
              {f.name}
              <button aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((x) => x !== f))} className="text-muted hover:text-danger">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button onClick={() => fileInput.current?.click()} className="flex items-center gap-1.5 text-[13.5px] text-muted hover:text-text">
          <Paperclip size={15} /> Attach
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const max = client.uploadLimit();
            const picked = [...(e.target.files ?? [])];
            if (picked.some((f) => f.size > max)) client.toast("Some files are over your upload limit.", "warn");
            setFiles([...files, ...picked.filter((f) => f.size <= max)].slice(0, 10));
            e.target.value = "";
          }}
        />
        <span className="ml-auto" />
        <Button tone="quiet" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button tone="accent" size="sm" disabled={!ready || busy} onClick={() => void post()}>
          {busy ? "Posting…" : "Post"}
        </Button>
      </div>
    </div>
  );
}

/** Forum and media channels: posts as cards, newest activity first; a post opens as a thread. */
export function ForumView({ channel, onBack }: { channel: Channel; onBack?: () => void }) {
  const client = useClient();
  const store = useStore(["channels", `channels:${channel.guild_id}`]);
  const [posts, setPosts] = useState<Channel[]>([]);
  const [first, setFirst] = useState<Record<string, Message>>({});
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState<{ archived: boolean; offset: number } | null>(null);
  const [composing, setComposing] = useState(false);
  const canPost = client.canSendIn(channel);

  const load = useCallback(
    async (archived: boolean, offset: number) => {
      setLoading(true);
      try {
        const res = await client.api.searchThreads(channel.id, { archived, offset, limit: 25 });
        store.upsertChannels(res.threads);
        setPosts((prev) => [...prev, ...res.threads.filter((t) => !prev.some((p) => p.id === t.id))]);
        setFirst((prev) => ({ ...prev, ...Object.fromEntries((res.first_messages ?? []).map((m) => [m.channel_id, m])) }));
        // Active posts first, then the archive.
        setMore(res.has_more ? { archived, offset: offset + res.threads.length } : archived ? null : { archived: true, offset: 0 });
      } catch {
        setMore(null);
      } finally {
        setLoading(false);
      }
    },
    [client, store, channel.id],
  );

  useEffect(() => {
    setPosts([]);
    setFirst({});
    void load(false, 0);
  }, [load]);

  const live = store.threadsOf(channel.id);
  const all = [...live, ...posts.filter((p) => !live.some((l) => l.id === p.id))].sort(
    (a, b) => snowflakeToMs(b.last_message_id ?? b.id) - snowflakeToMs(a.last_message_id ?? a.id),
  );
  const tags = new Map((channel.available_tags ?? []).map((t) => [t.id, t]));

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-surface">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3 sm:px-4">
        {onBack && (
          <IconButton label="Back" onClick={onBack} className="-ml-1.5">
            <ArrowLeft size={19} />
          </IconButton>
        )}
        <MessagesSquare size={20} className="shrink-0 text-muted" />
        <span className="truncate text-[15.5px] font-semibold">{channel.name}</span>
        {channel.topic && <span className="hidden min-w-0 truncate border-l border-line pl-3 text-[13.5px] text-muted md:inline">{channel.topic}</span>}
        {canPost && !composing && (
          <Button tone="accent" size="sm" className="ml-auto shrink-0" onClick={() => setComposing(true)}>
            <Plus size={14} /> New post
          </Button>
        )}
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 p-3 sm:p-4">
          {composing && <NewPost channel={channel} onCancel={() => setComposing(false)} />}
          {all.map((post) => {
            const msg = first[post.id];
            const author = post.owner_id ? store.displayName(post.owner_id, channel.guild_id) : undefined;
            const image = msg?.attachments?.find((a) => a.content_type?.startsWith("image/"));
            const unread = store.readStates.has(post.id) && store.isUnread(post.id);
            return (
              <button
                key={post.id}
                onClick={() => channel.guild_id && client.navigate({ view: "server", guildId: channel.guild_id, channelId: post.id })}
                className="flex gap-3 rounded-lg border border-line bg-bg p-3 text-left hover:border-muted/40 hover:bg-sunken/50"
              >
                <div className="min-w-0 flex-1">
                  {!!post.applied_tags?.length && (
                    <div className="mb-1 flex flex-wrap gap-1">
                      {post.applied_tags.map((id) => {
                        const tag = tags.get(id);
                        return tag ? (
                          <span key={id} className="rounded-full bg-sunken px-2 py-px text-[11.5px] font-medium text-muted">
                            {tag.emoji_name ? `${tag.emoji_name} ` : ""}
                            {tag.name}
                          </span>
                        ) : null;
                      })}
                    </div>
                  )}
                  <div className={`text-[15.5px] leading-snug ${unread ? "font-bold" : "font-semibold"}`}>{post.name}</div>
                  {msg && (
                    <div className="mt-0.5 line-clamp-2 text-[13.5px] text-muted">
                      {author && <span className="font-medium text-text/80">{author}: </span>}
                      {messagePreview(msg, store, 200)}
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-3 text-[12.5px] text-muted">
                    <span className="flex items-center gap-1">
                      <MessageSquare size={13} /> {post.message_count ?? 0}
                    </span>
                    <span>{formatRelative(snowflakeToMs(post.last_message_id ?? post.id))}</span>
                  </div>
                </div>
                {image && <img src={`${image.proxy_url}${image.proxy_url.includes("?") ? "&" : "?"}width=160&height=160`} alt="" className="h-20 w-20 shrink-0 rounded-md object-cover" loading="lazy" />}
              </button>
            );
          })}
          {loading && <Spinner />}
          {!loading && !all.length && <Empty icon={<MessagesSquare size={28} />} title="No posts yet" />}
          {!loading && more && (
            <Button tone="quiet" className="self-center" onClick={() => void load(more.archived, more.offset)}>
              {more.archived && more.offset === 0 ? "Older posts" : "More"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
