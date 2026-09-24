package dev.minicord.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Everything that must outlive the UI: the Discord connection, the notification policy and
 * its state, wake alarms, and the held/digest queues. The foreground service keeps the
 * process (and so this object) alive; the Capacitor plugin attaches the UI to it.
 */
object MinicordRuntime {
    private const val TAG = "minicord"
    const val ACTION_HEARTBEAT = "dev.minicord.app.HEARTBEAT"
    const val ACTION_FLUSH = "dev.minicord.app.FLUSH"

    private lateinit var app: Context
    lateinit var notifier: Notifier
        private set
    private lateinit var tokens: TokenStore
    lateinit var state: StateStore
        private set

    private val http: OkHttpClient by lazy {
        OkHttpClient.Builder().readTimeout(0, TimeUnit.MILLISECONDS).pingInterval(0, TimeUnit.MILLISECONDS).build()
    }
    private val io = Executors.newSingleThreadExecutor { r -> Thread(r, "minicord-io").apply { isDaemon = true } }

    @Volatile private var connection: GatewayConnection? = null
    @Volatile var rest: DiscordRest? = null
        private set
    @Volatile private var props: ClientProperties? = null
    private val discord = NotificationState()
    @Volatile private var rules: RulesConfig = RulesConfig.DEFAULT

    /**
     * Debug safety switch for automated runs against a real account: block every REST write
     * except in these channels. Set from launch extras in debuggable builds only.
     */
    @Volatile var readOnly = false
    @Volatile var writeChannels: Set<String> = emptySet()

    fun writeAllowed(method: String, path: String): Boolean {
        if (!readOnly || method == "GET") return true
        val channelId = Regex("""^/channels/(\d+)/""").find(path)?.groupValues?.get(1)
        return channelId != null && channelId in writeChannels
    }

    /** Where gateway events go while a UI is attached. */
    @Volatile var uiSink: UiSink? = null
    @Volatile var uiForeground = false
    @Volatile var viewingChannelId: String? = null

    private data class Queued(val title: String, val body: String, val route: String, val until: Long)
    private val held = ArrayList<Queued>()
    private val digest = ArrayList<Queued>()
    private val ringing = HashSet<String>()

    interface UiSink {
        fun onGatewayEvent(raw: String)
        fun onGatewayStatus(status: String)
        fun onGatewayFatal(code: Int, reason: String)
    }

    @Synchronized
    fun init(context: Context) {
        if (::app.isInitialized) return
        app = context.applicationContext
        notifier = Notifier(app).also { it.ensureChannels() }
        tokens = TokenStore(app)
        state = StateStore(app)
        reloadRules()
    }

    fun hasToken(): Boolean = tokens.load() != null

    fun saveToken(token: String) = tokens.save(token)

    /** One GET /users/@me with the web identity. Blocking. */
    fun validateToken(token: String): Boolean = try {
        val chrome = Identity.chromeMajor(app)
        val props = ClientProperties(chrome, Identity.buildNumber(app, http, Identity.userAgent(chrome)))
        DiscordRest(http, token, props).request("GET", "/users/@me", JSONObject()).status == 200
    } catch (_: Exception) {
        false
    }

    /** Connect if signed in and not already connected. Safe to call repeatedly. */
    @Synchronized
    fun start() {
        if (connection != null) return
        val token = tokens.load() ?: return
        val chrome = Identity.chromeMajor(app)
        io.execute {
            val build = Identity.buildNumber(app, http, Identity.userAgent(chrome))
            val p = ClientProperties(chrome, build).also { it.focused = uiForeground }
            synchronized(this) {
                if (connection != null || tokens.load() == null) return@execute
                props = p
                rest = DiscordRest(http, token, p)
                connection = GatewayConnection(token, p, http, callbacks).also { it.connect() }
            }
            Log.i(TAG, "connecting (Chrome $chrome, build $build)")
        }
    }

    @Synchronized
    fun stop() {
        connection?.close(4000)
        connection = null
        rest = null
        cancelAlarm(ACTION_HEARTBEAT)
    }

    fun signOut() {
        stop()
        tokens.clear()
        app.stopService(Intent(app, GatewayService::class.java))
    }

    fun send(op: Int, d: Any?) {
        connection?.send(op, d)
    }

    /** Blocking PUT of file bytes to a signed upload URL (Discord's cloud upload flow). */
    fun upload(url: String, bytes: ByteArray): Int {
        val request = okhttp3.Request.Builder().url(url).put(bytes.toRequestBody(null)).build()
        return http.newCall(request).execute().use { it.code }
    }

