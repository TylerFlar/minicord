/** Just enough protobuf to read Discord's PreloadedUserSettings (guild folders give the user's server order). */

interface Field {
  no: number;
  wire: number;
  value: bigint | Uint8Array;
}

function* fields(buf: Uint8Array): Generator<Field> {
  let i = 0;
  const varint = (): bigint => {
    let result = 0n;
    let shift = 0n;
    while (i < buf.length) {
      const b = buf[i++]!;
      result |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return result;
      shift += 7n;
    }
    throw new Error("truncated varint");
  };
  while (i < buf.length) {
    const key = Number(varint());
    const no = key >>> 3;
    const wire = key & 7;
    if (wire === 0) {
      yield { no, wire, value: varint() };
    } else if (wire === 1) {
      yield { no, wire, value: buf.subarray(i, i + 8) };
      i += 8;
    } else if (wire === 2) {
      const len = Number(varint());
      yield { no, wire, value: buf.subarray(i, i + len) };
      i += len;
    } else if (wire === 5) {
      yield { no, wire, value: buf.subarray(i, i + 4) };
      i += 4;
    } else {
      throw new Error(`unsupported wire type ${wire}`);
    }
  }
}

function fixed64(bytes: Uint8Array, offset = 0): bigint {
  let v = 0n;
  for (let k = 7; k >= 0; k--) v = (v << 8n) | BigInt(bytes[offset + k]!);
  return v;
}

/** Repeated fixed64, packed or not. */
function fixed64s(f: Field): string[] {
  if (f.wire === 1) return [fixed64(f.value as Uint8Array).toString()];
  if (f.wire !== 2) return [];
  const b = f.value as Uint8Array;
  const out: string[] = [];
  for (let o = 0; o + 8 <= b.length; o += 8) out.push(fixed64(b, o).toString());
  return out;
}

export interface GuildFolder {
  id?: string;
  name?: string;
  color?: number;
  guildIds: string[];
}

function decodeFolder(buf: Uint8Array): GuildFolder {
  const folder: GuildFolder = { guildIds: [] };
  for (const f of fields(buf)) {
    if (f.no === 1) {
      folder.guildIds.push(...fixed64s(f));
    } else if (f.wire === 2 && f.no >= 2 && f.no <= 4) {
      // google.protobuf wrapper messages: { 1: value }
      for (const w of fields(f.value as Uint8Array)) {
        if (w.no !== 1) continue;
        if (f.no === 2 && w.wire === 0) folder.id = (w.value as bigint).toString();
        else if (f.no === 3 && w.wire === 2) folder.name = new TextDecoder().decode(w.value as Uint8Array);
        else if (f.no === 4 && w.wire === 0) folder.color = Number(w.value as bigint);
      }
    }
  }
  return folder;
}

const GUILD_FOLDERS_FIELD = 14;
const STATUS_FIELD = 11;
const FAVORITE_GIFS_FIELD = 2;
const text = (b: Uint8Array) => new TextDecoder().decode(b);

function fromBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/** The value inside a google.protobuf wrapper message ({ 1: value }). */
function wrapped(buf: Uint8Array): Field | undefined {
  for (const f of fields(buf)) if (f.no === 1) return f;
  return undefined;
}

export interface CustomStatus {
  text?: string;
  emojiName?: string;
  emojiId?: string;
  expiresAtMs?: number;
}

export interface StatusSetting {
  /** "online" | "idle" | "dnd" | "invisible" */
  status?: string;
  customStatus?: CustomStatus;
}

export interface UserSettings {
  /** null when the blob has no folder field (partial updates). */
  guildFolders: GuildFolder[] | null;
  status: StatusSetting | null;
}

