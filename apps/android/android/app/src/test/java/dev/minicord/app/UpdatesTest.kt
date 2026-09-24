package dev.minicord.app

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class UpdatesTest {
    @Test
    fun comparesVersionsNumerically() {
        assertEquals(1, Updates.compare("0.10.0", "0.9.3"))
        assertEquals(0, Updates.compare("1.2.0", "1.2"))
        assertEquals(-1, Updates.compare("0.1.0", "0.1.1"))
        assertEquals(0, Updates.compare("0.2.0-beta.1", "0.2.0"))
    }

    private fun release(tag: String, vararg assets: JSONObject) = JSONObject()
        .put("tag_name", tag)
        .put("html_url", "https://github.com/TylerFlar/minicord/releases/tag/$tag")
        .put("assets", JSONArray(assets.toList()))

    private fun asset(name: String, digest: String? = null) = JSONObject()
        .put("name", name)
        .put("browser_download_url", "https://github.com/TylerFlar/minicord/releases/download/v0.1.2/$name")
        .apply { if (digest != null) put("digest", digest) }

    @Test
    fun picksTheApkAndItsChecksum() {
        val status = Updates.parse(release("v0.1.2", asset("minicord-Setup-0.1.2.exe", "sha256:ffff"), asset("minicord-0.1.2.apk", "sha256:AB12")), "0.1.1")
        assertEquals("available", status.getString("state"))
        assertEquals("0.1.2", status.getString("version"))
        assertEquals("https://github.com/TylerFlar/minicord/releases/download/v0.1.2/minicord-0.1.2.apk", status.getString("url"))
        assertEquals("AB12", status.getString("sha256"))
    }

    @Test
    fun sameOrOlderReleaseIsNoUpdate() {
        assertEquals("none", Updates.parse(release("v0.1.1", asset("minicord-0.1.1.apk")), "0.1.1").getString("state"))
        assertEquals("none", Updates.parse(release("v0.1.0", asset("minicord-0.1.0.apk")), "0.1.1").getString("state"))
    }

    @Test
    fun releaseWithoutApkOrDigest() {
        val noApk = Updates.parse(release("v0.2.0"), "0.1.1")
        assertEquals("https://github.com/TylerFlar/minicord/releases/tag/v0.2.0", noApk.getString("url"))
        assertFalse(Updates.parse(release("v0.2.0", asset("minicord-0.2.0.apk")), "0.1.1").has("sha256"))
    }
}
