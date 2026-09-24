import type { FavoriteGif, GifCategory, GifResult, Sticker } from "@minicord/core";
import { ArrowLeft, Search, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useClient } from "../app/context.tsx";
import type { PickedEmoji } from "../app/overlay.ts";
import { stickerUrl } from "../lib/cdn.ts";
import { isTouch } from "../lib/responsive.ts";
import { GuildIcon } from "./Avatar.tsx";
import { EmojiPicker } from "./EmojiPicker.tsx";
import { Spinner } from "./ui.tsx";

type Tab = "gif" | "sticker" | "emoji";

/** A GIF/video tile that stays still until hovered (GIFs don't autoplay here). */
function Clip({ src, still, width, height, onPick, label }: { src: string; still?: string | undefined; width?: number; height?: number; onPick: () => void; label?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const video = /\.(mp4|webm)(\?|$)/i.test(src);
  const ratio = width && height ? height / width : 0.75;
  return (
    <button
      onClick={onPick}
      onMouseEnter={() => void ref.current?.play().catch(() => {})}
      onMouseLeave={() => ref.current?.pause()}
      className="relative mb-1.5 block w-full overflow-hidden rounded-md bg-sunken"
      style={{ aspectRatio: `${1} / ${ratio}` }}
      title={label}
    >
      {video ? (
        <video ref={ref} src={src} poster={still} muted loop playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <img src={still ?? src} alt={label ?? ""} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
      )}
      {label && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/40 px-2 text-center text-[14px] font-semibold capitalize text-white">{label}</span>
      )}
    </button>
  );
}

