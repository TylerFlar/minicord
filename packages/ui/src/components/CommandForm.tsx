import { ChannelType, type Channel, type CommandOption } from "@minicord/core";
import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CommandEntry, OptionValue } from "../app/client.ts";
import { useClient, useStore } from "../app/context.tsx";
import { isTouch } from "../lib/responsive.ts";
import { Button } from "./ui.tsx";

const CDN = "https://cdn.discordapp.com";

export function appIconUrl(app: { id: string; icon?: string | null } | undefined): string | null {
  return app?.icon ? `${CDN}/app-icons/${app.id}/${app.icon}.webp?size=64` : null;
}

interface Pick {
  id: string;
  label: string;
  sub?: string;
}

/** A text box that suggests from a list (users, roles, channels, autocomplete answers). */
function PickList({ items, value, onChange, placeholder, onQuery }: { items: Pick[]; value: string; onChange: (id: string) => void; placeholder?: string; onQuery?: (q: string) => void }) {
  const selected = items.find((i) => i.id === value);
  const [text, setText] = useState(selected?.label ?? "");
  const [open, setOpen] = useState(false);
  const q = text.trim().toLowerCase();
  const shown = (q && q !== selected?.label.toLowerCase() ? items.filter((i) => i.label.toLowerCase().includes(q) || i.sub?.toLowerCase().includes(q)) : items).slice(0, 8);
  return (
    <div className="relative">
      <input
        value={text}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          onQuery?.(e.target.value);
          if (!e.target.value) onChange("");
        }}
        className="w-full rounded-md bg-surface px-2.5 py-1.5 text-[14px] outline-none focus:ring-2 focus:ring-accent/40"
      />
      {open && shown.length > 0 && (
        <div className="absolute inset-x-0 bottom-full z-20 mb-1 max-h-60 overflow-y-auto rounded-md border border-line bg-surface py-1 shadow-lg">
          {shown.map((i) => (
            <button
              key={i.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(i.id);
                setText(i.label);
                setOpen(false);
              }}
              className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-[14px] hover:bg-sunken"
            >
              <span className="truncate">{i.label}</span>
              {i.sub && <span className="truncate text-[12px] text-muted">{i.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function OptionInput({
  channel,
  entry,
  option,
  values,
  onValue,
  onFile,
}: {
  channel: Channel;
  entry: CommandEntry;
  option: CommandOption;
  values: Record<string, OptionValue>;
  onValue: (v: OptionValue | undefined) => void;
  onFile: (f: File | undefined) => void;
}) {
  const client = useClient();
  const store = useStore(["members"]);
  const [suggested, setSuggested] = useState<{ name: string; value: string | number }[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const input = "w-full rounded-md bg-surface px-2.5 py-1.5 text-[14px] outline-none focus:ring-2 focus:ring-accent/40";
  const value = values[option.name];
  const guildId = channel.guild_id;

  const users = useMemo<Pick[]>(() => {
    const pool = guildId ? [...(store.memberCache.get(guildId)?.keys() ?? [])] : (channel.recipient_ids ?? []);
    return pool
      .map((id) => ({ id, label: store.displayName(id, guildId), sub: store.users.get(id)?.username ?? "" }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [store, guildId, channel]);
  const roles = useMemo<Pick[]>(
    () => (guildId ? (store.guilds.get(guildId)?.roles ?? []).filter((r) => r.id !== guildId).map((r) => ({ id: r.id, label: `@${r.name}` })) : []),
    [store, guildId],
  );

  if (option.choices?.length) {
    return (
      <select value={value === undefined ? "" : String(value)} onChange={(e) => onValue(option.choices!.find((c) => String(c.value) === e.target.value)?.value)} className={input}>
        <option value="">Choose…</option>
        {option.choices.map((c) => (
          <option key={String(c.value)} value={String(c.value)}>
            {c.name}
          </option>
        ))}
      </select>
    );
  }
  switch (option.type) {
    case 3:
      if (option.autocomplete) {
        return (
          <PickList
            items={suggested.map((c) => ({ id: String(c.value), label: c.name }))}
            value={value === undefined ? "" : String(value)}
            onChange={(id) => onValue(id || undefined)}
            onQuery={(q) => {
              onValue(q || undefined);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => void client.autocomplete(channel, entry, { ...values, [option.name]: q }, option.name).then(setSuggested), 300);
            }}
          />
        );
      }
      return <input value={value === undefined ? "" : String(value)} minLength={option.min_length} maxLength={option.max_length} onChange={(e) => onValue(e.target.value || undefined)} className={input} />;
    case 4:
    case 10:
      return (
        <input
          type="number"
          step={option.type === 4 ? 1 : "any"}
          min={option.min_value}
          max={option.max_value}
          value={value === undefined ? "" : String(value)}
          onChange={(e) => onValue(e.target.value === "" ? undefined : Number(e.target.value))}
          className={input}
        />
      );
    case 5:
      return (
        <select value={value === undefined ? "" : String(value)} onChange={(e) => onValue(e.target.value === "" ? undefined : e.target.value === "true")} className={input}>
          <option value="">Choose…</option>
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      );
    case 6:
      return <PickList items={users} value={String(value ?? "")} onChange={(id) => onValue(id || undefined)} onQuery={(q) => guildId && q && client.searchMembers(guildId, q)} />;
    case 7: {
      const channels = guildId
        ? store
            .guildChannelGroups(guildId)
            .flatMap((g) => g.channels)
            .filter((c) => !option.channel_types?.length || option.channel_types.includes(c.type))
        : [];
      return (
        <select value={String(value ?? "")} onChange={(e) => onValue(e.target.value || undefined)} className={input}>
          <option value="">Choose…</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.type === ChannelType.GuildVoice ? "🔊 " : "#"}
              {c.name}
            </option>
          ))}
        </select>
      );
    }
    case 8:
      return <PickList items={roles} value={String(value ?? "")} onChange={(id) => onValue(id || undefined)} />;
    case 9:
      return <PickList items={[...users, ...roles]} value={String(value ?? "")} onChange={(id) => onValue(id || undefined)} />;
    case 11:
      return <input type="file" onChange={(e) => onFile(e.target.files?.[0])} className="w-full text-[13px]" />;
    default:
      return <input value={String(value ?? "")} onChange={(e) => onValue(e.target.value || undefined)} className={input} />;
  }
}

/** The form for a chosen slash command: one field per option, then Send runs it as an interaction. */
export function CommandForm({ channel, entry, onDone, onCancel }: { channel: Channel; entry: CommandEntry; onDone: () => void; onCancel: () => void }) {
  const client = useClient();
  const [values, setValues] = useState<Record<string, OptionValue>>({});
  const [files, setFiles] = useState<Record<string, File>>({});
  const [busy, setBusy] = useState(false);
  const options = entry.options ?? [];
  const missing = options.some((o) => o.required && (o.type === 11 ? !files[o.name] : values[o.name] === undefined || values[o.name] === ""));
  const icon = appIconUrl(entry.app);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!isTouch()) form.current?.querySelector<HTMLElement>("input, select")?.focus();
  }, [entry]);

  const run = async () => {
    if (missing || busy) return;
    setBusy(true);
    const ok = await client.runCommand(channel, entry, values, files);
    setBusy(false);
    if (ok) onDone();
  };

  return (
    <form
      ref={form}
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      className="rounded-lg bg-sunken p-3"
    >
      <div className="flex items-center gap-2">
        {icon ? <img src={icon} alt="" className="h-6 w-6 rounded-full" /> : <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[12px] font-bold text-on-accent">/</span>}
        <span className="shrink-0 text-[14.5px] font-semibold">/{[entry.command.name, ...entry.path].join(" ")}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{entry.description}</span>
        <button type="button" aria-label="Cancel" onClick={onCancel} className="shrink-0 text-muted hover:text-text">
          <X size={16} />
        </button>
      </div>
      {options.length > 0 && (
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {options.map((o) => (
            <label key={o.name} className="block">
              <span className="mb-1 block text-[12px] font-medium text-muted">
                {o.name}
                {!o.required && <span className="text-faint"> · optional</span>}
              </span>
              <OptionInput
                channel={channel}
                entry={entry}
                option={o}
                values={values}
                onValue={(v) =>
                  setValues((prev) => {
                    const next = { ...prev };
                    if (v === undefined) delete next[o.name];
                    else next[o.name] = v;
                    return next;
                  })
                }
                onFile={(f) =>
                  setFiles((prev) => {
                    const next = { ...prev };
                    if (f) next[o.name] = f;
                    else delete next[o.name];
                    return next;
                  })
                }
              />
            </label>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center justify-end gap-2">
        {entry.app && <span className="mr-auto text-[12px] text-faint">{entry.app.name}</span>}
        <Button type="submit" tone="accent" size="sm" disabled={missing || busy}>
          {busy ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}
