package dev.minicord.app

import org.json.JSONArray
import org.json.JSONObject
import java.time.OffsetDateTime

data class ChannelInfo(val guildId: String?, val type: Int, val parentId: String?, val name: String?, val recipients: List<String> = emptyList())

data class ChannelOverride(val muted: Boolean, val muteEnd: Long?, val level: Int)

data class GuildSettings(
    val muted: Boolean,
    val muteEnd: Long?,
    val level: Int,
    val suppressEveryone: Boolean,
    val suppressRoles: Boolean,
    val overrides: Map<String, ChannelOverride>,
)

/**
 * The slice of Discord state the background service needs to decide notifications:
 * who I am, my roles, per-server notification settings, channel → server mapping,
 * blocked users and display names. Fed from READY and dispatches (see Store in core).
 */
class NotificationState : MentionContext {
    override var meId: String = ""
    val guildNames = HashMap<String, String>()
    val channels = HashMap<String, ChannelInfo>()
    val myRoles = HashMap<String, Set<String>>()
    val settings = HashMap<String, GuildSettings>()
    val blocked = HashSet<String>()
    val userNames = HashMap<String, String>()

    override fun myRoleIds(guildId: String): Set<String> = myRoles[guildId] ?: emptySet()
    override fun suppressEveryone(guildId: String) = settings[guildId]?.suppressEveryone ?: false
    override fun suppressRoles(guildId: String) = settings[guildId]?.suppressRoles ?: false

    fun onReady(d: JSONObject) {
        guildNames.clear(); channels.clear(); myRoles.clear(); settings.clear(); blocked.clear(); userNames.clear()
        val user = d.optJSONObject("user")
        meId = user?.optString("id") ?: ""
        d.optJSONArray("users")?.forEachObject { rememberUser(it) }
        val guilds = d.optJSONArray("guilds")
        val merged = d.optJSONArray("merged_members")
        if (guilds != null) {
            for (i in 0 until guilds.length()) {
                val g = guilds.optJSONObject(i) ?: continue
                if (g.optBoolean("unavailable")) continue
                addGuild(g)
                merged?.optJSONArray(i)?.forEachObject { m ->
                    if ((m.optString("user_id").ifEmpty { m.optJSONObject("user")?.optString("id") ?: "" }) == meId) myRoles[g.getString("id")] = m.optJSONArray("roles").strings()
                }
            }
        }
        d.optJSONArray("private_channels")?.forEachObject { addPrivateChannel(it) }
        d.optJSONArray("relationships")?.forEachObject { onRelationship(it) }
        entries(d.opt("user_guild_settings")).forEachObject { onGuildSettings(it) }
    }

    fun onDispatch(t: String, d: JSONObject) {
        when (t) {
            "GUILD_CREATE" -> if (!d.optBoolean("unavailable")) addGuild(d)
            "GUILD_UPDATE" -> (d.optJSONObject("properties") ?: d).optString("name").takeIf { it.isNotEmpty() }?.let { guildNames[d.getString("id")] = it }
            "GUILD_DELETE" -> if (!d.optBoolean("unavailable")) removeGuild(d.getString("id"))
            "CHANNEL_CREATE", "CHANNEL_UPDATE", "THREAD_CREATE", "THREAD_UPDATE" -> {
                if (d.optInt("type") == 1 || d.optInt("type") == 3) addPrivateChannel(d) else addChannel(d, d.optString("guild_id").ifEmpty { null })
            }
            "CHANNEL_DELETE", "THREAD_DELETE" -> channels.remove(d.optString("id"))
            "GUILD_MEMBER_UPDATE" -> if ((d.optJSONObject("user")?.optString("id") ?: d.optString("user_id")) == meId) {
                myRoles[d.getString("guild_id")] = d.optJSONArray("roles").strings()
            }
            "USER_GUILD_SETTINGS_UPDATE" -> onGuildSettings(d)
            "RELATIONSHIP_ADD", "RELATIONSHIP_UPDATE" -> onRelationship(d)
            "RELATIONSHIP_REMOVE" -> blocked.remove(d.optString("id"))
            "MESSAGE_CREATE" -> d.optJSONObject("author")?.let { a ->
                val nick = d.optJSONObject("member")?.optString("nick")?.takeIf { it.isNotEmpty() && it != "null" }
                userNames[a.optString("id")] = nick ?: displayName(a)
            }
        }
    }

    /** Muted in Discord's own settings (server, category, channel, or DM). */
    fun mutedByDiscord(channelId: String, now: Long): Boolean {
        val channel = channels[channelId]
        val s = settings[channel?.guildId ?: "@me"] ?: return false
        fun active(muted: Boolean, end: Long?) = muted && (end == null || end > now)
        if (channel?.guildId != null && active(s.muted, s.muteEnd)) return true
        val parent = channel?.parentId
        val grandparent = parent?.let { channels[it]?.parentId }
        return listOfNotNull(channelId, parent, grandparent).any { id -> s.overrides[id]?.let { active(it.muted, it.muteEnd) } ?: false }
    }