    /** Write READY + backlog to a file the WebView can fetch (avoids pushing megabytes through the bridge). */
    fun writeSnapshot(): String? {
        val conn = waitForConnection() ?: return null
        val file = File(app.cacheDir, "snapshot.json")
        file.writeText(conn.snapshotJson())
        return file.absolutePath
    }

    private fun waitForConnection(): GatewayConnection? {
        if (!hasToken()) return null
        start()
        val deadline = SystemClock.elapsedRealtime() + 15_000
        while (connection == null && SystemClock.elapsedRealtime() < deadline) Thread.sleep(50)
        return connection
    }

    fun setForeground(foreground: Boolean) {
        uiForeground = foreground
        props?.focused = foreground
    }

    fun reloadRules() {
        rules = try {
            RulesConfig.fromJson(state.load("rules")?.let { JSONObject(it).optJSONObject("config") })
        } catch (_: Exception) {
            RulesConfig.DEFAULT
        }
    }

    fun onWakeAlarm() {
        Log.d(TAG, "wake alarm (connection ${connection?.status ?: "none"})")
        keepAwake(8_000)
        connection?.onWakeAlarm() ?: start()
    }

    /** Deliver held (quiet hours) and digest items whose time has come. */
    fun flushDue() {
        val now = System.currentTimeMillis()
        val due: List<Queued>
        synchronized(held) {
            due = held.filter { it.until <= now } + digest.filter { it.until <= now }
            held.removeAll { it.until <= now }
            digest.removeAll { it.until <= now }
        }
        if (due.size == 1) {
            val only = due[0]
            notifier.post("summary-$now", only.title, only.body, Notifier.CH_SUMMARY, only.route)
        } else if (due.isNotEmpty()) {
            val names = due.take(3).joinToString(", ") { it.title.substringBefore(" · ").substringBefore(" in #") }
            notifier.post("summary-$now", "${due.size} messages while you were away", names, Notifier.CH_SUMMARY, JSONObject().put("view", "inbox").toString())
        }
        scheduleFlush()
    }

    // ---- gateway callbacks ------------------------------------------------------------

    private val callbacks = object : GatewayConnection.Callbacks {
        override fun onStatus(status: String) {
            uiSink?.onGatewayStatus(status)
            notifier.updateService(if (status == "ready") "Connected" else "Connecting…")
        }

        override fun onDispatch(t: String, raw: String, d: JSONObject) {
            try {
                if (t == "READY") discord.onReady(d) else discord.onDispatch(t, d)
                when (t) {
                    "MESSAGE_CREATE" -> onMessage(d)
                    "CALL_CREATE", "CALL_UPDATE" -> onCall(d)
                    "CALL_DELETE" -> cancelCall(d.optString("channel_id"))
                }
            } catch (e: Exception) {
                Log.w(TAG, "dispatch $t failed", e)
            }
            if (GatewayConnection.forwarded(t, d)) uiSink?.onGatewayEvent(raw)
        }

        override fun onFatal(code: Int, reason: String) {
            uiSink?.onGatewayFatal(code, reason)
            if (code == 4004) {
                stop()
                tokens.clear()
                notifier.post("signed-out", "Signed out of Discord", "Open minicord to sign in again.", Notifier.CH_SUMMARY, null)
            }
        }

        override fun keepAwake(ms: Long) = this@MinicordRuntime.keepAwake(ms)

        override fun onHeartbeatScheduled(dueAtElapsed: Long) = scheduleHeartbeatAlarm(dueAtElapsed)
    }

    private fun onMessage(d: JSONObject) {
        val me = discord.meId
        if (me.isEmpty()) return
        val channelId = d.optString("channel_id")
        val info = discord.channels[channelId]
        val guildId = d.optString("guild_id").ifEmpty { info?.guildId }
        val isDM = guildId == null
        if (guildId != null && !d.has("guild_id")) d.put("guild_id", guildId)
        val mention = if (isDM) null else Mentions.classify(d, discord)
        val authorId = d.optJSONObject("author")?.optString("id") ?: ""
        val now = System.currentTimeMillis()
        val decision = Policy.decide(
            NotifyInput(
                config = rules,
                meId = me,
                authorId = authorId,
                isDM = isDM,
                guildId = guildId,
                mention = mention,
                mutedByDiscord = discord.mutedByDiscord(channelId, now),
                discordLevel = discord.notificationLevel(channelId),
                authorBlocked = authorId in discord.blocked,
                viewingChannel = uiForeground && viewingChannelId == channelId,
                now = now,
            ),
        )
        if (decision is Decision.None) return

        val author = discord.userNames[authorId] ?: "Someone"
        val title = when {
            isDM && info?.type == 3 -> "$author · ${discord.dmTitle(channelId)}"
            isDM -> author
            else -> "$author in #${info?.name ?: "channel"} · ${discord.guildNames[guildId] ?: ""}"
        }
        val route = when {
            isDM -> JSONObject().put("view", "dms").put("channelId", channelId)
            rules.modeOf(guildId) == "vault" -> JSONObject().put("view", "vault").put("guildId", guildId)
            else -> JSONObject().put("view", "server").put("guildId", guildId).put("channelId", channelId).put("anchor", d.optString("id"))
        }.toString()
        val body = preview(d)
        when (decision) {
            is Decision.Notify -> notifier.post("msg-${d.optString("id")}", title, body, if (isDM) Notifier.CH_DMS else Notifier.CH_MENTIONS, route)
            is Decision.Digest -> {
                val at = Policy.nextDigestTime(rules.digestTimes, now, java.time.ZoneId.systemDefault()) ?: now
                synchronized(held) { digest.add(Queued(title, body, route, at)) }
                scheduleFlush()
            }
            is Decision.Hold -> {
                synchronized(held) { held.add(Queued(title, body, route, decision.until)) }
                scheduleFlush()
            }
            is Decision.None -> Unit
        }
    }

