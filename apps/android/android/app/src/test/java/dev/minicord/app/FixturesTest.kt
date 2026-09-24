package dev.minicord.app

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.LocalDateTime
import java.time.ZoneId

/**
 * Runs the fixtures in packages/core/test/fixtures against the Kotlin port, so the
 * background service decides notifications exactly like the TypeScript client.
 */
class FixturesTest {
    private fun load(name: String) = JSONObject(File(System.getProperty("minicord.fixtures"), name).readText())

    private fun local(s: String) = LocalDateTime.parse(s).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()

    private fun merge(base: JSONObject, patch: JSONObject?): JSONObject {
        val out = JSONObject(base.toString())
        patch?.keys()?.forEach { out.put(it, patch.get(it)) }
        return out
    }

    @Test
    fun mentions() {
        val f = load("mentions.json")
        val context = f.getJSONObject("context")
        val cases = f.getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val name = c.getString("name")
            val settings = merge(context.getJSONObject("settings").getJSONObject("g"), c.optJSONObject("settings"))
            val ctx = object : MentionContext {
                override val meId = context.getString("meId")
                override fun myRoleIds(guildId: String) = context.getJSONObject("roles").optJSONArray(guildId).strings()
                override fun suppressEveryone(guildId: String) = settings.optBoolean("suppress_everyone")
                override fun suppressRoles(guildId: String) = settings.optBoolean("suppress_roles")
            }
            val result = Mentions.classify(merge(f.getJSONObject("base"), c.getJSONObject("message")), ctx)
            val expect = c.optJSONObject("expect")
            if (expect == null) assertNull(name, result) else assertEquals(name, Mention(expect.getString("kind"), expect.getBoolean("pings")), result)
        }
    }

    @Test
    fun notificationPolicy() {
        val f = load("notification-policy.json")
        val cases = f.getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val name = c.getString("name")
            val input = merge(f.getJSONObject("base"), c.getJSONObject("input"))
            val config = RulesConfig.fromJson(merge(f.getJSONObject("config"), c.optJSONObject("config")))
            val decision = Policy.decide(
                NotifyInput(
                    config = config,
                    meId = input.getString("meId"),
                    authorId = input.getString("authorId"),
                    isDM = input.getBoolean("isDM"),
                    guildId = input.optString("guildId").ifEmpty { null },
                    mention = input.optJSONObject("mention")?.let { Mention(it.getString("kind"), it.getBoolean("pings")) },
                    mutedByDiscord = input.getBoolean("mutedByDiscord"),
                    discordLevel = if (input.has("discordLevel")) input.getInt("discordLevel") else null,
                    authorBlocked = input.getBoolean("authorBlocked"),
                    viewingChannel = input.getBoolean("viewingChannel"),
                    now = local(input.getString("now")),
                ),
            )
            val e = c.getJSONObject("expect")
            val expected = when (e.getString("action")) {
                "notify" -> Decision.Notify(e.getString("category"))
                "digest" -> Decision.Digest(e.getString("category"))
                "hold" -> Decision.Hold(e.getString("category"), local(e.getString("until")))
                else -> null
            }
            if (expected == null) assertTrue("$name: expected no notification, got $decision", decision is Decision.None) else assertEquals(name, expected, decision)
        }
    }
}
