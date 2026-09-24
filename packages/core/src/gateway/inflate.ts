import { Unzlib } from "fflate";

/**
 * Incremental decoder for Discord's `compress=zlib-stream` transport: one zlib
 * context for the whole connection, each payload terminated by a Z_SYNC_FLUSH
 * marker (00 00 FF FF). A payload may span several WebSocket frames, and the
 * marker itself may be split across frames, so we track the last four bytes.
 */
export class ZlibStreamInflater {
  #unzlib: Unzlib;
  #out: Uint8Array[] = [];
  #tail = new Uint8Array(0);
  #decoder = new TextDecoder();

  constructor() {
    this.#unzlib = new Unzlib((chunk) => this.#out.push(chunk));
  }

  /** Feed one frame; returns the decoded JSON text once a full payload is available. */
  push(frame: Uint8Array): string | null {
    this.#unzlib.push(frame, false);

    const joined = new Uint8Array(this.#tail.length + Math.min(frame.length, 4));
    joined.set(this.#tail);
    joined.set(frame.subarray(Math.max(0, frame.length - 4)), this.#tail.length);
    this.#tail = joined.subarray(Math.max(0, joined.length - 4));

    const t = this.#tail;
    if (t.length < 4 || t[0] !== 0x00 || t[1] !== 0x00 || t[2] !== 0xff || t[3] !== 0xff) return null;

    let size = 0;
    for (const c of this.#out) size += c.length;
    const all = new Uint8Array(size);
    let offset = 0;
    for (const c of this.#out) {
      all.set(c, offset);
      offset += c.length;
    }
    this.#out = [];
    return this.#decoder.decode(all);
  }
}
