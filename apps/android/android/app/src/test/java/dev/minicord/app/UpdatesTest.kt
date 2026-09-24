package dev.minicord.app

import org.junit.Assert.assertEquals
import org.junit.Test

class UpdatesTest {
    @Test
    fun comparesVersionsNumerically() {
        assertEquals(1, Updates.compare("0.10.0", "0.9.3"))
        assertEquals(0, Updates.compare("1.2.0", "1.2"))
        assertEquals(-1, Updates.compare("0.1.0", "0.1.1"))
        assertEquals(0, Updates.compare("0.2.0-beta.1", "0.2.0"))
    }
}