    /** Discord's effective notification level: channel override → parent → server. */
    fun notificationLevel(channelId: String): Int {
        val channel = channels[channelId]
        val s = settings[channel?.guildId ?: "@me"] ?: return 1
        for (id in listOfNotNull(channelId, channel?.parentId)) {
            val o = s.overrides[id]
            if (o != null && o.level != 3) return o.level
        }
        return s.level
    }

    fun dmTitle(channelId: String): String {
        val c = channels[channelId] ?: return "Direct message"
        if (!c.name.isNullOrEmpty()) return c.name
        return c.recipients.mapNotNull { userNames[it] }.joinToString(", ").ifEmpty { "Direct message" }
    }

    private fun addGuild(g: JSONObject) {
        val id = g.getString("id")
        val props = g.optJSONObject("properties") ?: g
        guildNames[id] = props.optString("name", "Server")
        g.optJSONArray("channels")?.forEachObject { addChannel(it, id) }
        g.optJSONArray("threads")?.forEachObject { addChannel(it, id) }
        g.optJSONArray("members")?.forEachObject { m ->
            if ((m.optJSONObject("user")?.optString("id") ?: m.optString("user_id")) == meId) myRoles[id] = m.optJSONArray("roles").strings()
        }
    }

    private fun removeGuild(id: String) {
        guildNames.remove(id)
        myRoles.remove(id)
        channels.entries.removeAll { it.value.guildId == id }
    }

    private fun addChannel(c: JSONObject, guildId: String?) {
        channels[c.getString("id")] = ChannelInfo(guildId, c.optInt("type"), c.optString("parent_id").ifEmpty { null }.takeIf { it != "null" }, c.optString("name").takeIf { it.isNotEmpty() && it != "null" })
    }

    private fun addPrivateChannel(c: JSONObject) {
        val recipients = c.optJSONArray("recipient_ids")?.strings()?.toList()
            ?: c.optJSONArray("recipients")?.let { arr -> (0 until arr.length()).mapNotNull { arr.optJSONObject(it)?.also(::rememberUser)?.optString("id") } }
            ?: emptyList()
        channels[c.getString("id")] = ChannelInfo(null, c.optInt("type"), null, c.optString("name").takeIf { it.isNotEmpty() && it != "null" }, recipients)
    }

    private fun onRelationship(r: JSONObject) {
        val userId = r.optString("user_id").ifEmpty { r.optJSONObject("user")?.optString("id") ?: r.optString("id") }
        r.optJSONObject("user")?.let(::rememberUser)
        r.optString("nickname").takeIf { it.isNotEmpty() && it != "null" }?.let { userNames[userId] = it }
        if (r.optInt("type") == 2) blocked.add(userId) else blocked.remove(userId)
    }

    private fun onGuildSettings(s: JSONObject) {
        val key = s.optString("guild_id").ifEmpty { "@me" }.let { if (it == "null") "@me" else it }
        val overrides = HashMap<String, ChannelOverride>()
        s.optJSONArray("channel_overrides")?.forEachObject { o ->
            overrides[o.optString("channel_id")] = ChannelOverride(o.optBoolean("muted"), muteEnd(o.optJSONObject("mute_config")), o.optInt("message_notifications", 3))
        }
        settings[key] = GuildSettings(
            muted = s.optBoolean("muted"),
            muteEnd = muteEnd(s.optJSONObject("mute_config")),
            level = s.optInt("message_notifications", 1),
            suppressEveryone = s.optBoolean("suppress_everyone"),
            suppressRoles = s.optBoolean("suppress_roles"),
            overrides = overrides,
        )
    }

    private fun rememberUser(u: JSONObject) {
        userNames.putIfAbsent(u.optString("id"), displayName(u))
    }

    companion object {
        fun displayName(u: JSONObject): String =
            u.optString("global_name").takeIf { it.isNotEmpty() && it != "null" } ?: u.optString("username", "Someone")

        private fun muteEnd(config: JSONObject?): Long? {
            val end = config?.optString("end_time")?.takeIf { it.isNotEmpty() && it != "null" } ?: return null
            return try {
                OffsetDateTime.parse(end).toInstant().toEpochMilli()
            } catch (_: Exception) {
                null
            }
        }

        /** READY sends some collections as arrays or as `{ entries, partial, version }`. */
        private fun entries(value: Any?): JSONArray = when (value) {
            is JSONArray -> value
            is JSONObject -> value.optJSONArray("entries") ?: JSONArray()
            else -> JSONArray()
        }
    }
}

internal inline fun JSONArray.forEachObject(fn: (JSONObject) -> Unit) {
    for (i in 0 until length()) optJSONObject(i)?.let(fn)
}

internal fun JSONArray?.strings(): Set<String> {
    if (this == null) return emptySet()
    return (0 until length()).map { optString(it) }.toSet()
}
