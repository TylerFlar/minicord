package dev.minicord.app

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * minicord isn't on the Play Store, so updates come from GitHub releases: look up the latest
 * release and, when it's newer than this build, download its APK and hand it to Android's
 * installer (the browser isn't involved: Chrome can leave APK downloads pending forever).
 */
object Updates {
    /** Keep in sync with the electron-builder publish config in apps/desktop/package.json. */
    private const val REPO = "TylerFlar/minicord"
    private val http by lazy { OkHttpClient.Builder().callTimeout(15, TimeUnit.SECONDS).build() }
    private val downloads by lazy { http.newBuilder().callTimeout(10, TimeUnit.MINUTES).readTimeout(30, TimeUnit.SECONDS).build() }

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
                parse(JSONObject(res.body.string()), current)
            }
        } catch (e: Exception) {
            JSONObject().put("state", "error").put("message", e.message ?: "network error")
        }
    }

    /** The UpdateStatus for a GitHub release: its APK, and the SHA-256 GitHub publishes for it. */
    fun parse(release: JSONObject, current: String): JSONObject {
        val latest = release.optString("tag_name").removePrefix("v")
        if (latest.isEmpty() || compare(latest, current) <= 0) return JSONObject().put("state", "none")
        val status = JSONObject().put("state", "available").put("version", latest).put("url", release.optString("html_url"))
        val assets = release.optJSONArray("assets")
        for (i in 0 until (assets?.length() ?: 0)) {
            val asset = assets!!.getJSONObject(i)
            if (!asset.optString("name").endsWith(".apk")) continue
            status.put("url", asset.optString("browser_download_url"))
            asset.optString("digest").takeIf { it.startsWith("sha256:") }?.let { status.put("sha256", it.removePrefix("sha256:")) }
        }
        return status
    }

    /** Blocking. Downloads the APK of an "available" status into the cache, checking its SHA-256 when known. */
    fun download(context: Context, status: JSONObject): File {
        val url = status.optString("url")
        if (!url.startsWith("https://github.com/$REPO/releases/download/")) throw IOException("no APK in the latest release")
        val dir = File(context.cacheDir, "updates").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val apk = File(dir, "minicord-${status.optString("version")}.apk")
        val sha = MessageDigest.getInstance("SHA-256")
        downloads.newCall(Request.Builder().url(url).header("User-Agent", "minicord").build()).execute().use { res ->
            if (!res.isSuccessful) throw IOException("GitHub answered ${res.code}")
            res.body.byteStream().use { input ->
                apk.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        sha.update(buf, 0, n)
                        out.write(buf, 0, n)
                    }
                }
            }
        }
        val expected = status.optString("sha256")
        if (expected.isNotEmpty() && !sha.digest().joinToString("") { "%02x".format(it) }.equals(expected, ignoreCase = true)) {
            apk.delete()
            throw IOException("the download didn't match its checksum")
        }
        return apk
    }

    /** Opens Android's installer for a downloaded APK (it asks once to allow installs from minicord). */
    fun install(context: Context, apk: File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apk)
        context.startActivity(
            Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
        )
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
