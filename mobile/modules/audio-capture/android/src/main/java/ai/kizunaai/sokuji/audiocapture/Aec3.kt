package ai.kizunaai.sokuji.audiocapture

// WebRTC's software echo canceller, for phones with no system one (D5). Frames
// are 10 ms at RATE; a render frame must be fed as it is written to the track.
object Aec3 {
  const val RATE = 16000

  init {
    System.loadLibrary("aec3")
  }

  external fun nativeCreate(rate: Int): Long
  external fun nativeDestroy(h: Long)
  external fun nativeSetDelayMs(h: Long, ms: Int)
  external fun nativeFeedRender(h: Long, pcm: ShortArray): Int
  external fun nativeProcess(h: Long, input: ShortArray, output: ShortArray): Int
  external fun nativeDelayEstimateMs(h: Long): Int
}
