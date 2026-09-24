package dev.minicord.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlarmManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.webkit.CookieManager
import android.webkit.WebStorage
import androidx.activity.result.ActivityResult
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors

/**
 * The bridge the UI's Capacitor platform adapter talks to (packages/ui/src/platform/capacitor.ts).
 * Same surface as the Electron IPC: auth, session attach/send/request, storage, shell.
 */
@CapacitorPlugin(name = "Minicord")
class MinicordPlugin : Plugin(), MinicordRuntime.UiSink {
    private val io = Executors.newCachedThreadPool()

    override fun load() {
        MinicordRuntime.init(context)
        val debuggable = (context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
        activity?.intent?.takeIf { debuggable && it.getBooleanExtra("minicord_readonly", false) }?.let {
            MinicordRuntime.readOnly = true
            MinicordRuntime.writeChannels = it.getStringExtra("minicord_write_channels")?.split(",")?.map(String::trim)?.filter(String::isNotEmpty)?.toSet() ?: emptySet()
        }
        if (MinicordRuntime.hasToken()) GatewayService.start(context)
        deliverRoute(activity?.intent)
    }

    override fun handleOnResume() {
        MinicordRuntime.setForeground(true)
    }

    override fun handleOnPause() {
        MinicordRuntime.setForeground(false)
    }

    override fun handleOnNewIntent(intent: Intent) {
        super.handleOnNewIntent(intent)
        deliverRoute(intent)
    }

    override fun handleOnDestroy() {
        if (MinicordRuntime.uiSink === this) MinicordRuntime.uiSink = null
        super.handleOnDestroy()
    }

    /** A tapped notification carries a UI route; hand it to JS (retained until a listener exists). */
    private fun deliverRoute(intent: Intent?) {
        val route = intent?.getStringExtra(Notifier.EXTRA_ROUTE) ?: return
        intent.removeExtra(Notifier.EXTRA_ROUTE)
        notifyListeners("notificationClick", JSObject().put("route", route), true)
    }

    // ---- MinicordRuntime.UiSink ---------------------------------------------------------

    override fun onGatewayEvent(raw: String) = notifyListeners("gatewayEvent", JSObject().put("raw", raw))

    override fun onGatewayStatus(status: String) = notifyListeners("gatewayStatus", JSObject().put("status", status))

    override fun onGatewayFatal(code: Int, reason: String) = notifyListeners("gatewayFatal", JSObject().put("code", code).put("reason", reason))

    // ---- auth ---------------------------------------------------------------------------

    @PluginMethod
    fun authStatus(call: PluginCall) {
        call.resolve(JSObject().put("loggedIn", MinicordRuntime.hasToken()))
    }

    @PluginMethod
    fun loginWithToken(call: PluginCall) {
        val token = call.getString("token")?.trim() ?: return call.reject("token required")
        io.execute {
            val ok = MinicordRuntime.validateToken(token)
            if (ok) {
                MinicordRuntime.saveToken(token)
                GatewayService.start(context)
            }
            call.resolve(JSObject().put("ok", ok))
        }
    }

    @PluginMethod
    fun loginWithDiscord(call: PluginCall) {
        val intent = Intent(context, DiscordWebActivity::class.java).putExtra(DiscordWebActivity.EXTRA_MODE, "login")
        startActivityForResult(call, intent, "onLoginResult")
    }

    @ActivityCallback
    private fun onLoginResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val token = result.data?.getStringExtra(DiscordWebActivity.RESULT_TOKEN)
        if (result.resultCode == Activity.RESULT_OK && token != null) {
            MinicordRuntime.saveToken(token)
            GatewayService.start(context)
            call.resolve(JSObject().put("ok", true))
        } else {
            call.resolve(JSObject().put("ok", false))
        }
    }

    /** Forget the session locally (never calls Discord's logout, which would kill the token everywhere). */
    @PluginMethod
    fun logout(call: PluginCall) {
        MinicordRuntime.signOut()
        WebStorage.getInstance().deleteOrigin("https://discord.com")
        CookieManager.getInstance().removeAllCookies(null)
        call.resolve()
    }

    // ---- session ------------------------------------------------------------------------

