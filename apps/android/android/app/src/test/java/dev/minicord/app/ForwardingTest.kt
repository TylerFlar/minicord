package dev.minicord.app

import org.json.JSONObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mirrors forwardToUi in packages/core (tested there too). */
class ForwardingTest {
    @Test
    fun friendsPresenceGoesThroughGuildPresenceDoesNot() {
        assertTrue(GatewayConnection.forwarded("PRESENCE_UPDATE", JSONObject("""{"user":{"id":"1"},"status":"online"}""")))
        assertFalse(GatewayConnection.forwarded("PRESENCE_UPDATE", JSONObject("""{"user":{"id":"1"},"guild_id":"2","status":"online"}""")))
    }

    @Test
    fun memberListsGoThroughNoiseDoesNot() {
        assertTrue(GatewayConnection.forwarded("GUILD_MEMBER_LIST_UPDATE", JSONObject("""{"guild_id":"2"}""")))
        assertFalse(GatewayConnection.forwarded("SESSIONS_REPLACE", JSONObject("{}")))
        assertTrue(GatewayConnection.forwarded("MESSAGE_CREATE", JSONObject("{}")))
    }
}
