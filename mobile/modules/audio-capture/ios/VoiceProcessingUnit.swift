import AudioToolbox
import AVFoundation
import Foundation
import os

// The microphone as 16 kHz mono 16-bit frames. With echo cancellation, a
// VoiceProcessingIO unit: its output bus must run, so it renders silence, and
// the speech plays elsewhere (the library's engine) as "other audio", which is
// cancelled without gating the microphone. Without it, a plain RemoteIO input.
final class VoiceProcessingUnit {
  static let sampleRate: Double = 16000
  static let frameSamples = 1600
  // About half a second of callbacks: a route change fails a few on its own.
  private static let renderFailuresAllowed = 50
  private static let drainInterval = DispatchTimeInterval.milliseconds(50)

  private let onFrame: (Data) -> Void
  private let onFailure: (String) -> Void
  private let queue = DispatchQueue(label: "ai.kizunaai.sokuji.audiocapture")
  private var unit: AudioUnit?
  private var drain: DispatchSourceTimer?
  // On `queue`: a failing unit is reported once, not on every drain.
  private var reported = false

  // The render callback may not allocate or wait, so it hands samples over
  // through a ring. It writes ahead of `published` and moves that on when the
  // lock is free; a busy lock only delays the samples to its next call.
  private static let ringSamples = VoiceProcessingUnit.frameSamples * 32
  private let ring = UnsafeMutablePointer<Int16>.allocate(capacity: VoiceProcessingUnit.ringSamples)
  private let scratch = UnsafeMutablePointer<Int16>.allocate(capacity: 8192)
  private let lock = UnsafeMutablePointer<os_unfair_lock>.allocate(capacity: 1)
  // Render thread only.
  private var written = 0
  private var consumedSeen = 0
  private var renderFailures = 0
  // Under the lock. Monotonic sample counts; a ring position is the count modulo its size.
  private var published = 0
  private var consumed = 0
  private var failure: OSStatus = noErr

  init(onFrame: @escaping (Data) -> Void, onFailure: @escaping (String) -> Void) {
    self.onFrame = onFrame
    self.onFailure = onFailure
    lock.initialize(to: os_unfair_lock())
  }

  deinit {
    stop()
    ring.deallocate()
    scratch.deallocate()
    lock.deallocate()
  }

