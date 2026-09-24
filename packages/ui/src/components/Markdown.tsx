import { ChannelType } from "@minicord/core";
import { parse } from "discord-markdown-parser";
import { Hash, MessagesSquare, Volume2 } from "lucide-react";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useClient } from "../app/context.tsx";
import { pointFrom } from "../app/overlay.ts";
import { emojiUrl } from "../lib/cdn.ts";
import { formatDiscordTimestamp, formatFull } from "../lib/format.ts";

interface Node {
  type: string;
  content?: Node[] | string;
  [key: string]: unknown;
}

const JUMBO_LIMIT = 27;
const MESSAGE_LINK = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(@me|\d+)\/(\d+)(?:\/(\d+))?\/?$/;
const LIST_LINE = /^( *)([-*]|\d{1,3}\.) +(.*)$/;

/** The server a message belongs to, for nicknames and role colours in mentions. */
const GuildContext = createContext<string | undefined>(undefined);

/** True when a message is only emoji (Discord renders those large). */
function isJumbo(nodes: Node[]): boolean {
  let count = 0;
  for (const n of nodes) {
    if (n.type === "emoji" || n.type === "twemoji") count++;
    else if (n.type === "text" && typeof n.content === "string" && n.content.trim() === "") continue;
    else if (n.type === "br" || n.type === "newline") continue;
    else return false;
  }
  return count > 0 && count <= JUMBO_LIMIT;
}

type Block = { kind: "text"; source: string } | { kind: "list"; ordered: boolean; start: number; items: string[] };

/** Discord's markdown has bullet and numbered lists; the parser doesn't, so split those out first. */
function blocks(content: string): Block[] {
  if (content.includes("```") || !/^( *)([-*]|\d{1,3}\.) +/m.test(content)) return [{ kind: "text", source: content }];
  const out: Block[] = [];
  for (const line of content.split("\n")) {
    const m = LIST_LINE.exec(line);
    const last = out.at(-1);
    if (m) {
      const ordered = m[2] !== "-" && m[2] !== "*";
      if (last?.kind === "list" && last.ordered === ordered) last.items.push(m[3]!);
      else out.push({ kind: "list", ordered, start: ordered ? Number.parseInt(m[2]!, 10) : 1, items: [m[3]!] });
    } else if (last?.kind === "text") {
      last.source += `\n${line}`;
    } else {
      out.push({ kind: "text", source: line });
    }
  }
  return out;
}

function Parsed({ source, allowJumbo }: { source: string; allowJumbo: boolean }) {
  const nodes = useMemo(() => parse(source, "extended") as unknown as Node[], [source]);
  return <Nodes nodes={nodes} jumbo={allowJumbo && isJumbo(nodes)} />;
}

export function Markdown({ content, inline = false, guildId }: { content: string; inline?: boolean; guildId?: string }) {
  const outer = useContext(GuildContext);
  const parts = useMemo(() => blocks(content), [content]);
  const body =
    parts.length === 1 && parts[0]!.kind === "text" ? (
      <Parsed source={content} allowJumbo={!inline} />
    ) : (
      parts.map((b, i) =>
        b.kind === "text" ? (
          <Parsed key={i} source={b.source} allowJumbo={false} />
        ) : b.ordered ? (
          <ol key={i} start={b.start} className="my-0.5 list-decimal pl-6">
            {b.items.map((item, j) => (
              <li key={j}>
                <Parsed source={item} allowJumbo={false} />
              </li>
            ))}
          </ol>
        ) : (
          <ul key={i} className="my-0.5 list-disc pl-6">
            {b.items.map((item, j) => (
              <li key={j}>
                <Parsed source={item} allowJumbo={false} />
              </li>
            ))}
          </ul>
        ),
      )
    );
  return <GuildContext.Provider value={guildId ?? outer}>{body}</GuildContext.Provider>;
}

function Nodes({ nodes, jumbo = false }: { nodes: Node[] | string | undefined; jumbo?: boolean }) {
  if (nodes === undefined) return null;
  if (typeof nodes === "string") return <>{nodes}</>;
  return (
    <>
      {nodes.map((node, i) => (
        <MarkdownNode key={i} node={node} jumbo={jumbo} />
      ))}
    </>
  );
}

function Link({ href, children, title }: { href: string; children: ReactNode; title?: string }) {
  const client = useClient();
  return (
    <a
      href={href}
      title={title ?? href}
      className="text-accent hover:underline"
      onClick={(e) => {
        e.preventDefault();
        client.openLink(href);
      }}
    >
      {children}
    </a>
  );
}

function MessageLink({ href }: { href: string }) {
  const client = useClient();
  const [, , channelId, messageId] = MESSAGE_LINK.exec(href) ?? [];
  const channel = channelId ? client.store.channels.get(channelId) : undefined;
  if (!channel) return <Link href={href}>{href}</Link>;
  const name = channel.guild_id ? channel.name : client.store.channelName(channel);
  return (
    <button onClick={() => client.openLink(href)} className="mention inline-flex items-center gap-0.5 align-baseline">
      {channel.guild_id ? <Hash size={13} className="self-center" /> : "@"}
      {name}
      {messageId && <span className="opacity-70"> › 💬</span>}
    </button>
  );
}

function Spoiler({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span className={`spoiler px-0.5 ${revealed ? "revealed" : ""}`} onClick={() => setRevealed(true)}>
      {children}
    </span>
  );
}

