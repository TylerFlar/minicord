package dev.minicord.app

import android.content.Context
import android.util.Base64
import androidx.webkit.WebViewCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.security.SecureRandom
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/**
 * The same web-client identity the desktop app uses (packages/core/src/properties.ts):
 * Discord's web client in Chrome on Windows. The user agent here is also the one sent on
 * every request and by the Discord WebView, so X-Super-Properties always matches the wire.
 */
object Identity {
    /** Live web value 1734653 minus AUTH_TOKEN_REFRESH (1<<8) and DEBOUNCE_MESSAGE_REACTIONS (1<<13). */
    const val CAPABILITIES = 1734653 and (1 shl 8).inv() and (1 shl 13).inv()
    const val FALLBACK_BUILD_NUMBER = 619060
    const val FALLBACK_CHROME_MAJOR = 146

    /** Launch-signature bits that flag detected client mods; they must be zero. */
    private val CLIENT_MOD_BITS = intArrayOf(119, 108, 100, 91, 84, 75, 61, 55, 48, 38, 24, 11)
    private val BUILD_NUMBER = Regex("\"BUILD_NUMBER\"\\s*:\\s*\"(\\d+)\"")

    /** Chromium major of the system WebView, so the claimed Chrome version matches the engine that makes calls. */
    fun chromeMajor(context: Context): Int = try {
        WebViewCompat.getCurrentWebViewPackage(context)?.versionName?.substringBefore('.')?.toIntOrNull() ?: FALLBACK_CHROME_MAJOR
    } catch (_: Throwable) {
        FALLBACK_CHROME_MAJOR
    }

    fun userAgent(chromeMajor: Int) =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$chromeMajor.0.0.0 Safari/537.36"

    fun launchSignature(): String {
        val bytes = ByteArray(16).also { SecureRandom().nextBytes(it) }
        bytes[6] = ((bytes[6].toInt() and 0x0f) or 0x40).toByte()
        bytes[8] = ((bytes[8].toInt() and 0x3f) or 0x80).toByte()
        for (bit in CLIENT_MOD_BITS) {
            val i = 15 - bit / 8
            bytes[i] = (bytes[i].toInt() and (1 shl (bit % 8)).inv()).toByte()
        }
        val hex = bytes.joinToString("") { "%02x".format(it) }
        return "${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}"
    }

    /** Current web build number, cached for 12 hours. Blocking; call off the main thread. */
    fun buildNumber(context: Context, http: OkHttpClient, userAgent: String): Int {
        val prefs = context.getSharedPreferences("minicord_cache", Context.MODE_PRIVATE)
        val cachedAt = prefs.getLong("build_at", 0)
        if (System.currentTimeMillis() - cachedAt < 12 * 3_600_000L) {
            prefs.getInt("build", 0).takeIf { it > 0 }?.let { return it }
        }
        val scraped = try {
            http.newCall(Request.Builder().url("https://discord.com/login").header("User-Agent", userAgent).build()).execute().use { res ->
                BUILD_NUMBER.find(res.body.string())?.groupValues?.get(1)?.toIntOrNull()
            }
        } catch (_: Exception) {
            null
        }
        if (scraped != null) prefs.edit().putInt("build", scraped).putLong("build_at", System.currentTimeMillis()).apply()
        return scraped ?: prefs.getInt("build", 0).takeIf { it > 0 } ?: FALLBACK_BUILD_NUMBER
    }
}

class ClientProperties(val chromeMajor: Int, val buildNumber: Int) {
    val userAgent = Identity.userAgent(chromeMajor)
    val locale: String = Locale.getDefault().toLanguageTag().takeIf { it.contains('-') } ?: "en-US"
    val timezone: String = TimeZone.getDefault().id
    val launchId: String = UUID.randomUUID().toString()
    val launchSignature: String = Identity.launchSignature()
    val launchedAt = System.currentTimeMillis()

    @Volatile var focused = false
    private var heartbeatSessionId = UUID.randomUUID().toString()
    private var heartbeatSessionStarted = System.currentTimeMillis()

    /** Regenerated every 30 minutes, like the web client. */
    @Synchronized
    fun heartbeatSessionId(): String {
        if (System.currentTimeMillis() - heartbeatSessionStarted > 30 * 60_000L) {
            heartbeatSessionId = UUID.randomUUID().toString()
            heartbeatSessionStarted = System.currentTimeMillis()
        }
        return heartbeatSessionId
    }

    /** Same key order as the web client's getSuperProperties() (Android's JSONObject keeps insertion order). */
    fun superProperties(): JSONObject = JSONObject().apply {
        put("os", "Windows")
        put("browser", "Chrome")
        put("device", "")
        put("system_locale", locale)
        put("has_client_mods", false)
        put("browser_user_agent", userAgent)
        put("browser_version", "$chromeMajor.0.0.0")
        put("os_version", "10")
        put("referrer", "")
        put("referring_domain", "")
        put("referrer_current", "")
        put("referring_domain_current", "")
        put("release_channel", "stable")
        put("client_build_number", buildNumber)
        put("client_event_source", JSONObject.NULL)
        put("client_launch_id", launchId)
        put("launch_signature", launchSignature)
        put("client_heartbeat_session_id", heartbeatSessionId())
        put("client_app_state", if (focused) "focused" else "unfocused")
    }

    fun gatewayProperties(): JSONObject = superProperties().apply {
        put("is_fast_connect", false)
        put("gateway_connect_reasons", "AppSkeleton")
    }

    fun headers(): Map<String, String> = mapOf(
        "User-Agent" to userAgent,
        "X-Super-Properties" to Base64.encodeToString(superProperties().toString().toByteArray(), Base64.NO_WRAP),
        "X-Discord-Locale" to locale,
        "X-Discord-Timezone" to timezone,
        "X-Debug-Options" to "bugReporterEnabled",
        "Accept-Language" to "$locale,${locale.substringBefore('-')};q=0.9",
        "Origin" to "https://discord.com",
        "Referer" to "https://discord.com/channels/@me",
    )
}
