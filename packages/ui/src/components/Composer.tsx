import { ChannelType, Permission, type Channel, type Emoji, type Message, type User } from "@minicord/core";
import { AtSign, FileText, Hash, Lock, PlusCircle, SendHorizontal, Smile, Sticker, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CommandEntry } from "../app/client.ts";
import { useClient, useStore } from "../app/context.tsx";
import type { PickedEmoji } from "../app/overlay.ts";
import { emojiUrl } from "../lib/cdn.ts";
import { customEmojiText, loadEmoji, outsideCode, replaceShortcodes, searchEmoji, useEmojiData, usableCustomEmoji } from "../lib/emoji.ts";
import { formatBytes } from "../lib/format.ts";
import { isTouch } from "../lib/responsive.ts";
import { Avatar } from "./Avatar.tsx";
import { appIconUrl, CommandForm } from "./CommandForm.tsx";
import { isChatMessage } from "./Message.tsx";

type Suggestion =
  | { kind: "user"; id: string; label: string; user: User; color?: string; token: string }
  | { kind: "role"; id: string; label: string; color?: string; token: string }
  | { kind: "special"; label: "everyone" | "here"; token: string }
  | { kind: "channel"; id: string; label: string; token: string }
  | { kind: "emoji"; label: string; emoji?: string; custom?: Emoji & { id: string; name: string }; token: string }
  | { kind: "command"; label: string; entry: CommandEntry; token: string }
  | { kind: "builtin"; label: string; description: string; token: string };

interface Trigger {
  char: "@" | "#" | ":" | "/";
  query: string;
  start: number;
}

const MAX_FILES = 10;

/** Discord's built-in text commands (they just rewrite your message). */
const BUILTINS: { name: string; description: string; apply: (rest: string) => string }[] = [
  { name: "shrug", description: "Appends ¯\\_(ツ)_/¯", apply: (r) => `${r} ¯\\_(ツ)_/¯` },
  { name: "tableflip", description: "Appends (╯°□°)╯︵ ┻━┻", apply: (r) => `${r} (╯°□°)╯︵ ┻━┻` },
  { name: "unflip", description: "Appends ┬─┬ノ( º _ ºノ)", apply: (r) => `${r} ┬─┬ノ( º _ ºノ)` },
  { name: "me", description: "Displays text with emphasis", apply: (r) => `_${r}_` },
  { name: "spoiler", description: "Marks your message as a spoiler", apply: (r) => `||${r}||` },
];

