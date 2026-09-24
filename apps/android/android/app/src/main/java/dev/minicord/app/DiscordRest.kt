package dev.minicord.app

import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

/**
 * Authenticated REST for the UI, done natively so the token never enters the WebView
 * (mirrors RestClient in packages/core): serialized, lightly spaced, 429-aware.
 */
class DiscordRest(private val http: OkHttpClient, private val token: String, private val props: ClientProperties) {
    data class Result(val status: Int, val body: String)

    private val lock = Any()
    private var lastRequestAt = 0L
    private var globalResumeAt = 0L

    /** Blocking; call from a background thread. */
    fun request(method: String, path: String, opts: JSONObject): Result = synchronized(lock) {
        val url = "https://discord.com/api/v9$path".toHttpUrl().newBuilder().apply {
            opts.optJSONObject("query")?.let { q ->
                for (key in q.keys()) {
                    val v = q.opt(key)
                    if (v != null && v != JSONObject.NULL) addQueryParameter(key, v.toString())
                }
            }
        }.build()
        val json = opts.opt("json")
        val form = opts.optJSONObject("form")
        val body = when {
            json != null && json != JSONObject.NULL -> json.toString().toRequestBody(JSON)
            // payload_json-style multipart, with a Chrome-looking boundary (like RestClient).
            form != null -> MultipartBody.Builder(boundary()).setType(MultipartBody.FORM).apply {
                for (k in form.keys()) addFormDataPart(k, form.getString(k))
            }.build()
            method == "GET" || method == "DELETE" -> null
            else -> ByteArray(0).toRequestBody(null)
        }
        val builder = Request.Builder().url(url).method(method, body)
        for ((k, v) in props.headers()) builder.header(k, v)
        builder.header("Authorization", token)
        opts.optJSONObject("headers")?.let { h -> for (k in h.keys()) builder.header(k, h.getString(k)) }
        opts.optJSONObject("captcha")?.let { c ->
            builder.header("X-Captcha-Key", c.getString("key"))
            c.optString("rqtoken").takeIf { it.isNotEmpty() }?.let { builder.header("X-Captcha-Rqtoken", it) }
            c.optString("sessionId").takeIf { it.isNotEmpty() }?.let { builder.header("X-Captcha-Session-Id", it) }
        }
        val request = builder.build()

        var attempt = 0
        while (true) {
            val wait = maxOf(globalResumeAt, lastRequestAt + MIN_SPACING_MS) - System.currentTimeMillis()
            if (wait > 0) Thread.sleep(wait)
            lastRequestAt = System.currentTimeMillis()
            val result = http.newCall(request).execute().use { Result(it.code, it.body.string()) }
            if (result.status == 429 && attempt < MAX_RETRIES) {
                val parsed = runCatching { JSONObject(result.body) }.getOrNull()
                val delay = ((parsed?.optDouble("retry_after", 1.0) ?: 1.0) * 1000).toLong() + 100
                if (parsed?.optBoolean("global") == true) globalResumeAt = System.currentTimeMillis() + delay
                Thread.sleep(delay)
                attempt++
                continue
            }
            if (result.status in 500..599 && method == "GET" && attempt < MAX_RETRIES) {
                Thread.sleep(500L shl attempt)
                attempt++
                continue
            }
            return result
        }
        @Suppress("UNREACHABLE_CODE")
        error("unreachable")
    }

    private fun boundary(): String {
        val chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
        return "----WebKitFormBoundary" + (1..16).map { chars.random() }.joinToString("")
    }

    private companion object {
        const val MIN_SPACING_MS = 60L
        const val MAX_RETRIES = 3
        val JSON = "application/json".toMediaType()
    }
}
