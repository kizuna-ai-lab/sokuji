package ai.kizunaai.sokuji.audiocapture

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTimestamp
import android.media.AudioTrack
import android.os.Process
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

// The translation's player. Everything that reaches the speaker goes through
// here so the software canceller sees it the moment it is written. The track
// keeps running on silence between sentences: the canceller's delay estimate
// survives a gap only if the render side never stops (spec §4.2).
class SpeechTrack(private val rate: Int) {
  private class Chunk(val pcm: ShortArray, val pan: String)

  private val queue = LinkedBlockingQueue<Chunk>()
  private val running = AtomicBoolean(true)
  private val queuedFrames = AtomicInteger(0)
  private val aecLock = Any()
  private var aecHandle = 0L
  private val frame = rate / 100
  private var framesWritten = 0L
  private val track: AudioTrack
  private val writer: Thread

  init {
    val format = AudioFormat.Builder()
      .setSampleRate(rate)
      .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
      .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
      .build()
    val attributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_MEDIA)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .build()
    val size = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT)
    track = AudioTrack(attributes, format, size, AudioTrack.MODE_STREAM, AudioManager.AUDIO_SESSION_ID_GENERATE)
    track.play()
    writer = Thread({ writeLoop() }, "sokuji-speech")
    writer.start()
  }

  fun attachCanceller(handle: Long) {
    synchronized(aecLock) { aecHandle = handle }
  }

  fun write(pcm: ShortArray, pan: String) {
    queuedFrames.addAndGet(pcm.size)
    queue.put(Chunk(pcm, pan))
  }

  fun stop() {
    queue.clear()
    queuedFrames.set(0)
  }

  fun queuedSeconds(): Double = queuedFrames.get().toDouble() / rate

  fun held(): Int = queue.size

  /** Milliseconds between a frame's write and its reaching the speaker, once the track reports it. */
  fun outputLatencyMs(): Int? {
    val stamp = AudioTimestamp()
    if (!track.getTimestamp(stamp)) return null
    val played = stamp.framePosition + (System.nanoTime() - stamp.nanoTime) * rate / 1_000_000_000L
    return ((synchronized(this) { framesWritten } - played) * 1000 / rate).toInt().coerceAtLeast(0)
  }

  fun close() {
    running.set(false)
    writer.join()
    track.stop()
    track.release()
  }

  private fun writeLoop() {
    Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
    val mono = ShortArray(frame)
    val stereo = ShortArray(frame * 2)
    var current: Chunk? = null
    var offset = 0
    while (running.get()) {
      var filled = 0
      var pan = "both"
      while (filled < frame) {
        val chunk = current ?: queue.poll()?.also { current = it; offset = 0 } ?: break
        pan = chunk.pan
        val n = minOf(frame - filled, chunk.pcm.size - offset)
        System.arraycopy(chunk.pcm, offset, mono, filled, n)
        filled += n
        offset += n
        queuedFrames.addAndGet(-n)
        if (offset == chunk.pcm.size) current = null
      }
      mono.fill(0, filled, frame)
      for (i in 0 until frame) {
        stereo[i * 2] = if (pan == "right") 0 else mono[i]
        stereo[i * 2 + 1] = if (pan == "left") 0 else mono[i]
      }
      synchronized(aecLock) {
        if (aecHandle != 0L) Aec3.nativeFeedRender(aecHandle, mono)
      }
      track.write(stereo, 0, stereo.size)
      synchronized(this) { framesWritten += frame }
    }
  }
}