  func start(echoCancellation: Bool) throws {
    var description = AudioComponentDescription(
      componentType: kAudioUnitType_Output,
      componentSubType: echoCancellation ? kAudioUnitSubType_VoiceProcessingIO : kAudioUnitSubType_RemoteIO,
      componentManufacturer: kAudioUnitManufacturer_Apple,
      componentFlags: 0,
      componentFlagsMask: 0
    )
    var created: AudioUnit?
    guard let component = AudioComponentFindNext(nil, &description),
      AudioComponentInstanceNew(component, &created) == noErr, let unit = created
    else { throw CaptureError.unitUnavailable }
    self.unit = unit

    var on: UInt32 = 1
    var output: UInt32 = echoCancellation ? 1 : 0
    try check(AudioUnitSetProperty(unit, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Input, 1, &on, 4))
    try check(AudioUnitSetProperty(unit, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Output, 0, &output, 4))

    var format = AudioStreamBasicDescription(
      mSampleRate: Self.sampleRate,
      mFormatID: kAudioFormatLinearPCM,
      mFormatFlags: kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked,
      mBytesPerPacket: 2,
      mFramesPerPacket: 1,
      mBytesPerFrame: 2,
      mChannelsPerFrame: 1,
      mBitsPerChannel: 16,
      mReserved: 0
    )
    let formatSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
    try check(AudioUnitSetProperty(unit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output, 1, &format, formatSize))
    let me = Unmanaged.passUnretained(self).toOpaque()
    let callbackSize = UInt32(MemoryLayout<AURenderCallbackStruct>.size)
    var input = AURenderCallbackStruct(inputProc: captureCallback, inputProcRefCon: me)
    try check(AudioUnitSetProperty(unit, kAudioOutputUnitProperty_SetInputCallback, kAudioUnitScope_Global, 1, &input, callbackSize))
    if echoCancellation {
      try check(AudioUnitSetProperty(unit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Input, 0, &format, formatSize))
      var silence = AURenderCallbackStruct(inputProc: silenceCallback, inputProcRefCon: nil)
      try check(AudioUnitSetProperty(unit, kAudioUnitProperty_SetRenderCallback, kAudioUnitScope_Input, 0, &silence, callbackSize))
      if #available(iOS 17.0, *) {
        // Advanced ducking and the default level turn the speech down by about 10 dB.
        var ducking = AUVoiceIOOtherAudioDuckingConfiguration(mEnableAdvancedDucking: false, mDuckingLevel: .min)
        AudioUnitSetProperty(
          unit, kAUVoiceIOProperty_OtherAudioDuckingConfiguration, kAudioUnitScope_Global, 0, &ducking,
          UInt32(MemoryLayout<AUVoiceIOOtherAudioDuckingConfiguration>.size))
      }
    }
    try check(AudioUnitInitialize(unit))
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now() + Self.drainInterval, repeating: Self.drainInterval)
    timer.setEventHandler { [weak self] in self?.deliver() }
    timer.resume()
    drain = timer
    try check(AudioOutputUnitStart(unit))
  }

  func stop() {
    guard let unit else { return }
    AudioOutputUnitStop(unit)
    // A route change restarts mid-sentence: what the ring holds still goes out,
    // on `queue`, or it could cross the timer's own delivery.
    queue.sync { deliver() }
    AudioUnitUninitialize(unit)
    AudioComponentInstanceDispose(unit)
    self.unit = nil
    drain?.cancel()
    drain = nil
  }

  // The frames the render thread has handed over; on `queue`.
  private func deliver() {
    os_unfair_lock_lock(lock)
    let end = published
    let start = consumed
    let status = failure
    failure = noErr
    os_unfair_lock_unlock(lock)
    var at = start
    while end - at >= Self.frameSamples {
      var frame = Data(count: Self.frameSamples * 2)
      frame.withUnsafeMutableBytes { raw in
        let out = raw.bindMemory(to: Int16.self).baseAddress!
        let from = at % Self.ringSamples
        let first = min(Self.frameSamples, Self.ringSamples - from)
        out.update(from: ring + from, count: first)
        (out + first).update(from: ring, count: Self.frameSamples - first)
      }
      at += Self.frameSamples
      onFrame(frame)
    }
    os_unfair_lock_lock(lock)
    consumed = at
    os_unfair_lock_unlock(lock)
    if status != noErr && !reported {
      reported = true
      onFailure("audio unit render error \(status)")
    }
  }

  fileprivate func capture(
    flags: UnsafeMutablePointer<AudioUnitRenderActionFlags>,
    timestamp: UnsafePointer<AudioTimeStamp>,
    bus: UInt32,
    frames: UInt32
  ) -> OSStatus {
    guard let unit, frames <= 8192 else { return noErr }
    var list = AudioBufferList(
      mNumberBuffers: 1,
      mBuffers: AudioBuffer(mNumberChannels: 1, mDataByteSize: frames * 2, mData: UnsafeMutableRawPointer(scratch)))
    let status = AudioUnitRender(unit, flags, timestamp, bus, frames, &list)
    if status == noErr {
      renderFailures = 0
      // Full only if the queue stalled for seconds: these samples are lost, not the stream.
      if written + Int(frames) - consumedSeen <= Self.ringSamples {
        let at = written % Self.ringSamples
        let first = min(Int(frames), Self.ringSamples - at)
        (ring + at).update(from: scratch, count: first)
        ring.update(from: scratch + first, count: Int(frames) - first)
        written += Int(frames)
      }
    } else {
      renderFailures += 1
    }
    if os_unfair_lock_trylock(lock) {
      published = written
      consumedSeen = consumed
      if renderFailures >= Self.renderFailuresAllowed { failure = status }
      os_unfair_lock_unlock(lock)
    }
    return status
  }

  private func check(_ status: OSStatus) throws {
    if status != noErr {
      stop()
      throw CaptureError.status(status)
    }
  }
}

enum CaptureError: Error, CustomStringConvertible {
  case unitUnavailable
  case status(OSStatus)

  var description: String {
    switch self {
    case .unitUnavailable: return "the audio unit is unavailable"
    case .status(let status): return "audio unit error \(status)"
    }
  }
}

private func captureCallback(
  ref: UnsafeMutableRawPointer,
  flags: UnsafeMutablePointer<AudioUnitRenderActionFlags>,
  timestamp: UnsafePointer<AudioTimeStamp>,
  bus: UInt32,
  frames: UInt32,
  _: UnsafeMutablePointer<AudioBufferList>?
) -> OSStatus {
  Unmanaged<VoiceProcessingUnit>.fromOpaque(ref).takeUnretainedValue()
    .capture(flags: flags, timestamp: timestamp, bus: bus, frames: frames)
}

private func silenceCallback(
  _: UnsafeMutableRawPointer,
  flags: UnsafeMutablePointer<AudioUnitRenderActionFlags>,
  _: UnsafePointer<AudioTimeStamp>,
  _: UInt32,
  _: UInt32,
  list: UnsafeMutablePointer<AudioBufferList>?
) -> OSStatus {
  guard let list else { return noErr }
  for buffer in UnsafeMutableAudioBufferListPointer(list) {
    if let data = buffer.mData { memset(data, 0, Int(buffer.mDataByteSize)) }
  }
  flags.pointee.insert(.unitRenderAction_OutputIsSilence)
  return noErr
}
