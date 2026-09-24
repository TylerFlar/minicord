package dev.minicord.app

import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * minicord isn't on the Play Store, so updates come from GitHub releases: look up the latest
 * release and, when it's newer than this build, hand back its APK for the browser to download.
 */
object Updates {
    /** Keep in sync with the electron-builder publish config in apps/desktop/package.json. */
    private const val REPO = "TylerFlar/minicord"
    private val http by lazy { OkHttpClient.Builder().callTimeout(15, TimeUnit.SECONDS).build() }

    /** Blocking; call off the main thread. Returns the UpdateStatus shape the UI expects. */
    fun check(current: String): JSONObject {
        val request = Request.Builder()
            .url("https://api.github.com/repos/$REPO/releases/latest")
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "minicord/$current")
            .build()
        return try {
            http.newCall(request).execute().use { res ->
                if (res.code == 404) return JSONObject().put("state", "none")
                if (!res.isSuccessful) return JSONObject().put("state", "error").put("message", "GitHub answered ${res.code}")
                val release = JSONObject(res.body.string())
                val latest = release.optString("tag_name").removePrefix("v")
                if (latest.isEmpty() || compare(latest, current) <= 0) return JSONObject().put("state", "none")
                val assets = release.optJSONArray("assets")
                var apk: String? = null
                for (i in 0 until (assets?.length() ?: 0)) {
                    val asset = assets!!.getJSONObject(i)
                    if (asset.optString("name").endsWith(".apk")) apk = asset.optString("browser_download_url")
                }
                JSONObject().put("state", "available").put("version", latest).put("url", apk ?: release.optString("html_url"))
            }
        } catch (e: Exception) {
            JSONObject().put("state", "error").put("message", e.message ?: "network error")
        }
    }

    /** Compare dotted versions numerically ("0.10.0" > "0.9.3"); pre-release suffixes are ignored. */
    fun compare(a: String, b: String): Int {
        val pa = a.substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }
        val pb = b.substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(pa.size, pb.size)) {
            val d = (pa.getOrElse(i) { 0 }).compareTo(pb.getOrElse(i) { 0 })
            if (d != 0) return d
        }
        return 0
    }
}
