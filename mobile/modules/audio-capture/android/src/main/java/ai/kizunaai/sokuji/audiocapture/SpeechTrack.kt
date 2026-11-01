package ai.kizunaai.sokuji.audiocapture

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTimestamp
import android.media.AudioTrack
import android.os.Process
import android.util.Log
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
  private val dropping = AtomicBoolean(false)
  private val queuedFrames = AtomicInteger(0)
  private val aecLock = Any()
  private var aecHandle = 0L
  private val frame = rate / 100
  private val reference = ShortArray(Aec3.RATE / 100)
  private var framesWritten = 0L
  @Volatile private var track: AudioTrack
  private val writer: Thread

  init {
    track = newTrack()
    track.play()
    writer = Thread({ writeLoop() }, "sokuji-speech")
    writer.start()
  }

  private fun newTrack(): AudioTrack {
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
    return AudioTrack(attributes, format, size, AudioTrack.MODE_STREAM, AudioManager.AUDIO_SESSION_ID_GENERATE)
  }

  fun attachCanceller(handle: Long) {
    synchronized(aecLock) { aecHandle = handle }
  }

  fun write(pcm: ShortArray, pan: String) {
    queuedFrames.addAndGet(pcm.size)
    queue.put(Chunk(pcm, pan))
  }

  /** The sentence ends now, with what the track already holds: it must not outlast its route. */
  fun stop() {
    dropping.set(true)
  }

  fun queuedSeconds(): Double = queuedFrames.get().coerceAtLeast(0).toDouble() / rate

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
    writer.join(1000)
  }

  private fun writeLoop() {
    Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
    val mono = ShortArray(frame)
    val stereo = ShortArray(frame * 2)
    var current: Chunk? = null
    var offset = 0
    var refused = false
    while (running.get()) {
      if (dropping.getAndSet(false)) {
        current = null
        queue.clear()
        queuedFrames.set(0)
        runCatching {
          track.pause()
          track.flush()
          track.play()
        }
        synchronized(this) { framesWritten = 0 }
      }
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
        if (aecHandle != 0L) {
          // The canceller takes one rate on both sides. As a reference, linear interpolation is enough.
          for (i in reference.indices) {
            val at = i * frame / reference.size
            val rest = i * frame % reference.size
            val next = mono[minOf(at + 1, frame - 1)]
            reference[i] = (mono[at] + (next - mono[at]) * rest / reference.size).toShort()
          }
          val status = Aec3.nativeFeedRender(aecHandle, reference)
          if ((status != 0) != refused) {
            refused = status != 0
            Log.w("AudioCapture", "aec3 render status $status")
          }
        }
      }
      write(stereo)
    }
    // Here, not in close(): only this thread may still be rebuilding the track.
    runCatching { track.stop() }
    track.release()
  }

  private fun write(stereo: ShortArray) {
    var offset = 0
    while (offset < stereo.size && running.get()) {
      val wrote = track.write(stereo, offset, stereo.size - offset)
      if (wrote < 0) {
        // Dead after an audioserver restart: a new track, unhurried, or this spins at audio priority.
        Log.w("AudioCapture", "speech track write failed: $wrote")
        Thread.sleep(REBUILD_WAIT_MS)
        runCatching {
          track.release()
          track = newTrack().also { it.play() }
        }
        synchronized(this) { framesWritten = 0 }
        return
      }
      if (wrote == 0) Thread.sleep(SHORT_WRITE_WAIT_MS)
      offset += wrote
      synchronized(this) { framesWritten += wrote / 2 }
    }
  }

  private companion object {
    const val REBUILD_WAIT_MS = 200L
    const val SHORT_WRITE_WAIT_MS = 5L
  }
}
