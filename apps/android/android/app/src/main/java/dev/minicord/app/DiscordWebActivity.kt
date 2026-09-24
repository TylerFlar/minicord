package dev.minicord.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.addCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONArray

/**
 * Discord's own web client, used for exactly two things: signing in (captcha and 2FA are
 * Discord's problem; we pick the token up from the page's own requests) and calls (voice
 * and video, DAVE included, without minicord implementing any of it).
 */
class DiscordWebActivity : AppCompatActivity() {
    companion object {
        const val EXTRA_MODE = "mode"
        const val EXTRA_PATH = "path"
        const val RESULT_TOKEN = "token"
        private const val REQ_MEDIA = 7
        private val TOKEN_SHAPE = Regex("^[\\w-]{20,}\\.[\\w-]{4,}\\.[\\w-]{20,}$")
        private val DISCORD_HOSTS = listOf("discord.com", "discord.gg", "discordapp.com", "discordapp.net", "hcaptcha.com")

        /** Keep the call window a call window. */
        private const val CALL_CSS = "nav[aria-label=\"Servers sidebar\"], [data-list-id=\"guildsnav\"] { display: none !important; }"

        /** Fallback token pickup: the web client keeps it in localStorage (hidden from window, reachable via an iframe). */
        private const val READ_TOKEN_JS =
            "(function(){try{var f=document.createElement('iframe');f.style.display='none';document.body.appendChild(f);" +
                "var t=f.contentWindow.localStorage.getItem('token');f.remove();return t;}catch(e){return null;}})()"
    }

    private lateinit var web: WebView
    private var mode = "login"
    private var done = false
    private var pendingPermission: PermissionRequest? = null
    private val handler = Handler(Looper.getMainLooper())

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        mode = intent.getStringExtra(EXTRA_MODE) ?: "login"
        web = WebView(this)
        // Android 15+ draws apps edge to edge. A WebView ignores its own padding when it draws, so the
        // system bars are kept clear by a frame around it, where the dark theme's background shows.
        val frame = FrameLayout(this).apply {
            addView(web, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        }
        setContentView(frame)
        ViewCompat.setOnApplyWindowInsetsListener(frame) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        // No translucent scrim over the frame behind 3-button navigation.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) window.isNavigationBarContrastEnforced = false
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            // Desktop Chrome UA: the same identity the rest of minicord presents.
            userAgentString = Identity.userAgent(Identity.chromeMajor(this@DiscordWebActivity))
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (mode == "login" && !done && request.url.host == "discord.com" && request.url.path?.startsWith("/api/") == true) {
                    val auth = request.requestHeaders["Authorization"] ?: request.requestHeaders["authorization"]
                    if (auth != null && TOKEN_SHAPE.matches(auth)) runOnUiThread { finishWithToken(auth) }
                }
                return null
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val host = request.url.host ?: return false
                if (DISCORD_HOSTS.any { host == it || host.endsWith(".$it") }) return false
                startActivity(Intent(Intent.ACTION_VIEW, request.url))
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (mode == "call") {
                    view.evaluateJavascript(
                        "(function(){var s=document.createElement('style');s.textContent=${JSONArray().put(CALL_CSS).toString().removeSurrounding("[", "]")};document.head.appendChild(s);})()",
                        null,
                    )
                }
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread { handlePermission(request) }
            }
        }

        val path = intent.getStringExtra(EXTRA_PATH) ?: if (mode == "login") "/login" else "/channels/@me"
        web.loadUrl("https://discord.com$path")
        if (mode == "login") pollForToken()

        onBackPressedDispatcher.addCallback(this) {
            if (mode == "login" && web.canGoBack()) web.goBack() else finish()
        }
    }

    private fun granted(permission: String) = ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun handlePermission(request: PermissionRequest) {
        val wanted = request.resources.filter { it == PermissionRequest.RESOURCE_AUDIO_CAPTURE || it == PermissionRequest.RESOURCE_VIDEO_CAPTURE }
        if (wanted.isEmpty()) return request.deny()
        val needed = buildList {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE in wanted && !granted(Manifest.permission.RECORD_AUDIO)) add(Manifest.permission.RECORD_AUDIO)
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE in wanted && !granted(Manifest.permission.CAMERA)) add(Manifest.permission.CAMERA)
        }
        if (needed.isEmpty()) {
            request.grant(wanted.toTypedArray())
        } else {
            pendingPermission = request
            ActivityCompat.requestPermissions(this, needed.toTypedArray(), REQ_MEDIA)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        val request = pendingPermission ?: return
        pendingPermission = null
        val allowed = request.resources.filter {
            (it == PermissionRequest.RESOURCE_AUDIO_CAPTURE && granted(Manifest.permission.RECORD_AUDIO)) ||
                (it == PermissionRequest.RESOURCE_VIDEO_CAPTURE && granted(Manifest.permission.CAMERA))
        }
        if (allowed.isEmpty()) request.deny() else request.grant(allowed.toTypedArray())
    }

    private fun pollForToken() {
        if (done || isFinishing) return
        web.evaluateJavascript(READ_TOKEN_JS) { result ->
            // evaluateJavascript JSON-encodes the result, and the web client JSON-encodes the token too.
            val stored = runCatching { JSONArray("[$result]").optString(0) }.getOrNull()
            val token = stored?.takeIf { it.isNotEmpty() && it != "null" }?.let { runCatching { JSONArray("[$it]").optString(0) }.getOrNull() }
            if (token != null && TOKEN_SHAPE.matches(token)) finishWithToken(token) else handler.postDelayed({ pollForToken() }, 1_500)
        }
    }

    private fun finishWithToken(token: String) {
        if (done) return
        done = true
        setResult(RESULT_OK, Intent().putExtra(RESULT_TOKEN, token))
        finish()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        web.destroy()
        super.onDestroy()
    }
}
