export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string | Uint8Array;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
}

/** Platform-provided HTTP. On desktop this runs in the Electron main process; on Android, natively. */
export type HttpFn = (req: HttpRequest) => Promise<HttpResponse>;

/** HttpFn backed by the global fetch (Node >= 18, browsers). */
export const fetchHttp: HttpFn = async (req) => {
  const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body as BodyInit | undefined });
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => (headers[key.toLowerCase()] = value));
  return { status: res.status, headers, text: await res.text() };
};
