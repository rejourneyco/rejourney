package co.rejourney.rejourney

import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import org.mockito.Mockito
import kotlin.test.Test

internal class RejourneyPluginTest {
    @Test
    fun onMethodCall_beforeAttachment_returnsStructuredError() {
        val plugin = RejourneyPlugin()
        val call = MethodCall("start", null)
        val mockResult: MethodChannel.Result = Mockito.mock(MethodChannel.Result::class.java)

        plugin.onMethodCall(call, mockResult)

        Mockito.verify(mockResult).error(
            "not_attached",
            "Rejourney plugin is not attached",
            null
        )
        Mockito.verifyNoMoreInteractions(mockResult)
    }
}
