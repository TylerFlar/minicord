package dev.minicord.app

import java.io.ByteArrayOutputStream
import java.util.zip.Inflater

/**
 * Discord's `compress=zlib-stream`: one zlib context per connection, each payload ending
 * in a Z_SYNC_FLUSH marker (00 00 FF FF). Payloads may span frames, and so may the marker.
 */
class ZlibStream {
    private val inflater = Inflater()
    private val pending = ByteArrayOutputStream()
    private val chunk = ByteArray(64 * 1024)

    fun push(frame: ByteArray): String? {
        pending.write(frame)
        val size = pending.size()
        if (size < 4) return null
        val bytes = pending.toByteArray()
        if (bytes[size - 4] != 0.toByte() || bytes[size - 3] != 0.toByte() || bytes[size - 2] != 0xff.toByte() || bytes[size - 1] != 0xff.toByte()) {
            return null
        }
        pending.reset()
        inflater.setInput(bytes)
        val out = ByteArrayOutputStream(bytes.size * 4)
        while (true) {
            val n = inflater.inflate(chunk)
            if (n > 0) out.write(chunk, 0, n)
            if (n == 0 && (inflater.needsInput() || inflater.finished())) break
        }
        return out.toString(Charsets.UTF_8.name())
    }
}
