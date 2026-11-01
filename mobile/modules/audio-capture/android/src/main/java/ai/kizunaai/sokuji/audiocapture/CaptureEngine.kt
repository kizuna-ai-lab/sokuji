package ai.kizunaai.sokuji.audiocapture

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTimestamp
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AudioEffect
import android.media.audiofx.NoiseSuppressor
import android.os.Process
import android.util.Log
import java.nio.ByteBuffer
import java.nio.ByteOrder

// The microphone as 100 ms frames of 16 kHz mono 16-bit PCM, through the
// vendor's echo canceller when the phone has one and WebRTC's when it does not.
class CaptureEngine(
  private val context: Context,
  private val speech: () -> SpeechTrack?,
  private val onFrame: (ByteArray) -> Unit,
  private val onError: (String) -> Unit,
) {
  private var record: AudioRecord? = null
  private var echo: AcousticEchoCanceler? = null
  private var noise: NoiseSuppressor? = null
  private var aec3 = 0L
  private var thread: Thread? = null
  @Volatile private var running = false

  @SuppressLint("MissingPermission")
  fun start(echoCancellation: Boolean, inputDeviceId: String?): Map<String, Any?> {
    stop()
    var implementor: String? = null
    var noiseOff: Boolean? = null
    var chain = "none"
    var made: AudioRecord? = null
    if (echoCancellation && !forceSoftware() && AcousticEchoCanceler.isAvailable()) {
      val candidate = newRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
      val effect = runCatching { AcousticEchoCanceler.create(candidate.audioSessionId) }.getOrNull()
      if (effect != null) {
        effect.enabled = true
        echo = effect
        made = candidate
        chain = "vendor"
        implementor = AudioEffect.queryEffects()
          ?.firstOrNull { it.type == AudioEffect.EFFECT_TYPE_AEC }?.implementor
        if (NoiseSuppressor.isAvailable()) {
          noise = NoiseSuppressor.create(candidate.audioSessionId)?.also {
            it.enabled = false
            noiseOff = !it.enabled
          }
        }
      } else {
        candidate.release()
      }
    }
    val source = made ?: newRecord(MediaRecorder.AudioSource.MIC)
    if (echoCancellation && chain == "none") {
      chain = "aec3"
      aec3 = try {
        openCanceller()
      } catch (e: IllegalStateException) {
        source.release()
        throw e
      }
      speech()?.attachCanceller(aec3)
    }
    if (inputDeviceId != null) {
      val device = audio().getDevices(AudioManager.GET_DEVICES_INPUTS).firstOrNull { it.id.toString() == inputDeviceId }
      if (device != null) source.setPreferredDevice(device) else Log.i(TAG, "input $inputDeviceId is gone, using the phone's microphone")
    }
    source.startRecording()
    record = source
    running = true
    thread = Thread({
      try {
        readLoop(source)
      } catch (e: Exception) {
        if (running) onError(e.message ?: "the microphone stopped")
      }
    }, "sokuji-capture").also { it.start() }
    Log.i(TAG, "chain $chain, implementor $implementor, noise off $noiseOff")
    return mapOf(
      "chain" to chain,
      "sampleRate" to RATE,
      "android" to mapOf("implementor" to implementor, "noiseSuppressionOff" to noiseOff, "seededDelayMs" to null),
    )
  }

  /** The software canceller while it runs, for a speech track that opens after the capture. */
  fun canceller(): Long = aec3

  fun stop() {
    running = false
    thread?.join()
    thread = null
    record?.let {
      runCatching { it.stop() }
      it.release()
    }
    record = null
    echo?.release()
    echo = null
    noise?.release()
    noise = null
    if (aec3 != 0L) {
      speech()?.attachCanceller(0L)
      Aec3.nativeDestroy(aec3)
      aec3 = 0L
    }
  }

  fun listInputs(): List<Map<String, String>> =
    audio().getDevices(AudioManager.GET_DEVICES_INPUTS).map {
      mapOf("id" to it.id.toString(), "name" to it.productName.toString(), "category" to category(it))
    }

  private fun category(device: AudioDeviceInfo) = when (device.type) {
    AudioDeviceInfo.TYPE_BUILTIN_MIC -> "Built-in Mic"
    AudioDeviceInfo.TYPE_WIRED_HEADSET -> "Wired Headset"
    AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_USB_ACCESSORY -> "USB"
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLE_HEADSET -> "Bluetooth"
    else -> "Other"
  }

  // One silent frame each way: the canceller says here, not mid-session, if it refuses its format.
  private fun openCanceller(): Long {
    val handle = Aec3.nativeCreate(Aec3.RATE)
    val silence = ShortArray(TEN_MS)
    val render = Aec3.nativeFeedRender(handle, silence)
    val capture = Aec3.nativeProcess(handle, silence, ShortArray(TEN_MS))
    if (render != 0 || capture != 0) {
      Aec3.nativeDestroy(handle)
      throw IllegalStateException("the echo canceller refused its format: $render, $capture")
    }
    return handle
  }

  private fun audio() = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  @SuppressLint("MissingPermission")
  private fun newRecord(source: Int): AudioRecord {
    val min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    val made = AudioRecord(source, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, min * 4)
    if (made.state != AudioRecord.STATE_INITIALIZED) {
      made.release()
      throw IllegalStateException("the microphone did not open")
    }
    return made
  }

  private fun readLoop(source: AudioRecord) {
    Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
    val input = ShortArray(TEN_MS)
    val output = ShortArray(TEN_MS)
    val bytes = ByteBuffer.allocate(FRAME * 2).order(ByteOrder.LITTLE_ENDIAN)
    var seeded = aec3 == 0L
    var count = 0
    var processNs = 0L
    while (running) {
      val n = source.read(input, 0, TEN_MS)
      if (n < 0) {
        if (running) onError("the microphone stopped: $n")
        return
      }
      if (n != TEN_MS) continue
      if (aec3 != 0L) {
        val started = System.nanoTime()
        Aec3.nativeProcess(aec3, input, output)
        processNs += System.nanoTime() - started
        count++
        if (!seeded && count == SEED_AFTER) seeded = seedDelay(source)
        if (count % LOG_EVERY == 0) {
          Log.i(TAG, "aec3 ${processNs / count / 1000} us per frame, delay ${Aec3.nativeDelayEstimateMs(aec3)} ms")
        }
      } else {
        System.arraycopy(input, 0, output, 0, TEN_MS)
      }
      for (sample in output) bytes.putShort(sample)
      if (!bytes.hasRemaining()) {
        onFrame(bytes.array().copyOf())
        bytes.clear()
      }
    }
  }

  private fun seedDelay(source: AudioRecord): Boolean {
    val output = speech()?.outputLatencyMs() ?: return false
    val stamp = AudioTimestamp()
    val input = if (source.getTimestamp(stamp, AudioTimestamp.TIMEBASE_MONOTONIC) == AudioRecord.SUCCESS) {
      ((System.nanoTime() - stamp.nanoTime) / 1_000_000L).toInt().coerceAtLeast(0)
    } else {
      0
    }
    Aec3.nativeSetDelayMs(aec3, output + input)
    Log.i(TAG, "seeded delay ${output + input} ms")
    return true
  }

  // `adb shell setprop debug.sokuji.aec3 1`: the software chain on a phone that has a vendor one.
  @SuppressLint("PrivateApi")
  private fun forceSoftware(): Boolean = runCatching {
    Class.forName("android.os.SystemProperties").getMethod("get", String::class.java).invoke(null, "debug.sokuji.aec3") == "1"
  }.getOrDefault(false)

  companion object {
    const val RATE = 16000
    private const val TEN_MS = RATE / 100
    private const val FRAME = RATE / 10
    private const val SEED_AFTER = 100
    private const val LOG_EVERY = 500
    private const val TAG = "AudioCapture"
  }
}
