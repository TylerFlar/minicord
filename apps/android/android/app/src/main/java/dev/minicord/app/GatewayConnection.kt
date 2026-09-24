package dev.minicord.app

import android.os.SystemClock
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * Discord gateway client + replay host: the Kotlin mirror of GatewayClient and SessionHost in
 * packages/core. All state lives on one executor thread. Timers there don't advance while
 * the CPU sleeps, so the service's wake alarm calls [onWakeAlarm] to keep heartbeats honest.
 */
class GatewayConnection(
    private val token: String,
    private val props: ClientProperties,
    private val http: OkHttpClient,
    private val callbacks: Callbacks,
) {
    interface Callbacks {
        fun onStatus(status: String)
        fun onDispatch(t: String, raw: String, d: JSONObject)
        fun onFatal(code: Int, reason: String)
        /** Keep the CPU awake for a while (reconnecting in the background). */
        fun keepAwake(ms: Long)
        /** A heartbeat went out; the next one is due at this elapsedRealtime. */
        fun onHeartbeatScheduled(dueAtElapsed: Long)
    }

    private val executor = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "minicord-gateway").apply { isDaemon = true } }
    private var socket: WebSocket? = null
    private var generation = 0
    private var zlib = ZlibStream()
    private var seq: Long? = null
    private var sessionId: String? = null
    private var resumeUrl: String? = null
    private var heartbeatInterval = 41_250L
    private var awaitingAck = false
    private var lastHeartbeatAt = 0L
    private var stopped = false
    private var attempts = 0
    private var heartbeatTask: ScheduledFuture<*>? = null
    private var reconnectTask: ScheduledFuture<*>? = null
    private var timeSpentTask: ScheduledFuture<*>? = null

    @Volatile var status = "idle"
        private set

    // Replay (see SessionHost): READY + compacted backlog for UIs that attach later.
    private var ready: String? = null
    private var supplemental: String? = null
    private val backlog = ArrayDeque<String>()
    private val lastMessageIds = LinkedHashMap<String, String>()
    /** Latest presence per friend: replayed as a set, not as history. */
    private val friendPresences = LinkedHashMap<String, String>()
    private var overflowed = false
    private var meId: String? = null

    /** Run on the gateway thread; silently dropped once the connection is closed. */
    private fun post(block: () -> Unit) {
        try {
            executor.execute(block)
        } catch (_: RejectedExecutionException) {
        }
    }

    fun connect() = post {
        stopped = false
        open(false)
    }

    fun close(code: Int = 4000) = post {
        stopped = true
        clearTimers()
        socket?.close(code, "client shutdown")
        socket = null
        setStatus("closed")
        executor.shutdown()
    }

    fun send(op: Int, d: Any?) = post { sendNow(op, d) }

    /** Wake alarm: timers don't run while the CPU sleeps, so beat now if one is due. */
    fun onWakeAlarm() = post {
        if (socket != null && SystemClock.elapsedRealtime() - lastHeartbeatAt >= heartbeatInterval - 2_000) heartbeatTick()
        else if (socket == null && !stopped && reconnectTask == null) open(sessionId != null)
    }

    /** READY + backlog as one JSON document (raw payloads spliced in, never re-serialized). */
    fun snapshotJson(): String = executor.submit(Callable {
        if (overflowed) {
            overflowed = false
            ready = null
            resync()
        }
        val sb = StringBuilder(ready?.length?.plus(4096) ?: 256)
        sb.append("{\"status\":").append(JSONObject.quote(status))
        sb.append(",\"ready\":").append(ready ?: "null")
        sb.append(",\"supplemental\":").append(supplemental ?: "null")
        sb.append(",\"backlog\":[")
        backlog.forEachIndexed { i, e ->
            if (i > 0) sb.append(',')
            sb.append(e)
        }
        var wrote = backlog.isNotEmpty()
        if (lastMessageIds.isNotEmpty()) {
            if (wrote) sb.append(',')
            sb.append("{\"t\":\"MINICORD_CHANNEL_LAST_MESSAGES\",\"s\":null,\"d\":").append(JSONObject(lastMessageIds as Map<*, *>).toString()).append('}')
            wrote = true
        }
        for (p in friendPresences.values) {
            if (wrote) sb.append(',')
            sb.append(p)
            wrote = true
        }
        sb.append("]}")
        sb.toString()
    }).get(10, TimeUnit.SECONDS)

    private fun setStatus(value: String) {
        if (status == value) return
        status = value
        callbacks.onStatus(value)
    }

    private fun sendNow(op: Int, d: Any?) {
        socket?.send(JSONObject().put("op", op).put("d", d ?: JSONObject.NULL).toString())
    }

    private fun open(resume: Boolean) {
        clearTimers()
        val gen = ++generation
        val base = if (resume && resumeUrl != null) resumeUrl!! else "wss://gateway.discord.gg"
        val url = "${base.trimEnd('/')}/?encoding=json&v=9&compress=zlib-stream"
        zlib = ZlibStream()
        awaitingAck = false
        setStatus(if (attempts > 0) "reconnecting" else "connecting")
        val request = Request.Builder()
            .url(url)
            .header("Origin", "https://discord.com")
            .header("User-Agent", props.userAgent)
            .header("Accept-Language", "${props.locale},${props.locale.substringBefore('-')};q=0.9")
            .header("Cache-Control", "no-cache")
            .header("Pragma", "no-cache")
            .build()
        socket = http.newWebSocket(request, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                val data = bytes.toByteArray()
                post { if (gen == generation) zlib.push(data)?.let { handle(it, resume) } }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                post { if (gen == generation) handle(text, resume) }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, reason)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                post { if (gen == generation) onClose(code, reason) }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                post { if (gen == generation) onClose(response?.code ?: -1, t.message ?: "connection failed") }
            }
        })
    }

    private fun handle(text: String, resume: Boolean) {
        val payload = try {
            JSONObject(text)
        } catch (e: Exception) {
            Log.w(TAG, "bad payload", e)
            return
        }
        if (payload.has("s") && !payload.isNull("s")) seq = payload.getLong("s")
        when (payload.optInt("op", -1)) {
            10 -> {
                heartbeatInterval = payload.getJSONObject("d").getLong("heartbeat_interval")
                scheduleHeartbeat((heartbeatInterval * Math.random()).toLong())
                if (resume && sessionId != null) sendResume() else sendIdentify()
            }
            1 -> beat()
            11 -> awaitingAck = false
            7 -> restart(true, 0)
            9 -> {
                val resumable = payload.optBoolean("d", false)
                if (!resumable) {
                    sessionId = null
                    seq = null
                }
                restart(resumable, (1_000 + Math.random() * 4_000).toLong())
            }
            0 -> onDispatch(payload.optString("t"), text, payload.optJSONObject("d") ?: JSONObject())
        }
    }

    private fun onDispatch(t: String, raw: String, d: JSONObject) {
        when (t) {
            "READY" -> {
                sessionId = d.optString("session_id")
                resumeUrl = d.optString("resume_gateway_url").ifEmpty { null }
                attempts = 0
                meId = d.optJSONObject("user")?.optString("id")
                ready = raw
                supplemental = null
                backlog.clear()
                lastMessageIds.clear()
                friendPresences.clear()
                setStatus("ready")
                startTimeSpent()
                beat()
            }
            "READY_SUPPLEMENTAL" -> supplemental = raw
            "RESUMED" -> {
                attempts = 0
                setStatus("ready")
            }
            else -> record(t, raw, d)
        }
        callbacks.onDispatch(t, raw, d)
    }

    private fun record(t: String, raw: String, d: JSONObject) {
        if (ready == null || t in NOT_REPLAYED) return
        val guildId = d.optString("guild_id").ifEmpty { null }
        if (t == "PRESENCE_UPDATE") {
            val userId = d.optJSONObject("user")?.optString("id")?.ifEmpty { null } ?: d.optString("user_id").ifEmpty { null }
            if (guildId == null && userId != null) friendPresences[userId] = raw
            return
        }
        if (guildId != null && t == "MESSAGE_CREATE" && !concernsMe(d)) {
            val channelId = d.optString("channel_id")
            val id = d.optString("id")
            val prev = lastMessageIds[channelId]
            if (prev == null || id.toBigInteger() > prev.toBigInteger()) lastMessageIds[channelId] = id
            return
        }
        if (guildId != null && t in GUILD_MESSAGE_NOISE) return
        backlog.addLast(raw)
        if (backlog.size > MAX_BACKLOG) {
            overflowed = true
            backlog.clear()
        }
    }

    private fun concernsMe(d: JSONObject): Boolean {
        val me = meId ?: return true
        if (d.optJSONObject("author")?.optString("id") == me) return true
        if (d.optBoolean("mention_everyone")) return true
        if ((d.optJSONArray("mention_roles")?.length() ?: 0) > 0) return true
        if (d.optJSONObject("referenced_message")?.optJSONObject("author")?.optString("id") == me) return true
        val mentions = d.optJSONArray("mentions") ?: return false
        return (0 until mentions.length()).any { mentions.optJSONObject(it)?.optString("id") == me }
    }

    private fun sendIdentify() {
        setStatus("identifying")
        val d = JSONObject()
            .put("token", token)
            .put("capabilities", Identity.CAPABILITIES)
            .put("properties", props.gatewayProperties())
            .put("presence", JSONObject().put("status", "unknown").put("since", 0).put("activities", JSONArray()).put("afk", false))
            .put("compress", false)
            .put("client_state", JSONObject().put("guild_versions", JSONObject()))
        sendNow(2, d)
    }

    private fun sendResume() {
        setStatus("resuming")
        sendNow(6, JSONObject().put("token", token).put("session_id", sessionId).put("seq", seq ?: JSONObject.NULL))
    }

    private fun scheduleHeartbeat(delayMs: Long) {
        heartbeatTask?.cancel(false)
        heartbeatTask = executor.schedule({ heartbeatTick() }, delayMs, TimeUnit.MILLISECONDS)
        callbacks.onHeartbeatScheduled(SystemClock.elapsedRealtime() + delayMs)
    }

    private fun heartbeatTick() {
        if (socket == null) return
        if (awaitingAck) {
            Log.i(TAG, "heartbeat not acknowledged; reconnecting")
            restart(true, 0)
            return
        }
        beat()
        scheduleHeartbeat(heartbeatInterval)
    }

    private fun beat() {
        Log.d(TAG, "heartbeat seq=$seq focused=${props.focused}")
        awaitingAck = true
        lastHeartbeatAt = SystemClock.elapsedRealtime()
        val reasons = JSONArray().apply { if (props.focused) put("foregrounded") }
        sendNow(40, JSONObject().put("seq", seq ?: JSONObject.NULL).put("qos", JSONObject().put("ver", 31).put("active", props.focused).put("reasons", reasons)))
    }

    private fun startTimeSpent() {
        timeSpentTask?.cancel(false)
        val payload = {
            JSONObject()
                .put("initialization_timestamp", props.launchedAt)
                .put("session_id", props.heartbeatSessionId())
                .put("client_launch_id", props.launchId)
        }
        sendNow(41, payload())
        timeSpentTask = executor.scheduleWithFixedDelay({ sendNow(41, payload()) }, 30, 30, TimeUnit.MINUTES)
    }

    private fun onClose(code: Int, reason: String) {
        clearTimers()
        socket = null
        Log.i(TAG, "closed $code $reason")
        if (stopped) {
            setStatus("closed")
            return
        }
        if (code in FATAL_CLOSE_CODES) {
            stopped = true
            setStatus("closed")
            callbacks.onFatal(code, reason)
            return
        }
        if (code == 4007 || code == 4009) {
            sessionId = null
            seq = null
        }
        attempts += 1
        val backoff = (minOf(60_000.0, 1_000.0 * Math.pow(2.0, minOf(attempts - 1, 6).toDouble())) * (0.8 + Math.random() * 0.4)).toLong()
        setStatus("reconnecting")
        callbacks.keepAwake(backoff + 15_000)
        reconnectTask = executor.schedule({
            reconnectTask = null
            open(sessionId != null)
        }, backoff, TimeUnit.MILLISECONDS)
    }

    private fun restart(resume: Boolean, delayMs: Long) {
        clearTimers()
        val old = socket
        socket = null
        generation++
        old?.close(4000, "reconnecting")
        if (stopped) return
        setStatus("reconnecting")
        callbacks.keepAwake(delayMs + 15_000)
        reconnectTask = executor.schedule({
            reconnectTask = null
            open(resume && sessionId != null)
        }, delayMs, TimeUnit.MILLISECONDS)
    }

    private fun resync() {
        sessionId = null
        seq = null
        resumeUrl = null
        restart(false, 0)
    }

    private fun clearTimers() {
        heartbeatTask?.cancel(false)
        reconnectTask?.cancel(false)
        timeSpentTask?.cancel(false)
        heartbeatTask = null
        reconnectTask = null
        timeSpentTask = null
    }

    companion object {
        private const val TAG = "minicord.gateway"
        private const val MAX_BACKLOG = 20_000
        private val FATAL_CLOSE_CODES = setOf(4004, 4010, 4011, 4012, 4013, 4014)
        private val NOT_REPLAYED = setOf(
            "TYPING_START", "SESSIONS_REPLACE", "GUILD_MEMBER_LIST_UPDATE",
            "VOICE_CHANNEL_STATUS_UPDATE", "CONVERSATION_SUMMARY_UPDATE", "RESUMED",
        )
        private val GUILD_MESSAGE_NOISE = setOf(
            "MESSAGE_UPDATE", "MESSAGE_DELETE", "MESSAGE_DELETE_BULK", "MESSAGE_REACTION_ADD", "MESSAGE_REACTION_REMOVE",
            "MESSAGE_REACTION_REMOVE_ALL", "MESSAGE_REACTION_REMOVE_EMOJI",
        )

        /** Events the UI never uses; not worth crossing the bridge (same list as desktop). */
        private val NOT_FORWARDED = setOf("SESSIONS_REPLACE", "VOICE_CHANNEL_STATUS_UPDATE", "CONVERSATION_SUMMARY_UPDATE")

        /** Mirrors forwardToUi in packages/core: guild presence updates stay out of the WebView; friends' go through. */
        fun forwarded(t: String, d: JSONObject): Boolean {
            if (t in NOT_FORWARDED) return false
            if (t == "PRESENCE_UPDATE") return d.optString("guild_id").isEmpty()
            return true
        }
    }
}
