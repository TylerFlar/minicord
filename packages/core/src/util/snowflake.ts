export const DISCORD_EPOCH = 1420070400000n;

export function snowflakeToMs(id: string): number {
  return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
}

export function msToSnowflake(ms: number): string {
  return ((BigInt(Math.floor(ms)) - DISCORD_EPOCH) << 22n).toString();
}

/** Compare two snowflakes numerically. Null/undefined/"0" sort first. */
export function compareSnowflakes(a: string | null | undefined, b: string | null | undefined): number {
  const x = a ? BigInt(a) : 0n;
  const y = b ? BigInt(b) : 0n;
  return x < y ? -1 : x > y ? 1 : 0;
}

export function isNewer(a: string | null | undefined, than: string | null | undefined): boolean {
  return compareSnowflakes(a, than) > 0;
}

/** A nonce in the same shape the official client uses (a snowflake for "now"). */
export function makeNonce(now = Date.now()): string {
  return msToSnowflake(now);
}