function GifPicker({ onGif }: { onGif: (url: string) => void }) {
  const client = useClient();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [favorites, setFavorites] = useState<FavoriteGif[] | null>(null);
  const [showFavorites, setShowFavorites] = useState(false);
  const [categories, setCategories] = useState<GifCategory[] | null>(null);
  const [results, setResults] = useState<GifResult[] | null>(null);

  useEffect(() => {
    void client.api.gifTrending().then((t) => setCategories(t.categories ?? []), () => setCategories([]));
    void client.favoriteGifs().then(setFavorites);
  }, [client]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      setSubmitted("");
      return;
    }
    const t = setTimeout(() => {
      setSubmitted(q);
      setResults(null);
      void client.api.gifSearch(q).then(setResults, () => setResults([]));
    }, 350);
    return () => clearTimeout(t);
  }, [client, query]);

  const columns = <T,>(items: T[], render: (item: T) => React.ReactNode) => (
    <div className="grid grid-cols-2 gap-1.5">
      {[0, 1].map((col) => (
        <div key={col}>{items.filter((_, i) => i % 2 === col).map(render)}</div>
      ))}
    </div>
  );

  let body: React.ReactNode;
  if (showFavorites) {
    body = favorites?.length ? (
      columns(favorites, (g) => <Clip key={g.url} src={g.src} width={g.width} height={g.height} onPick={() => onGif(g.url)} />)
    ) : (
      <div className="p-8 text-center text-[13px] text-muted">No favorites yet</div>
    );
  } else if (submitted) {
    body = !results ? <Spinner /> : results.length ? columns(results, (g) => <Clip key={g.id} src={g.src} still={g.preview} width={g.width} height={g.height} onPick={() => onGif(g.url)} />) : (
      <div className="p-8 text-center text-[13px] text-muted">No GIFs found</div>
    );
  } else {
    body = (
      <div className="grid grid-cols-2 gap-1.5">
        {!!favorites?.length && (
          <button onClick={() => setShowFavorites(true)} className="relative mb-1.5 flex aspect-[4/3] items-center justify-center gap-1.5 overflow-hidden rounded-md bg-accent-soft text-[14px] font-semibold text-accent">
            <Star size={16} fill="currentColor" /> Favorites
          </button>
        )}
        {categories === null ? (
          <div className="col-span-2">
            <Spinner />
          </div>
        ) : (
          categories.map((c) => <Clip key={c.name} src={c.src} label={c.name} onPick={() => setQuery(c.name)} />)
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 p-2.5 pb-2">
        {(showFavorites || submitted) && (
          <button
            aria-label="Back"
            onClick={() => {
              setShowFavorites(false);
              setQuery("");
            }}
            className="text-muted hover:text-text"
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <div className="flex flex-1 items-center gap-2 rounded-md bg-sunken px-2.5 py-1.5">
          <Search size={15} className="text-faint" />
          <input
            autoFocus={!isTouch()}
            value={query}
            onChange={(e) => {
              setShowFavorites(false);
              setQuery(e.target.value);
            }}
            placeholder="Search GIFs"
            className="w-full bg-transparent text-[14px] outline-none placeholder:text-faint"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2.5">{body}</div>
    </div>
  );
}

function StickerPicker({ guildId, onSticker }: { guildId?: string; onSticker: (s: Sticker) => void }) {
  const client = useClient();
  const store = client.store;
  const [query, setQuery] = useState("");
  const premium = (store.me?.premium_type ?? 0) > 0;
  const groups = useMemo(() => {
    const current = guildId ? store.guilds.get(guildId) : undefined;
    const guilds = current ? [current, ...store.sortedGuilds().filter((g) => g.id !== current.id)] : store.sortedGuilds();
    return guilds
      .filter((g) => premium || g.id === guildId)
      .map((g) => ({ guild: g, stickers: (g.stickers ?? []).filter((s) => s.available !== false && s.format_type !== 3) }))
      .filter((g) => g.stickers.length);
  }, [store, guildId, premium]);
  const q = query.trim().toLowerCase();
  const visible = groups
    .map((g) => ({ ...g, stickers: q ? g.stickers.filter((s) => `${s.name} ${s.tags ?? ""}`.toLowerCase().includes(q)) : g.stickers }))
    .filter((g) => g.stickers.length);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="p-2.5 pb-2">
        <div className="flex items-center gap-2 rounded-md bg-sunken px-2.5 py-1.5">
          <Search size={15} className="text-faint" />
          <input
            autoFocus={!isTouch()}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find stickers"
            className="w-full bg-transparent text-[14px] outline-none placeholder:text-faint"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2.5">
        {visible.map((g) => (
          <section key={g.guild.id}>
            <div className="flex items-center gap-2 px-1 pb-1.5 pt-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">
              <GuildIcon guild={g.guild} size={16} /> {g.guild.name}
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
              {g.stickers.map((s) => {
                const url = stickerUrl(s, 160);
                return (
                  <button key={s.id} title={s.name} onClick={() => onSticker(s)} className="flex aspect-square items-center justify-center rounded-md p-1 hover:bg-sunken">
                    {url && <img src={url} alt={s.name} loading="lazy" className="max-h-full max-w-full object-contain" />}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        {!visible.length && <div className="p-8 text-center text-[13px] text-muted">{q ? "No stickers found" : "No stickers here"}</div>}
      </div>
    </div>
  );
}

/** Discord's expression picker for the composer: GIFs, Stickers, Emoji. */
export function ExpressionPicker({
  tab: initial,
  guildId,
  onEmoji,
  onGif,
  onSticker,
}: {
  tab: Tab;
  guildId?: string;
  onEmoji: (e: PickedEmoji) => void;
  onGif: (url: string) => void;
  onSticker: (s: Sticker) => void;
}) {
  const [tab, setTab] = useState<Tab>(initial);
  const tabs: { id: Tab; label: string }[] = [
    { id: "gif", label: "GIFs" },
    { id: "sticker", label: "Stickers" },
    { id: "emoji", label: "Emoji" },
  ];
  return (
    <div className="flex h-[460px] max-h-[75vh] w-full flex-col overflow-hidden bg-surface sm:w-[400px] sm:rounded-xl sm:border sm:border-line sm:shadow-xl">
      <div className="flex gap-1 px-2.5 pt-2.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-md px-2.5 py-1 text-[14px] font-medium ${tab === t.id ? "bg-sunken text-text" : "text-muted hover:text-text"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "gif" && <GifPicker onGif={onGif} />}
      {tab === "sticker" && <StickerPicker {...(guildId ? { guildId } : {})} onSticker={onSticker} />}
      {tab === "emoji" && <EmojiPicker {...(guildId ? { guildId } : {})} onPick={onEmoji} embedded />}
    </div>
  );
}
