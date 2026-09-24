import WebSocket from "ws";
import type { SocketFactory } from "./gateway/socket.ts";

/** Gateway transport for Node / Electron main, which (unlike browsers) can send the web client's headers. */
export function nodeSocketFactory(headers: () => Record<string, string>): SocketFactory {
  return (url, h) => {
    const ws = new WebSocket(url, { headers: headers() });
    ws.on("open", () => h.onOpen());
    ws.on("message", (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
      h.onMessage(isBinary ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : buf.toString("utf8"));
    });
    ws.on("close", (code, reason) => h.onClose(code, reason.toString()));
    ws.on("error", (error) => h.onError(error));
    return {
      send: (data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      },
      close: (code, reason) => ws.close(code, reason),
    };
  };
}

/** Headers for the gateway WebSocket handshake, matching what Chrome sends from discord.com. */
export function gatewayHeaders(userAgent: string, locale: string): Record<string, string> {
  return {
    Origin: "https://discord.com",
    "User-Agent": userAgent,
    "Accept-Language": `${locale},${locale.split("-")[0]};q=0.9`,
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };
}
