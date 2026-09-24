import { Clock, Search } from "lucide-react";
import { useMemo, useRef, useState, type MouseEvent } from "react";
import { useClient } from "../app/context.tsx";
import { parseEmojiText, type PickedEmoji } from "../app/overlay.ts";
import { emojiUrl } from "../lib/cdn.ts";
import { customEmojiText, EMOJI_GROUPS, searchEmoji, useEmojiData, usableCustomEmoji } from "../lib/emoji.ts";
import { isTouch } from "../lib/responsive.ts";
import { GuildIcon } from "./Avatar.tsx";

interface Cell {
  key: string;
  label: string;
  picked: PickedEmoji;
}

interface Section {
  id: string;
  label: string;
  icon: React.ReactNode;
  cells: Cell[];
}

const unicodeCell = (emoji: string, name: string): Cell => ({ key: emoji, label: name, picked: { id: null, name: emoji, text: emoji } });

function CellView({ cell }: { cell: Cell }) {
  const { picked } = cell;
  return picked.id ? (
    <img src={emojiUrl(picked.id, !!picked.animated, 48)} alt={cell.label} className="h-7 w-7 object-contain" loading="lazy" />
  ) : (
    <span className="text-[26px] leading-none">{picked.text}</span>
  );
}

/** Discord-style picker: search, recents, this server's emoji (and more with Nitro), then Unicode categories. */
export function EmojiPicker({ guildId, onPick, embedded = false }: { guildId?: string; onPick: (emoji: PickedEmoji) => void; embedded?: boolean }) {
  const client = useClient();
  const store = client.store;
  const data = useEmojiData();
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<Cell | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const custom = useMemo(() => usableCustomEmoji(store, guildId), [store, guildId]);

  const cellsByKey = useRef(new Map<string, Cell>());
  const sections = useMemo<Section[]>(() => {
    const out: Section[] = [];
    const recent = client.recentEmoji.map((text) => {
      const picked = parseEmojiText(text);
      const label = picked.id ? picked.name : (data?.byEmoji.get(text.replace(/️/g, ""))?.names[0] ?? "");
      return { key: `r:${text}`, label, picked };
    });
    if (recent.length) out.push({ id: "recent", label: "Frequently used", icon: <Clock size={18} />, cells: recent });
    for (const g of custom) {
      out.push({
        id: `g:${g.guild.id}`,
        label: g.guild.name,
        icon: <GuildIcon guild={g.guild} size={20} />,
        cells: g.emojis.map((e) => ({ key: e.id, label: e.name, picked: { id: e.id, name: e.name, animated: !!e.animated, text: customEmojiText(e) } })),
      });
    }
    if (data) {
      for (const group of EMOJI_GROUPS) {
        out.push({
          id: `u:${group.id}`,
          label: group.label,
          icon: <span className="text-[18px] leading-none">{group.icon}</span>,
          cells: data.list.filter((e) => e.group === group.id).map((e) => unicodeCell(e.emoji, e.names[0]!)),
        });
      }
    }
    return out;
  }, [client.recentEmoji, custom, data]);

  const results = useMemo<Cell[] | null>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const customHits = custom.flatMap((g) =>
      g.emojis
        .filter((e) => e.name.toLowerCase().includes(q))
        .map((e) => ({ key: e.id, label: e.name, picked: { id: e.id, name: e.name, animated: !!e.animated, text: customEmojiText(e) } })),
    );
    const unicode = data ? searchEmoji(data, q, 120).map((e) => unicodeCell(e.emoji, e.names[0]!)) : [];
    return [...customHits, ...unicode];
  }, [query, custom, data]);

  cellsByKey.current = new Map((results ?? sections.flatMap((s) => s.cells)).map((c) => [c.key, c]));
  const cellFrom = (e: MouseEvent) => {
    const key = (e.target as HTMLElement).closest<HTMLElement>("[data-cell]")?.dataset.cell;
    return key ? cellsByKey.current.get(key) : undefined;
  };
  const pick = (cell: Cell) => {
    client.useEmoji(cell.picked.text);
    onPick(cell.picked);
  };

  const grid = (cells: Cell[]) => (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(40px,1fr))]">
      {cells.map((c) => (
        <button key={c.key} data-cell={c.key} title={`:${c.label}:`} className="flex h-10 items-center justify-center rounded-md hover:bg-sunken">
          <CellView cell={c} />
        </button>
      ))}
    </div>
  );

  return (
    <div
      className={`flex w-full flex-col overflow-hidden bg-surface ${
        embedded ? "min-h-0 flex-1" : "h-[440px] max-h-[70vh] sm:w-[372px] sm:rounded-xl sm:border sm:border-line sm:shadow-xl"
      }`}
    >
      <div className="p-2.5 pb-1.5">
        <div className="flex items-center gap-2 rounded-md bg-sunken px-2.5 py-1.5">
          <Search size={15} className="text-faint" />
          <input
            autoFocus={!isTouch()}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results?.[0]) pick(results[0]);
            }}
            placeholder="Find the perfect emoji"
            className="w-full bg-transparent text-[14px] outline-none placeholder:text-faint"
          />
        </div>
      </div>
      {!results && (
        <div className="flex gap-0.5 overflow-x-auto border-b border-line px-2 pb-1.5">
          {sections.map((s) => (
            <button
              key={s.id}
              title={s.label}
              onClick={() => document.getElementById(`emoji-${s.id}`)?.scrollIntoView({ block: "start" })}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-sunken hover:text-text"
            >
              {s.icon}
            </button>
          ))}
        </div>
      )}
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
        onClick={(e) => {
          const cell = cellFrom(e);
          if (cell) pick(cell);
        }}
        onMouseOver={(e) => setHover(cellFrom(e) ?? null)}
      >
        {results ? (
          results.length ? (
            <div className="pt-2">{grid(results)}</div>
          ) : (
            <div className="p-8 text-center text-[13px] text-muted">No emoji found</div>
          )
        ) : (
          sections.map((s) => (
            <section key={s.id} id={`emoji-${s.id}`} className="[content-visibility:auto]">
              <div className="sticky top-0 z-10 bg-surface px-1 pb-1 pt-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{s.label}</div>
              {grid(s.cells)}
            </section>
          ))
        )}
        {!data && !results && <div className="p-6 text-center text-[13px] text-muted">Loading…</div>}
      </div>
      {!isTouch() && (
        <div className="flex h-11 items-center gap-2 border-t border-line bg-bg px-3 text-[13px]">
          {hover ? (
            <>
              <CellView cell={hover} />
              <span className="truncate font-medium">:{hover.label}:</span>
            </>
          ) : (
            <span className="text-faint">&nbsp;</span>
          )}
        </div>
      )}
    </div>
  );
}
