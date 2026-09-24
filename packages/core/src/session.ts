import { GatewayClient, GatewayOp } from "./gateway/client.ts";
import type { SocketFactory } from "./gateway/socket.ts";
import { SessionHost } from "./host/session-host.ts";
import { CAPABILITIES, ClientProperties, type ClientIdentity } from "./properties.ts";
import { DiscordApi } from "./rest/api.ts";
import { RestClient } from "./rest/client.ts";
import type { HttpFn } from "./rest/http.ts";

export interface SessionOptions {
  token: string;
  identity: ClientIdentity;
  socketFactory: SocketFactory;
  http: HttpFn;
  logger?: (message: string) => void;
}

export interface Session {
  properties: ClientProperties;
  gateway: GatewayClient;
  host: SessionHost;
  rest: RestClient;
  api: DiscordApi;
}

/** Wire up gateway + replay host + REST with a web-client identity. Used by Electron main and scripts. */
export function createSession(opts: SessionOptions): Session {
  const properties = new ClientProperties(opts.identity);
  const focused = () => properties.appState === "focused";

  const gateway = new GatewayClient({
    identify: () => ({
      token: opts.token,
      capabilities: CAPABILITIES,
      properties: properties.gatewayProperties(),
      presence: { status: "unknown", since: 0, activities: [], afk: false },
      compress: false,
      client_state: { guild_versions: {} },
    }),
    socketFactory: opts.socketFactory,
    compress: true,
    heartbeat: (seq) => ({
      op: GatewayOp.QosHeartbeat,
      d: { seq, qos: { ver: 31, active: focused(), reasons: focused() ? ["foregrounded"] : [] } },
    }),
    timeSpent: () => ({
      initialization_timestamp: properties.launchedAt,
      session_id: properties.heartbeatSessionId(),
      client_launch_id: properties.launchId,
    }),
    ...(opts.logger ? { logger: opts.logger } : {}),
  });

  const host = new SessionHost(gateway);
  const rest = new RestClient({
    token: opts.token,
    http: opts.http,
    baseHeaders: () => properties.headers(),
    ...(opts.logger ? { logger: opts.logger } : {}),
  });
  return { properties, gateway, host, rest, api: new DiscordApi((method, path, o) => rest.request(method, path, o)) };
}
