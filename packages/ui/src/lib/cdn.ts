import type { Guild, StickerItem, User } from "@minicord/core";

const CDN = "https://cdn.discordapp.com";

/** Discord's CDN rejects arbitrary sizes (400); powers of two from 16 to 4096 are always valid. */
function cdnSize(px: number): number {
  return 2 ** Math.ceil(Math.log2(Math.min(4096, Math.max(16, px))));
}

/** Static avatar (animated avatars are deliberately not animated). */
export function avatarUrl(user: Pick<User, "id" | "avatar" | "discriminator"> | undefined, size = 64): string {
  if (!user) return `${CDN}/embed/avatars/0.png`;
  if (user.avatar?.startsWith("data:")) return user.avatar; // demo mode
  if (user.avatar) return `${CDN}/avatars/${user.id}/${user.avatar}.webp?size=${cdnSize(size)}`;
  const index = user.discriminator && user.discriminator !== "0" ? Number(user.discriminator) % 5 : Number((BigInt(user.id) >> 22n) % 6n);
  return `${CDN}/embed/avatars/${index}.png`;
}

export function guildIconUrl(guild: Pick<Guild, "id" | "icon">, size = 64): string | null {
  if (guild.icon?.startsWith("data:")) return guild.icon; // demo mode
  return guild.icon ? `${CDN}/icons/${guild.id}/${guild.icon}.webp?size=${cdnSize(size)}` : null;
}

export function bannerUrl(userId: string, hash: string, size = 600): string {
  return `${CDN}/banners/${userId}/${hash}.webp?size=${cdnSize(size)}`;
}

export function emojiUrl(id: string, animated = false, size = 48): string {
  return `${CDN}/emojis/${id}.${animated ? "gif" : "webp"}?size=${cdnSize(size)}${animated ? "" : "&quality=lossless"}`;
}

export function stickerUrl(sticker: StickerItem, size = 160): string | null {
  if (sticker.format_type === 3) return null; // Lottie
  return `https://media.discordapp.net/stickers/${sticker.id}.${sticker.format_type === 4 ? "gif" : "png"}?size=${cdnSize(size)}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
