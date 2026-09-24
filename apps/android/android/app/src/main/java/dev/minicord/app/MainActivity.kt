package dev.minicord.app

import android.os.Bundle
import androidx.core.content.ContextCompat
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(MinicordPlugin::class.java)
        super.onCreate(savedInstanceState)
        // Until the UI paints, show its background for the current theme (no light flash at night).
        bridge.webView.setBackgroundColor(ContextCompat.getColor(this, R.color.minicord_background))
    }
}