    @PluginMethod
    fun attach(call: PluginCall) {
        MinicordRuntime.uiSink = this
        io.execute {
            try {
                val path = MinicordRuntime.writeSnapshot()
                call.resolve(JSObject().put("path", path ?: ""))
            } catch (e: Exception) {
                call.reject("attach failed: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun send(call: PluginCall) {
        val op = call.getInt("op") ?: return call.reject("op required")
        MinicordRuntime.send(op, call.data.opt("d"))
        call.resolve()
    }

    @PluginMethod
    fun request(call: PluginCall) {
        val method = call.getString("method") ?: return call.reject("method required")
        val path = call.getString("path") ?: return call.reject("path required")
        val opts: JSONObject = call.getObject("opts") ?: JSObject()
        io.execute {
            if (!MinicordRuntime.writeAllowed(method, path)) {
                call.resolve(JSObject().put("status", 0).put("error", "Read-only mode: blocked $method $path"))
                return@execute
            }
            val rest = MinicordRuntime.rest
            if (rest == null) {
                call.resolve(JSObject().put("status", 0).put("error", "Not connected"))
                return@execute
            }
            try {
                val result = rest.request(method, path, opts)
                call.resolve(JSObject().put("status", result.status).put("body", result.body))
            } catch (e: Exception) {
                call.resolve(JSObject().put("status", 0).put("error", e.message ?: "request failed"))
            }
        }
    }

    /** PUT file bytes to a signed Discord upload URL (bytes arrive base64-encoded over the bridge). */
    @PluginMethod
    fun upload(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("url required")
        val data = call.getString("data") ?: return call.reject("data required")
        if (!Regex("""^https://[\w.-]+\.(googleapis\.com|discord\.com|discordapp\.net)/""").containsMatchIn(url)) return call.reject("unexpected upload host")
        io.execute {
            try {
                val bytes = android.util.Base64.decode(data, android.util.Base64.DEFAULT)
                call.resolve(JSObject().put("status", MinicordRuntime.upload(url, bytes)))
            } catch (e: Exception) {
                call.resolve(JSObject().put("status", 0).put("error", e.message))
            }
        }
    }

    @PluginMethod
    fun setFocused(call: PluginCall) {
        MinicordRuntime.setForeground(call.getBoolean("focused", false) == true)
        call.resolve()
    }

    @PluginMethod
    fun setViewing(call: PluginCall) {
        MinicordRuntime.viewingChannelId = call.getString("channelId")
        call.resolve()
    }

    // ---- storage ------------------------------------------------------------------------

    @PluginMethod
    fun storageLoad(call: PluginCall) {
        val key = call.getString("key") ?: return call.reject("key required")
        call.resolve(JSObject().put("value", MinicordRuntime.state.load(key) ?: ""))
    }

    @PluginMethod
    fun storageSave(call: PluginCall) {
        val key = call.getString("key") ?: return call.reject("key required")
        MinicordRuntime.state.save(key, call.getString("value") ?: "null")
        if (key == "rules") MinicordRuntime.reloadRules()
        call.resolve()
    }

    // ---- shell --------------------------------------------------------------------------

    @PluginMethod
    fun notify(call: PluginCall) {
        val channel = if (call.getBoolean("urgent", false) == true) Notifier.CH_CALLS else Notifier.CH_EVENTS
        MinicordRuntime.notifier.post(
            call.getString("id") ?: UUID.randomUUID().toString(),
            call.getString("title") ?: "minicord",
            call.getString("body") ?: "",
            channel,
            call.getObject("route")?.toString(),
        )
        call.resolve()
    }

    @PluginMethod
    fun openExternal(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("url required")
        if (url.startsWith("http://") || url.startsWith("https://")) {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        call.resolve()
    }

    @PluginMethod
    fun openDiscord(call: PluginCall) {
        val path = call.getString("path") ?: "/channels/@me"
        val intent = Intent(context, DiscordWebActivity::class.java)
            .putExtra(DiscordWebActivity.EXTRA_MODE, "call")
            .putExtra(DiscordWebActivity.EXTRA_PATH, path)
        activity?.startActivity(intent)
        call.resolve()
    }

    @PluginMethod
    fun hide(call: PluginCall) {
        activity?.moveTaskToBack(true)
        call.resolve()
    }

    @PluginMethod
    fun appInfo(call: PluginCall) {
        call.resolve(JSObject().put("version", BuildConfig.VERSION_NAME))
    }

    @PluginMethod
    fun checkForUpdate(call: PluginCall) {
        io.execute { call.resolve(JSObject.fromJSONObject(Updates.check(BuildConfig.VERSION_NAME))) }
    }

    /** Downloads the latest release's APK (looked up here, not taken from the UI) and opens the installer. */
    @PluginMethod
    fun installUpdate(call: PluginCall) {
        io.execute {
            try {
                val status = Updates.check(BuildConfig.VERSION_NAME)
                if (status.optString("state") != "available") return@execute call.reject(status.optString("message", "no update"))
                Updates.install(context, Updates.download(context, status))
                call.resolve()
            } catch (e: Exception) {
                call.reject(e.message ?: "download failed")
            }
        }
    }

    @PluginMethod
    fun permissionStatus(call: PluginCall) {
        call.resolve(permissions())
    }

    /** Notifications permission (Android 13+) and the battery exemption that keeps the connection alive. */
    @SuppressLint("BatteryLife")
    @PluginMethod
    fun requestAppPermissions(call: PluginCall) {
        val act = activity
        if (act != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(act, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 11)
        } else if (!context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName)) {
            context.startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }
        call.resolve(permissions())
    }

    private fun permissions(): JSObject {
        val notifications = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        val battery = context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName)
        val exactAlarms = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()
        return JSObject().put("notifications", notifications).put("batteryUnrestricted", battery).put("exactAlarms", exactAlarms)
    }
}