function findTrigger(text: string, caret: number): Trigger | null {
  const slash = /^\/([\w-]*(?: [\w-]*){0,2})$/.exec(text.slice(0, caret));
  if (slash) return { char: "/", query: slash[1]!, start: 0 };
  const m = /(?:^|[\s(])([@#:])([^\s@#:]{0,32})$/.exec(text.slice(0, caret));
  if (!m) return null;
  const char = m[1] as Trigger["char"];
  const query = m[2]!;
  if (char === ":" && query.length < 2) return null;
  return { char, query, start: caret - query.length - 1 };
}

function hex(n: number | undefined) {
  return n ? `#${n.toString(16).padStart(6, "0")}` : undefined;
}

export function Composer({
  channel,
  placeholder,
  blocked,
  replyTo,
  onClearReply,
  files,
  setFiles,
}: {
  channel: Channel;
  placeholder: string;
  /** Shown instead of the text box when you can't send here. */
  blocked?: ReactNode;
  replyTo: Message | null;
  onClearReply: () => void;
  files: File[];
  setFiles: (files: File[]) => void;
}) {
  const client = useClient();
  const store = useStore(["members", `members:${channel.guild_id ?? ""}`]);
  const emojiData = useEmojiData();
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [ping, setPing] = useState(true);
  const [commands, setCommands] = useState<CommandEntry[] | null>(null);
  const [command, setCommand] = useState<CommandEntry | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /** Readable tokens inserted by autocomplete → the raw form Discord expects (@name → <@id>). */
  const tokens = useRef(new Map<string, string>());
  const guildId = channel.guild_id;
  const premium = (store.me?.premium_type ?? 0) === 2;
  const limit = premium ? 4000 : 2000;
  const canAttach = !guildId || store.can(channel, Permission.AttachFiles);
  const touch = isTouch();

  // Keep an unsent draft per channel.
  useEffect(() => {
    const draft = client.drafts.get(channel.id) ?? "";
    setText(draft);
    tokens.current.clear();
    setCommands(null);
    setCommand(null);
    // On phones, opening a conversation shouldn't throw the keyboard over it.
    if (!touch) ref.current?.focus();
  }, [client, channel.id, touch]);

  useEffect(() => {
    setPing(true);
    if (replyTo) ref.current?.focus();
  }, [replyTo]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
  }, [text]);

  const trigger = useMemo(() => findTrigger(text, caret), [text, caret]);
  // Member search results arrive later (GUILD_MEMBERS_CHUNK); recompute suggestions when they do.
  const membersVersion = store.version("members");
  const custom = useMemo(() => usableCustomEmoji(store, guildId), [store, guildId]);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!trigger || trigger.start === dismissed) return [];
    const q = trigger.query.toLowerCase();
    if (trigger.char === "/") {
      const found: Suggestion[] = (commands ?? [])
        .filter((e) => [e.command.name, ...e.path].join(" ").startsWith(q))
        .slice(0, 10)
        .map((entry) => ({ kind: "command", label: [entry.command.name, ...entry.path].join(" "), entry, token: "" }));
      const builtins: Suggestion[] = BUILTINS.filter((b) => b.name.startsWith(q)).map((b) => ({ kind: "builtin", label: b.name, description: b.description, token: `/${b.name}` }));
      return [...found, ...builtins].slice(0, 12);
    }
    if (trigger.char === "@") {
      const pool = new Map<string, User>();
      if (guildId) {
        for (const [id, member] of store.memberCache.get(guildId) ?? []) {
          const user = member.user ?? store.users.get(id);
          if (user) pool.set(id, user);
        }
      } else {
        for (const u of store.recipients(channel)) pool.set(u.id, u);
      }
      for (const m of store.messagesOf(channel.id)?.messages ?? []) if (m.author && !pool.has(m.author.id)) pool.set(m.author.id, m.author);
      const users = [...pool.values()]
        .map((user) => {
          const label = store.displayName(user.id, guildId);
          const names = [label, user.username, user.global_name ?? ""].map((n) => n.toLowerCase());
          const score = names.some((n) => n.startsWith(q)) ? 0 : names.some((n) => n.includes(q)) ? 1 : -1;
          return { user, label, score };
        })
        .filter((x) => x.score >= 0)
        .sort((a, b) => a.score - b.score || a.label.localeCompare(b.label))
        .slice(0, 8)
        .map(({ user, label }): Suggestion => ({ kind: "user", id: user.id, label, user, color: store.roleColor(guildId, user.id), token: `@${user.username}` }));
      const out: Suggestion[] = [...users];
      if (guildId) {
        const everyone = store.can(channel, Permission.MentionEveryone);
        const guild = store.guilds.get(guildId);
        for (const r of guild?.roles ?? []) {
          if (r.id === guildId || (!r.mentionable && !everyone) || !r.name.toLowerCase().startsWith(q)) continue;
          if (out.length >= 11) break;
          out.push({ kind: "role", id: r.id, label: r.name, color: hex(r.colors?.primary_color ?? r.color), token: `@${r.name}` });
        }
        if (everyone) {
          for (const s of ["everyone", "here"] as const) if (s.startsWith(q)) out.push({ kind: "special", label: s, token: `@${s}` });
        }
      }
      return out;
    }
    if (trigger.char === "#") {
      if (!guildId) return [];
      return store
        .guildChannelGroups(guildId)
        .flatMap((g) => g.channels)
        .filter((c) => c.type !== ChannelType.GuildVoice && c.type !== ChannelType.GuildStageVoice && (c.name ?? "").toLowerCase().includes(q))
        .sort((a, b) => Number(!(a.name ?? "").startsWith(q)) - Number(!(b.name ?? "").startsWith(q)))
        .slice(0, 8)
        .map((c) => ({ kind: "channel", id: c.id, label: c.name ?? "", token: `#${c.name}` }));
    }
    const out: Suggestion[] = [];
    for (const g of custom) {
      for (const e of g.emojis) {
        if (out.length >= 4) break;
        if (e.name.toLowerCase().includes(q)) out.push({ kind: "emoji", label: e.name, custom: e, token: `:${e.name}:` });
      }
    }
    if (emojiData) {
      for (const e of searchEmoji(emojiData, q, 10 - out.length)) out.push({ kind: "emoji", label: e.names[0]!, emoji: e.emoji, token: e.emoji });
    }
    return out;
  }, [trigger, dismissed, store, guildId, channel, custom, emojiData, membersVersion, commands]);

  // Ask Discord for members as you type a mention, when we don't already know enough.
  useEffect(() => {
    if (trigger?.char === "@" && guildId && trigger.query && suggestions.length < 8) client.searchMembers(guildId, trigger.query);
    if (trigger?.char === ":" && !emojiData) void loadEmoji();
    if (trigger?.char === "/" && commands === null) {
      setCommands([]);
      void client.commandsFor(channel).then(setCommands);
    }
  }, [client, trigger, guildId, suggestions.length, emojiData, commands, channel]);

  useEffect(() => setIndex(0), [trigger?.start, trigger?.char]);

  if (blocked) {
    return (
      <div className="px-3 pb-3 sm:px-4 sm:pb-4">
        <div className="flex items-center gap-2.5 rounded-lg bg-sunken px-4 py-3 text-[14px] text-muted">
          <Lock size={15} className="shrink-0" /> {blocked}
        </div>
      </div>
    );
  }

  const update = (value: string, pos = value.length) => {
    setText(value);
    setCaret(pos);
    client.drafts.set(channel.id, value);
  };

  const insertAt = (start: number, end: number, insert: string) => {
    const next = text.slice(0, start) + insert + text.slice(end);
    const pos = start + insert.length;
    update(next, pos);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const accept = (s: Suggestion) => {
    if (!trigger) return;
    if (s.kind === "command") {
      update("");
      setCommand(s.entry);
      return;
    }
    if (s.kind === "user") tokens.current.set(s.token, `<@${s.id}>`);
    else if (s.kind === "role") tokens.current.set(s.token, `<@&${s.id}>`);
    else if (s.kind === "channel") tokens.current.set(s.token, `<#${s.id}>`);
    else if (s.kind === "emoji" && s.custom) tokens.current.set(s.token, customEmojiText(s.custom));
    insertAt(trigger.start, caret, `${s.token} `);
  };

  const pickEmoji = (e: PickedEmoji) => {
    const el = ref.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    if (e.id) {
      const token = `:${e.name}:`;
      tokens.current.set(token, e.text);
      insertAt(start, end, token);
    } else {
      insertAt(start, end, e.text);
    }
  };

  const addFiles = (incoming: File[]) => {
    if (!incoming.length) return;
    const max = client.uploadLimit();
    const tooBig = incoming.filter((f) => f.size > max);
    if (tooBig.length) client.toast(`${tooBig[0]!.name} is over the ${formatBytes(max)} upload limit.`, "warn");
    setFiles([...files, ...incoming.filter((f) => f.size <= max)].slice(0, MAX_FILES));
  };

  /** Readable text → what Discord expects: mention tokens, :shortcodes:, custom emoji. */
  const encode = async (value: string) => {
    const entries = [...tokens.current].sort((a, b) => b[0].length - a[0].length);
    let out = outsideCode(value, (plain) => entries.reduce((acc, [token, raw]) => acc.split(token).join(raw), plain));
    if (/:[\w+-]{2,}:/.test(out)) out = replaceShortcodes(await loadEmoji(), out, custom);
    return out;
  };

  const submit = async () => {
    const draft = text.trim();
    if ((!draft && !files.length) || draft.length > limit) return;
    const sending = files;
    const replying = replyTo;
    const builtin = /^\/(\w+)(?:\s+([\s\S]*))?$/.exec(draft);
    const rewrite = builtin ? BUILTINS.find((b) => b.name === builtin[1]) : undefined;
    const content = await encode(rewrite ? rewrite.apply((builtin![2] ?? "").trim()).trim() : draft);
    update("");
    setFiles([]);
    onClearReply();
    client.drafts.delete(channel.id);
    const ok = await client.send(channel.id, content, replying ?? undefined, { ping, files: sending });
    if (!ok) {
      update(draft);
      setFiles(sending);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setIndex((i) => (i + (e.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        accept(suggestions[index] ?? suggestions[0]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(trigger?.start ?? null);
        return;
      }
    }
    // Touch keyboards have no Shift+Enter, so Enter is a newline there and the button sends.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !touch) {
      e.preventDefault();
      void submit();
      return;
    }
    if (e.key === "ArrowUp" && !text) {
      const me = store.me?.id;
      const last = [...(store.messagesOf(channel.id)?.messages ?? [])].reverse().find((m) => m.author.id === me && !m.id.startsWith("pending-") && isChatMessage(m));
      if (last) {
        e.preventDefault();
        client.startEdit(last.id);
      }
      return;
    }
    if (e.key === "Escape" && replyTo) {
      e.preventDefault();
      onClearReply();
    }
  };

  /** GIFs and stickers go out as their own message, like in Discord. */
  const sendExtra = async (content: string, sticker?: { id: string; name: string; format_type: number }) => {
    const replying = replyTo;
    onClearReply();
    await client.send(channel.id, content, replying ?? undefined, { ping, ...(sticker ? { stickers: [sticker] } : {}) });
  };

  const openExpressions = (tab: "gif" | "sticker" | "emoji", e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    client.openOverlay({
      kind: "expressions",
      tab,
      x: r.right - 400,
      y: r.top - 468,
      ...(guildId ? { guildId } : {}),
      onEmoji: pickEmoji,
      onGif: (url) => void sendExtra(url),
      onSticker: (s) => void sendExtra("", s),
    });
  };

  const replyingToSelf = replyTo?.author.id === store.me?.id;
  const over = text.length - limit;

  return (
    <div className="relative px-3 pb-1 sm:px-4">
      {suggestions.length > 0 && (
        <div className="absolute inset-x-3 bottom-full mb-1 overflow-hidden rounded-lg border border-line bg-surface py-1.5 shadow-lg sm:inset-x-4">
          <div className="px-3 pb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">
            {trigger?.char === "@" ? "Members" : trigger?.char === "#" ? "Channels" : trigger?.char === "/" ? "Commands" : "Emoji"}
          </div>
          {suggestions.map((s, i) => (
            <button
              key={`${s.kind}:${s.label}:${"id" in s ? s.id : s.kind === "command" ? s.entry.command.id : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                accept(s);
              }}
              onMouseEnter={() => setIndex(i)}
              className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[14px] ${i === index ? "bg-sunken" : ""}`}
            >
              {s.kind === "user" && <Avatar user={s.user} size={24} />}
              {s.kind === "role" && <AtSign size={18} style={{ color: s.color }} className="text-muted" />}
              {s.kind === "special" && <AtSign size={18} className="text-muted" />}
              {s.kind === "channel" && <Hash size={18} className="text-muted" />}
              {s.kind === "emoji" &&
                (s.custom ? <img src={emojiUrl(s.custom.id, false, 32)} alt="" className="h-6 w-6 object-contain" /> : <span className="w-6 text-center text-[20px] leading-none">{s.emoji}</span>)}
              {(s.kind === "command" || s.kind === "builtin") &&
                (s.kind === "command" && appIconUrl(s.entry.app) ? (
                  <img src={appIconUrl(s.entry.app)!} alt="" className="h-6 w-6 rounded-full" />
                ) : (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sunken text-[12px] font-bold text-muted">/</span>
                ))}
              <span className="min-w-0 shrink-0 truncate font-medium" style={{ color: "color" in s ? s.color : undefined }}>
                {s.kind === "emoji" ? `:${s.label}:` : s.kind === "command" || s.kind === "builtin" ? `/${s.label}` : s.label}
              </span>
              {s.kind === "command" && <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{s.entry.description}</span>}
              {s.kind === "builtin" && <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{s.description}</span>}
              {s.kind === "command" && s.entry.app && <span className="shrink-0 text-[12px] text-faint">{s.entry.app.name}</span>}
              {s.kind === "user" && <span className="truncate text-[12.5px] text-muted">{s.user.username}</span>}
              {s.kind === "special" && <span className="text-[12.5px] text-muted">{s.label === "here" ? "Online members" : "Everyone"}</span>}
            </button>
          ))}
        </div>
      )}
      {replyTo && (
        <div className="flex items-center justify-between gap-3 rounded-t-lg bg-sunken/70 px-4 py-2 text-[13px] text-muted">
          <span className="min-w-0 truncate">
            Replying to <span className="font-semibold text-text">{store.authorName(replyTo)}</span>
          </span>
          <span className="flex shrink-0 items-center gap-3">
            {!replyingToSelf && (
              <button onClick={() => setPing((p) => !p)} className={`flex items-center gap-0.5 text-[12.5px] font-bold ${ping ? "text-accent" : "text-muted"}`} title="Mention the author">
                <AtSign size={14} />
                {ping ? "ON" : "OFF"}
              </button>
            )}
            <button onClick={onClearReply} aria-label="Cancel reply" className="rounded-full bg-muted/20 p-0.5 hover:text-text">
              <X size={13} />
            </button>
          </span>
        </div>
      )}
      {command ? (
        <CommandForm
          channel={channel}
          entry={command}
          onDone={() => {
            setCommand(null);
            requestAnimationFrame(() => ref.current?.focus());
          }}
          onCancel={() => {
            setCommand(null);
            requestAnimationFrame(() => ref.current?.focus());
          }}
        />
      ) : (
      <div className={`bg-sunken ${replyTo ? "rounded-b-lg" : "rounded-lg"}`}>
        {files.length > 0 && <Attachments files={files} onRemove={(f) => setFiles(files.filter((x) => x !== f))} />}
        <div className="flex items-end gap-1 px-2">
          {canAttach && (
            <>
              <button aria-label="Upload a file" title="Upload a file" onClick={() => fileInput.current?.click()} className="mb-[9px] flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted hover:text-text">
                <PlusCircle size={22} />
              </button>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  addFiles([...(e.target.files ?? [])]);
                  e.target.value = "";
                }}
              />
            </>
          )}
          <textarea
            ref={ref}
            value={text}
            rows={1}
            placeholder={placeholder}
            onChange={(e) => {
              update(e.target.value, e.target.selectionStart);
              setDismissed(null);
              if (e.target.value) client.typing(channel.id);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            onPaste={(e) => {
              const pasted = [...e.clipboardData.files];
              if (pasted.length && canAttach) {
                e.preventDefault();
                addFiles(pasted);
              }
            }}
            className="max-h-[280px] min-h-[44px] flex-1 resize-none bg-transparent px-1.5 py-[11px] text-[15px] leading-[1.375] outline-none placeholder:text-faint"
          />
          {over > -200 && <span className={`mb-3 text-[12px] tabular-nums ${over > 0 ? "text-danger" : "text-faint"}`}>{-over}</span>}
          {!touch && (
            <>
              <button
                aria-label="GIFs"
                title="GIFs"
                onClick={(e) => openExpressions("gif", e)}
                className="mb-[9px] flex h-7 shrink-0 items-center justify-center rounded px-1 text-muted hover:text-text"
              >
                <span className="rounded border-2 border-current px-[3px] text-[10px] font-extrabold leading-[14px]">GIF</span>
              </button>
              <button
                aria-label="Stickers"
                title="Stickers"
                onClick={(e) => openExpressions("sticker", e)}
                className="mb-[9px] flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted hover:text-text"
              >
                <Sticker size={21} />
              </button>
            </>
          )}
          <button
            aria-label="Emoji"
            title="Emoji"
            onClick={(e) => openExpressions("emoji", e)}
            className="mb-[9px] flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted hover:text-text"
          >
            <Smile size={22} />
          </button>
          {touch && (
            <button
              onClick={() => void submit()}
              disabled={(!text.trim() && !files.length) || over > 0}
              aria-label="Send"
              className="mb-[7px] flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent disabled:bg-transparent disabled:text-faint"
            >
              <SendHorizontal size={17} />
            </button>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

function Attachments({ files, onRemove }: { files: File[]; onRemove: (f: File) => void }) {
  const previews = useMemo(() => files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);
  return (
    <div className="flex gap-2.5 overflow-x-auto border-b border-line/70 p-2.5">
      {files.map((f, i) => (
        <div key={`${f.name}-${i}`} className="relative flex w-[150px] shrink-0 flex-col rounded-md bg-surface p-2">
          <div className="flex h-[100px] items-center justify-center overflow-hidden rounded bg-sunken">
            {previews[i] ? <img src={previews[i]!} alt="" className="h-full w-full object-cover" /> : <FileText size={36} strokeWidth={1.4} className="text-muted" />}
          </div>
          <div className="mt-1.5 truncate text-[12.5px]">{f.name}</div>
          <button onClick={() => onRemove(f)} aria-label={`Remove ${f.name}`} className="absolute -right-1.5 -top-1.5 rounded-full border border-line bg-surface p-1 text-danger shadow-sm hover:bg-sunken">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