    private fun onCall(d: JSONObject) {
        val channelId = d.optString("channel_id")
        val ringingIds = d.optJSONArray("ringing")?.strings()
            ?: d.optJSONObject("ongoing_rings")?.keys()?.asSequence()?.toSet()
            ?: emptySet()
        if (discord.meId in ringingIds) {
            if (ringing.add(channelId)) {
                val name = discord.dmTitle(channelId)
                notifier.post("call-$channelId", "$name is calling", "Tap to open minicord and join.", Notifier.CH_CALLS, JSONObject().put("view", "dms").put("channelId", channelId).toString())
            }
        } else {
            cancelCall(channelId)
        }
    }

    private fun cancelCall(channelId: String) {
        if (ringing.remove(channelId)) NotificationManagerCompat.from(app).cancel("call-$channelId", "call-$channelId".hashCode())
    }

    private val mentionPattern = Regex("<@!?(\\d+)>")
    private val channelPattern = Regex("<#(\\d+)>")
    private val rolePattern = Regex("<@&(\\d+)>")
    private val emojiPattern = Regex("<a?:(\\w+):\\d+>")
    private val markdownPattern = Regex("(\\*\\*|__|~~|\\|\\||`)")

    private fun preview(d: JSONObject): String {
        var text = d.optString("content", "")
        text = mentionPattern.replace(text) { "@" + (discord.userNames[it.groupValues[1]] ?: "someone") }
        text = channelPattern.replace(text) { "#" + (discord.channels[it.groupValues[1]]?.name ?: "channel") }
        text = rolePattern.replace(text, "@role")
        text = emojiPattern.replace(text) { ":${it.groupValues[1]}:" }
        text = markdownPattern.replace(text, "").replace(Regex("\\s+"), " ").trim()
        if (text.isEmpty()) {
            val attachments = d.optJSONArray("attachments")
            text = when {
                attachments != null && attachments.length() > 0 -> "📎 " + (attachments.optJSONObject(0)?.optString("filename") ?: "attachment")
                (d.optJSONArray("sticker_items")?.length() ?: 0) > 0 -> "[sticker]"
                else -> "…"
            }
        }
        return if (text.length > 200) text.take(199) + "…" else text
    }

    // ---- wakeups ----------------------------------------------------------------------

    private var wakeLock: PowerManager.WakeLock? = null

    @Synchronized
    fun keepAwake(ms: Long) {
        val lock = wakeLock ?: app.getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "minicord:gateway")
            .apply { setReferenceCounted(false) }
            .also { wakeLock = it }
        lock.acquire(ms)
    }

    private fun alarmIntent(action: String): PendingIntent =
        PendingIntent.getBroadcast(app, action.hashCode(), Intent(app, WakeReceiver::class.java).setAction(action), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    /** Heartbeats must go out even when the CPU is asleep; an allow-while-idle alarm wakes us for them. */
    private fun scheduleHeartbeatAlarm(dueAtElapsed: Long) {
        val am = app.getSystemService(AlarmManager::class.java)
        val pi = alarmIntent(ACTION_HEARTBEAT)
        val at = dueAtElapsed + 250
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
            am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi)
        } else {
            am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi)
        }
    }

    private fun scheduleFlush() {
        val next = synchronized(held) { (held + digest).minOfOrNull { it.until } }
        if (next == null) {
            cancelAlarm(ACTION_FLUSH)
            return
        }
        app.getSystemService(AlarmManager::class.java).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, alarmIntent(ACTION_FLUSH))
    }

    private fun cancelAlarm(action: String) {
        app.getSystemService(AlarmManager::class.java).cancel(alarmIntent(action))
    }
}
