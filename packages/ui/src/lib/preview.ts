import type { Message, Store } from "@minicord/core";

/** Plain-text preview of a message for notifications and inbox rows. */
export function messagePreview(msg: Message, store: Store, max = 140): string {
  let text = (msg.content ?? "")
    .replace(/<@!?(\d+)>/g, (_, id: string) => `@${store.userName(store.users.get(id))}`)
    .replace(/<@&(\d+)>/g, (_, id: string) => {
      for (const g of store.guilds.values()) {
        const role = g.roles.find((r) => r.id === id);
        if (role) return `@${role.name}`;
      }
      return "@role";
    })
    .replace(/<#(\d+)>/g, (_, id: string) => `#${store.channels.get(id)?.name ?? "channel"}`)
    .replace(/<a?:(\w+):\d+>/g, ":$1:")
    .replace(/<t:(\d+)(?::\w)?>/g, (_, s: string) => new Date(Number(s) * 1000).toLocaleString())
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/(\*\*|__|~~|\|\||`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    if (msg.attachments?.length) text = msg.attachments.length === 1 ? `📎 ${msg.attachments[0]!.filename}` : `📎 ${msg.attachments.length} attachments`;
    else if (msg.sticker_items?.length) text = `[sticker: ${msg.sticker_items[0]!.name}]`;
    else if (msg.embeds?.length) text = msg.embeds[0]!.title ?? "[embed]";
    else text = "…";
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