function CustomEmoji({ id, name, animated, jumbo }: { id: string; name: string; animated: boolean; jumbo: boolean }) {
  const [hover, setHover] = useState(false);
  const size = jumbo ? "h-12 w-12" : "h-[1.375em] w-[1.375em]";
  return (
    <img
      src={emojiUrl(id, animated && hover, jumbo ? 96 : 48)}
      alt={`:${name}:`}
      title={`:${name}:`}
      className={`inline-block object-contain align-[-0.3em] ${size}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    />
  );
}

function UserMention({ id }: { id: string }) {
  const client = useClient();
  const guildId = useContext(GuildContext);
  const store = client.store;
  const user = store.users.get(id);
  return (
    <button
      className="mention"
      onClick={(e) => user && client.openOverlay({ kind: "profile", ...pointFrom(e, true), userId: id, ...(guildId ? { guildId } : {}) })}
    >
      @{user ? store.displayName(id, guildId) : "unknown-user"}
    </button>
  );
}

function MarkdownNode({ node, jumbo }: { node: Node; jumbo: boolean }) {
  const client = useClient();
  const store = client.store;
  const kids = <Nodes nodes={node.content} />;

  switch (node.type) {
    case "text":
      return <>{node.content as string}</>;
    case "br":
    case "newline":
      return <br />;
    case "strong":
      return <strong className="font-bold">{kids}</strong>;
    case "em":
      return <em>{kids}</em>;
    case "underline":
      return <u>{kids}</u>;
    case "strikethrough":
      return <s>{kids}</s>;
    case "spoiler":
      return <Spoiler>{kids}</Spoiler>;
    case "inlineCode":
      return <code className="rounded bg-sunken px-1 py-px font-mono text-[0.85em]">{node.content as string}</code>;
    case "codeBlock":
      return (
        <pre className="my-1 max-w-full overflow-x-auto rounded-md border border-line bg-sunken p-2.5 font-mono text-[13px] leading-snug">
          <code>{node.content as string}</code>
        </pre>
      );
    case "blockQuote":
      return <div className="my-0.5 border-l-4 border-line pl-3">{kids}</div>;
    case "heading": {
      const level = Number(node.level ?? 1);
      const cls = level === 1 ? "text-[1.5em] font-bold" : level === 2 ? "text-[1.25em] font-bold" : "text-[1.1em] font-bold";
      return <div className={`my-1 leading-tight ${cls}`}>{kids}</div>;
    }
    case "subtext":
      return <div className="text-[12.5px] text-muted">{kids}</div>;
    case "url":
    case "autolink": {
      const href = String(node.target);
      return MESSAGE_LINK.test(href) ? <MessageLink href={href} /> : <Link href={href}>{kids}</Link>;
    }
    case "link":
      return (
        <Link href={String(node.target)} title={String(node.target)}>
          {kids}
        </Link>
      );
    case "user":
      return <UserMention id={String(node.id)} />;
    case "channel": {
      const channel = store.channels.get(String(node.id));
      const icon =
        channel?.type === ChannelType.GuildVoice || channel?.type === ChannelType.GuildStageVoice ? (
          <Volume2 size={13} className="self-center" />
        ) : channel?.type === ChannelType.PublicThread || channel?.type === ChannelType.GuildForum ? (
          <MessagesSquare size={13} className="self-center" />
        ) : (
          <Hash size={13} className="self-center" />
        );
      return (
        <button
          className="mention inline-flex items-center gap-0.5 align-baseline"
          onClick={() => {
            if (!channel) return;
            if (channel.guild_id) client.navigate({ view: "server", guildId: channel.guild_id, channelId: channel.id });
            else client.navigate({ view: "dms", channelId: channel.id });
          }}
        >
          {icon}
          {channel?.name ?? "unknown"}
        </button>
      );
    }
    case "role": {
      const id = String(node.id);
      for (const guild of store.guilds.values()) {
        const role = guild.roles.find((r) => r.id === id);
        if (!role) continue;
        const value = role.colors?.primary_color ?? role.color ?? 0;
        const color = value ? `#${value.toString(16).padStart(6, "0")}` : undefined;
        return (
          <span className="mention" style={color ? { color, backgroundColor: `${color}26` } : undefined}>
            @{role.name}
          </span>
        );
      }
      return <span className="mention">@deleted-role</span>;
    }
    case "everyone":
      return <span className="mention">@everyone</span>;
    case "here":
      return <span className="mention">@here</span>;
    case "slashCommand":
      return <span className="mention">/{String(node.name ?? node.fullName ?? "command")}</span>;
    case "guildNavigation":
      return <span className="mention">{node.navigation === "browse" ? "Browse Channels" : node.navigation === "customize" ? "Channels & Roles" : "Server Guide"}</span>;
    case "emoji":
      return <CustomEmoji id={String(node.id)} name={String(node.name)} animated={!!node.animated} jumbo={jumbo} />;
    case "twemoji":
      return <span className={jumbo ? "text-[3em] leading-[1.2]" : ""}>{String(node.name)}</span>;
    case "timestamp": {
      const seconds = Number(node.timestamp);
      return (
        <span className="rounded bg-sunken px-1" title={formatFull(seconds * 1000)}>
          {formatDiscordTimestamp(seconds, String(node.format ?? "f"))}
        </span>
      );
    }
    default:
      return typeof node.content === "string" ? <>{node.content}</> : kids;
  }
}