function decodeStatus(buf: Uint8Array): StatusSetting {
  const out: StatusSetting = {};
  for (const f of fields(buf)) {
    if (f.wire !== 2) continue;
    if (f.no === 1) {
      const v = wrapped(f.value as Uint8Array);
      if (v?.wire === 2) out.status = text(v.value as Uint8Array);
    } else if (f.no === 2) {
      const custom: CustomStatus = {};
      for (const c of fields(f.value as Uint8Array)) {
        if (c.no === 1 && c.wire === 2) custom.text = text(c.value as Uint8Array);
        else if (c.no === 2 && c.wire === 1) custom.emojiId = fixed64(c.value as Uint8Array).toString();
        else if (c.no === 3 && c.wire === 2) custom.emojiName = text(c.value as Uint8Array);
        else if (c.no === 4 && c.wire === 1) custom.expiresAtMs = Number(fixed64(c.value as Uint8Array));
      }
      out.customStatus = custom;
    }
  }
  return out;
}

/** The parts of a base64 PreloadedUserSettings blob minicord uses; fields missing from the blob come back null. */
export function decodeUserSettings(base64: string): UserSettings {
  const out: UserSettings = { guildFolders: null, status: null };
  try {
    for (const f of fields(fromBase64(base64))) {
      if (f.wire !== 2) continue;
      if (f.no === GUILD_FOLDERS_FIELD) {
        const folders: GuildFolder[] = [];
        for (const g of fields(f.value as Uint8Array)) if (g.no === 1 && g.wire === 2) folders.push(decodeFolder(g.value as Uint8Array));
        out.guildFolders = folders;
      } else if (f.no === STATUS_FIELD) {
        out.status = decodeStatus(f.value as Uint8Array);
      }
    }
  } catch {
    // unreadable blob: keep what we have
  }
  return out;
}

/** Guild folders from a base64 PreloadedUserSettings blob; null when absent (partial updates) or unreadable. */
export function decodeGuildFolders(base64: string): GuildFolder[] | null {
  return decodeUserSettings(base64).guildFolders;
}

// ---- writing ------------------------------------------------------------------

function varintBytes(n: number): number[] {
  const out: number[] = [];
  let v = n >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return out;
}

function lengthDelimited(no: number, payload: number[]): number[] {
  return [...varintBytes((no << 3) | 2), ...varintBytes(payload.length), ...payload];
}

/** A partial PreloadedUserSettings that only sets the status (for PATCH /users/@me/settings-proto/1). */
export function encodeStatusSettings(status: string): string {
  const value = [...new TextEncoder().encode(status)];
  const bytes = lengthDelimited(STATUS_FIELD, lengthDelimited(1, lengthDelimited(1, value)));
  return btoa(String.fromCharCode(...bytes));
}

export interface FavoriteGif {
  /** What gets sent in a message (usually the Tenor page URL). */
  url: string;
  /** What to show (an mp4 or gif). */
  src: string;
  width: number;
  height: number;
  video: boolean;
  order: number;
}

/** Favorite GIFs from a base64 FrecencyUserSettings blob (settings-proto type 2), newest first. */
export function decodeFavoriteGifs(base64: string): FavoriteGif[] {
  const out: FavoriteGif[] = [];
  try {
    for (const f of fields(fromBase64(base64))) {
      if (f.no !== FAVORITE_GIFS_FIELD || f.wire !== 2) continue;
      for (const entry of fields(f.value as Uint8Array)) {
        if (entry.no !== 1 || entry.wire !== 2) continue;
        const gif: FavoriteGif = { url: "", src: "", width: 0, height: 0, video: false, order: 0 };
        for (const kv of fields(entry.value as Uint8Array)) {
          if (kv.no === 1 && kv.wire === 2) gif.url = text(kv.value as Uint8Array);
          else if (kv.no === 2 && kv.wire === 2) {
            for (const g of fields(kv.value as Uint8Array)) {
              if (g.no === 1 && g.wire === 0) gif.video = Number(g.value) === 2;
              else if (g.no === 2 && g.wire === 2) gif.src = text(g.value as Uint8Array);
              else if (g.no === 3 && g.wire === 0) gif.width = Number(g.value);
              else if (g.no === 4 && g.wire === 0) gif.height = Number(g.value);
              else if (g.no === 5 && g.wire === 0) gif.order = Number(g.value);
            }
          }
        }
        if (gif.url) out.push({ ...gif, src: gif.src || gif.url });
      }
    }
  } catch {
    // ignore unreadable data
  }
  return out.sort((a, b) => b.order - a.order);
}
