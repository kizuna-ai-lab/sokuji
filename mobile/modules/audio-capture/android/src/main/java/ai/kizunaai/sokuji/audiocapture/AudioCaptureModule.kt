package ai.kizunaai.sokuji.audiocapture

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.nio.ByteBuffer
import java.nio.ByteOrder

class CaptureOptions : Record {
  @Field val echoCancellation: Boolean = false
  @Field val inputDeviceId: String? = null
}

// Capture and, on Android, the translation's playback (spec §5). A session's
// speech must not depend on the capture chain: the track opens first and stays.
class AudioCaptureModule : Module() {
  private var engine: CaptureEngine? = null
  private var track: SpeechTrack? = null

  private fun engine() = engine ?: CaptureEngine(
    appContext.reactContext ?: throw CodedException("the app context is gone"),
    { track },
    { frame -> sendEvent("audio", mapOf("bytes" to frame)) },
    { message -> sendEvent("stopped", mapOf("reason" to "error", "message" to message)) },
  ).also { engine = it }

  override fun definition() = ModuleDefinition {
    Name("AudioCapture")

    Events("audio", "stopped")

    AsyncFunction("startCapture") { options: CaptureOptions ->
      engine().start(options.echoCancellation, options.inputDeviceId)
    }

    AsyncFunction("stopCapture") {
      engine?.stop()
    }

    Function("listInputs") {
      engine().listInputs()
    }

    AsyncFunction("speechOpen") { sampleRate: Int ->
      track?.close()
      track = SpeechTrack(sampleRate).also { it.attachCanceller(engine?.canceller() ?: 0L) }
    }

    Function("speechWrite") { bytes: ByteArray, pan: String ->
      val pcm = ShortArray(bytes.size / 2)
      ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(pcm)
      track?.write(pcm, pan)
    }

    Function("speechStop") {
      track?.stop()
    }

    Function("speechQueuedSeconds") {
      track?.queuedSeconds() ?: 0.0
    }

    Function("speechHeld") {
      track?.held() ?: 0
    }

    AsyncFunction("speechClose") {
      track?.close()
      track = null
    }

    OnDestroy {
      engine?.stop()
      track?.close()
      track = null
    }
  }
}
