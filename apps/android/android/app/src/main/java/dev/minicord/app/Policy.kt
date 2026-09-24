package dev.minicord.app

import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/*
 * Kotlin port of the notification policy in packages/core/src/mentions.ts and
 * packages/core/src/rules/{policy,time}.ts. The background service decides notifications
 * while the UI may not be running. Both implementations run the same fixture cases
 * (packages/core/test/fixtures), so keep them in step.
 */

data class QuietHours(val enabled: Boolean, val start: String, val end: String)

data class RulesConfig(
    val defaultMode: String,
    val guildModes: Map<String, String>,
    val vaultMentionDelivery: String,
    val vaultIgnoreEveryone: Boolean,
    val openNotify: String,
    val quietHours: QuietHours,
    val digestTimes: List<String>,
) {
    fun modeOf(guildId: String): String = guildModes[guildId] ?: defaultMode

    companion object {
        val DEFAULT = RulesConfig("vault", emptyMap(), "instant", true, "mentions", QuietHours(true, "23:00", "08:00"), listOf("12:00", "18:00"))

        /** Parses `config` from the rules state the UI persists (packages/core/src/rules/types.ts). */
        fun fromJson(config: JSONObject?): RulesConfig {
            if (config == null) return DEFAULT
            val modes = HashMap<String, String>()
            config.optJSONObject("guildModes")?.let { m -> for (k in m.keys()) modes[k] = m.getString(k) }
            val q = config.optJSONObject("quietHours")
            val digest = config.optJSONArray("digestTimes")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: DEFAULT.digestTimes
            return RulesConfig(
                defaultMode = config.optString("defaultMode", DEFAULT.defaultMode),
                guildModes = modes,
                vaultMentionDelivery = config.optString("vaultMentionDelivery", DEFAULT.vaultMentionDelivery),
                vaultIgnoreEveryone = config.optBoolean("vaultIgnoreEveryone", DEFAULT.vaultIgnoreEveryone),
                openNotify = config.optString("openNotify", DEFAULT.openNotify),
                quietHours = if (q == null) DEFAULT.quietHours else QuietHours(q.optBoolean("enabled", true), q.optString("start", "23:00"), q.optString("end", "08:00")),
                digestTimes = digest,
            )
        }
    }
}

data class Mention(val kind: String, val pings: Boolean)

interface MentionContext {
    val meId: String
    fun myRoleIds(guildId: String): Set<String>
    fun suppressEveryone(guildId: String): Boolean
    fun suppressRoles(guildId: String): Boolean
}

object Mentions {
    fun classify(msg: JSONObject, ctx: MentionContext): Mention? {
        if (msg.optJSONObject("author")?.optString("id") == ctx.meId) return null
        val repliesToMe = msg.optJSONObject("referenced_message")?.optJSONObject("author")?.optString("id") == ctx.meId
        val mentions = msg.optJSONArray("mentions")
        if (mentions != null && (0 until mentions.length()).any { mentions.optJSONObject(it)?.optString("id") == ctx.meId }) {
            val content = msg.optString("content", "")
            val explicit = content.contains("<@${ctx.meId}>") || content.contains("<@!${ctx.meId}>")
            return Mention(if (repliesToMe && !explicit) "reply" else "user", true)
        }
        val guildId = msg.optString("guild_id", "").ifEmpty { null }
        if (guildId != null) {
            val roles = msg.optJSONArray("mention_roles")
            if (!ctx.suppressRoles(guildId) && roles != null && roles.length() > 0) {
                val mine = ctx.myRoleIds(guildId)
                if ((0 until roles.length()).any { roles.optString(it) in mine }) return Mention("role", true)
            }
            if (msg.optBoolean("mention_everyone") && !ctx.suppressEveryone(guildId)) return Mention("everyone", true)
        }
        return if (repliesToMe) Mention("reply", false) else null
    }
}

data class NotifyInput(
    val config: RulesConfig,
    val meId: String,
    val authorId: String,
    val isDM: Boolean,
    val guildId: String?,
    val mention: Mention?,
    val mutedByDiscord: Boolean,
    val discordLevel: Int?,
    val authorBlocked: Boolean,
    val viewingChannel: Boolean,
    val now: Long,
    val zone: ZoneId = ZoneId.systemDefault(),
)

sealed class Decision {
    data class Notify(val category: String) : Decision()
    data class Digest(val category: String) : Decision()
    data class Hold(val category: String, val until: Long) : Decision()
    data class None(val reason: String) : Decision()
}

object Policy {
    fun decide(i: NotifyInput): Decision {
        if (i.authorId == i.meId) return Decision.None("own message")
        if (i.authorBlocked) return Decision.None("blocked")
        if (i.viewingChannel) return Decision.None("already viewing")

        val category: String
        var digest = false
        if (i.isDM) {
            if (i.mutedByDiscord) return Decision.None("dm muted")
            category = "dm"
        } else {
            val guildId = i.guildId ?: return Decision.None("no guild")
            val mode = i.config.modeOf(guildId)
            val m = i.mention
            if (m != null && m.pings) {
                if (mode == "vault" && m.kind == "everyone" && i.config.vaultIgnoreEveryone) return Decision.None("@everyone in vault")
                if (mode == "open" && i.mutedByDiscord) return Decision.None("server muted")
                category = "mention"
                digest = mode == "vault" && i.config.vaultMentionDelivery == "digest"
            } else if (mode == "open" && i.config.openNotify == "discord" && !i.mutedByDiscord && i.discordLevel == 0) {
                category = "message"
            } else {
                return Decision.None("not for you")
            }
        }

        quietHoursEnd(i.config.quietHours, i.now, i.zone)?.let { return Decision.Hold(category, it) }
        return if (digest) Decision.Digest(category) else Decision.Notify(category)
    }

    private fun minutes(hhmm: String): Int {
        val parts = hhmm.split(":")
        return (parts.getOrNull(0)?.toIntOrNull() ?: 0) * 60 + (parts.getOrNull(1)?.toIntOrNull() ?: 0)
    }

    private fun at(date: LocalDate, minutes: Int, zone: ZoneId): Long =
        date.atStartOfDay(zone).plusMinutes(minutes.toLong()).toInstant().toEpochMilli()

    /** If `now` is inside quiet hours, when they end; handles windows spanning midnight. */
    fun quietHoursEnd(q: QuietHours, now: Long, zone: ZoneId): Long? {
        if (!q.enabled) return null
        val start = minutes(q.start)
        val end = minutes(q.end)
        if (start == end) return null
        val dt = Instant.ofEpochMilli(now).atZone(zone)
        val m = dt.hour * 60 + dt.minute
        val today = dt.toLocalDate()
        return if (start < end) {
            if (m in start until end) at(today, end, zone) else null
        } else when {
            m >= start -> at(today.plusDays(1), end, zone)
            m < end -> at(today, end, zone)
            else -> null
        }
    }

    fun nextDigestTime(times: List<String>, now: Long, zone: ZoneId): Long? {
        if (times.isEmpty()) return null
        val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        return times.flatMap { t -> listOf(at(today, minutes(t), zone), at(today.plusDays(1), minutes(t), zone)) }.filter { it > now }.minOrNull()
    }
}
