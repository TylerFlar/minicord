package dev.minicord.app

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(MinicordPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
