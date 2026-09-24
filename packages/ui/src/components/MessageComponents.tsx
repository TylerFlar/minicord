import type { ButtonComponent, Component, Emoji, Message, SelectComponent } from "@minicord/core";
import { ExternalLink, FileText } from "lucide-react";
import { useState } from "react";
import { useClient, useSignals } from "../app/context.tsx";
import { emojiUrl } from "../lib/cdn.ts";
import { Markdown } from "./Markdown.tsx";

const BUTTON_STYLES: Record<number, string> = {
  1: "bg-accent text-on-accent hover:opacity-90",
  2: "bg-sunken text-text hover:bg-line",
  3: "bg-[var(--mc-online)] text-white hover:opacity-90",
  4: "bg-danger text-white hover:opacity-90",
  5: "bg-sunken text-text hover:bg-line",
  6: "bg-sunken text-muted",
};

function EmojiGlyph({ emoji }: { emoji: Emoji | undefined }) {
  if (!emoji) return null;
  return emoji.id ? <img src={emojiUrl(emoji.id, false, 32)} alt={emoji.name ?? ""} className="h-[18px] w-[18px] object-contain" /> : <span>{emoji.name}</span>;
}

function BotButton({ button, message }: { button: ButtonComponent; message: Message }) {
  const client = useClient();
  const pending = !!button.custom_id && client.pendingComponents.has(`${message.id}:${button.custom_id}`);
  return (
    <button
      disabled={button.disabled || pending || button.style === 6}
      onClick={() => client.pressButton(message, button)}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[14px] font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_STYLES[button.style] ?? BUTTON_STYLES[2]}`}
    >
      <EmojiGlyph emoji={button.emoji} />
      {button.label}
      {button.style === 5 && <ExternalLink size={13} className="opacity-70" />}
      {pending && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
    </button>
  );
}

function BotSelect({ select, message }: { select: SelectComponent; message: Message }) {
  const client = useClient();
  const store = client.store;
  const guildId = message.guild_id ?? store.channels.get(message.channel_id)?.guild_id;
  const multi = (select.max_values ?? 1) > 1;
  const [chosen, setChosen] = useState<string[]>(() => (select.options ?? []).filter((o) => o.default).map((o) => o.value));
  const pending = client.pendingComponents.has(`${message.id}:${select.custom_id}`);
  // User/role/channel menus pick from what this client already knows.
  const options =
    select.type === 3
      ? (select.options ?? []).map((o) => ({ value: o.value, label: o.label, description: o.description }))
      : select.type === 6
        ? (store.guilds.get(guildId ?? "")?.roles ?? []).filter((r) => r.id !== guildId).map((r) => ({ value: r.id, label: `@${r.name}`, description: undefined }))
        : select.type === 8
          ? (guildId ? store.guildChannelGroups(guildId).flatMap((g) => g.channels) : []).map((c) => ({ value: c.id, label: `#${c.name}`, description: undefined }))
          : [...(store.memberCache.get(guildId ?? "")?.keys() ?? [])].map((id) => ({ value: id, label: store.displayName(id, guildId), description: undefined }));
  const cls = "w-full max-w-[400px] rounded-md border border-line bg-surface px-3 py-2 text-[14px] outline-none disabled:opacity-50";
  if (!multi) {
    return (
      <select
        disabled={select.disabled || pending}
        value=""
        onChange={(e) => e.target.value && client.chooseOptions(message, select, [e.target.value])}
        className={cls}
      >
        <option value="">{select.placeholder ?? "Make a selection"}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
            {o.description ? ` — ${o.description}` : ""}
          </option>
        ))}
      </select>
    );
  }
  return (
    <div className="flex max-w-[400px] flex-col gap-1.5">
      <select multiple disabled={select.disabled || pending} value={chosen} onChange={(e) => setChosen([...e.target.selectedOptions].map((o) => o.value))} className={`${cls} h-28`}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        disabled={select.disabled || pending || chosen.length < (select.min_values ?? 1)}
        onClick={() => client.chooseOptions(message, select, chosen)}
        className="self-start rounded-md bg-accent px-3 py-1 text-[13.5px] font-medium text-on-accent disabled:opacity-50"
      >
        {select.placeholder ? "Apply" : "Choose"}
      </button>
    </div>
  );
}

function ComponentView({ c, message, guildId }: { c: Component; message: Message; guildId: string | undefined }) {
  const client = useClient();
  const view = (url: string) => client.openOverlay({ kind: "media", url, media: "image", original: url });
  const children = (list: Component[]) => list.map((x, i) => <ComponentView key={i} c={x} message={message} guildId={guildId} />);
  switch (c.type) {
    case 1:
      return <div className="flex flex-wrap gap-1.5">{children(c.components)}</div>;
    case 2:
      return <BotButton button={c} message={message} />;
    case 3:
    case 5:
    case 6:
    case 7:
    case 8:
      return <BotSelect select={c} message={message} />;
    case 9:
      return (
        <div className="flex gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">{children(c.components)}</div>
          {c.accessory && <ComponentView c={c.accessory} message={message} guildId={guildId} />}
        </div>
      );
    case 10:
      return (
        <div className="whitespace-pre-wrap break-words text-[15px] leading-[1.375]">
          <Markdown content={c.content} {...(guildId ? { guildId } : {})} />
        </div>
      );
    case 11:
      return <img src={c.media.proxy_url ?? c.media.url} alt={c.description ?? ""} className="h-20 w-20 shrink-0 cursor-zoom-in rounded-md object-cover" loading="lazy" onClick={() => view(c.media.url)} />;
    case 12:
      return (
        <div className={`grid gap-1 ${c.items.length > 1 ? "grid-cols-2" : ""}`}>
          {c.items.map((item, i) => (
            <img
              key={i}
              src={item.media.proxy_url ?? item.media.url}
              alt={item.description ?? ""}
              loading="lazy"
              onClick={() => view(item.media.url)}
              className={`w-full cursor-zoom-in rounded-md object-cover ${c.items.length > 1 ? "aspect-square" : "max-h-[320px]"} ${item.spoiler ? "blur-xl" : ""}`}
            />
          ))}
        </div>
      );
    case 13:
      return (
        <button onClick={() => client.platform.shell.openExternal(c.file.url)} className="flex items-center gap-2 rounded-lg border border-line bg-sunken/50 p-2.5 text-left text-[14px] text-accent hover:underline">
          <FileText size={22} className="text-muted" /> {c.name ?? c.file.url.split("/").pop()?.split("?")[0]}
        </button>
      );
    case 14:
      return c.divider === false ? <div className={c.spacing === 2 ? "h-4" : "h-2"} /> : <div className={`h-px bg-line ${c.spacing === 2 ? "my-3" : "my-1"}`} />;
    case 17: {
      const accent = c.accent_color ? `#${c.accent_color.toString(16).padStart(6, "0")}` : "var(--mc-line)";
      return (
        <div className="flex flex-col gap-2 rounded-lg border-l-4 bg-sunken/70 p-3" style={{ borderLeftColor: accent }}>
          {children(c.components)}
        </div>
      );
    }
    default:
      return null;
  }
}

/** Bot buttons, menus and the newer layout components under a message. */
export function MessageComponents({ message, guildId }: { message: Message; guildId: string | undefined }) {
  useSignals(["interactions"]);
  return (
    <div className="mt-1 flex max-w-[600px] flex-col gap-1.5">
      {message.components!.map((c, i) => (
        <ComponentView key={i} c={c} message={message} guildId={guildId} />
      ))}
    </div>
  );
}
