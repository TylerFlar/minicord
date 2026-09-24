package dev.minicord.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** The Discord token, encrypted with a non-exportable AES key in the Android Keystore. */
class TokenStore(context: Context) {
    private val prefs = context.getSharedPreferences("minicord_secure", Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        return generator.generateKey()
    }

    fun save(token: String) {
        val cipher = Cipher.getInstance(TRANSFORM).apply { init(Cipher.ENCRYPT_MODE, key()) }
        val sealed = cipher.iv + cipher.doFinal(token.toByteArray())
        prefs.edit().putString(PREF, Base64.encodeToString(sealed, Base64.NO_WRAP)).apply()
    }

    fun load(): String? = try {
        val sealed = Base64.decode(prefs.getString(PREF, null) ?: return null, Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORM).apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed, 0, 12)) }
        String(cipher.doFinal(sealed, 12, sealed.size - 12))
    } catch (_: Exception) {
        null
    }

    fun clear() {
        prefs.edit().remove(PREF).apply()
    }

    private companion object {
        const val ALIAS = "minicord_token"
        const val PREF = "token"
        const val TRANSFORM = "AES/GCM/NoPadding"
    }
}

/** JSON values by key, shared by the UI (storage.load/save) and the background service (rules). */
class StateStore(context: Context) {
    private val prefs = context.getSharedPreferences("minicord_state", Context.MODE_PRIVATE)

    fun load(key: String): String? = prefs.getString(key, null)

    fun save(key: String, json: String) {
        prefs.edit().putString(key, json).apply()
    }
}
