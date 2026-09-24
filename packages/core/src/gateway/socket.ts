/** Transport abstraction so the gateway runs on `ws` (Node/Electron main), browser WebSocket, or a native bridge. */
export interface SocketHandlers {
  onOpen(): void;
  onMessage(data: string | Uint8Array): void;
  onClose(code: number, reason: string): void;
  onError(error: unknown): void;
}

export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type SocketFactory = (url: string, handlers: SocketHandlers) => SocketLike;

/** Uses the standard WebSocket API (browsers, Android WebView, Node >= 22). Can't set custom headers. */
export const browserSocketFactory: SocketFactory = (url, h) => {
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => h.onOpen();
  ws.onmessage = (e) => h.onMessage(typeof e.data === "string" ? e.data : new Uint8Array(e.data as ArrayBuffer));
  ws.onclose = (e) => h.onClose(e.code, e.reason);
  ws.onerror = (e) => h.onError(e);
  return {
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
  };
};
