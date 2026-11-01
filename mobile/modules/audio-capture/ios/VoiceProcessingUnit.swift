import AudioToolbox
import AVFoundation
import Foundation

// The microphone as 16 kHz mono 16-bit frames. With echo cancellation, a
// VoiceProcessingIO unit: its output bus must run, so it renders silence, and
// the speech plays elsewhere (the library's engine) as "other audio", which is
// cancelled without gating the microphone. Without it, a plain RemoteIO input.
final class VoiceProcessingUnit {
  static let sampleRate: Double = 16000
  static let frameSamples = 1600

  private let onFrame: (Data) -> Void
  private let queue = DispatchQueue(label: "ai.kizunaai.sokuji.audiocapture")
  private var unit: AudioUnit?
  private var scratch = [Int16](repeating: 0, count: 8192)
  private var pending = [Int16](repeating: 0, count: VoiceProcessingUnit.frameSamples)
  private var filled = 0

  init(onFrame: @escaping (Data) -> Void) {
    self.onFrame = onFrame
  }

  deinit {
    stop()
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
    try check(AudioOutputUnitStart(unit))
  }

  func stop() {
    guard let unit else { return }
    AudioOutputUnitStop(unit)
    AudioUnitUninitialize(unit)
    AudioComponentInstanceDispose(unit)
    self.unit = nil
    filled = 0
  }

  fileprivate func capture(
    flags: UnsafeMutablePointer<AudioUnitRenderActionFlags>,
    timestamp: UnsafePointer<AudioTimeStamp>,
    bus: UInt32,
    frames: UInt32
  ) -> OSStatus {
    guard let unit, Int(frames) <= scratch.count else { return noErr }
    var status: OSStatus = noErr
    scratch.withUnsafeMutableBytes { raw in
      var list = AudioBufferList(
        mNumberBuffers: 1,
        mBuffers: AudioBuffer(mNumberChannels: 1, mDataByteSize: frames * 2, mData: raw.baseAddress))
      status = AudioUnitRender(unit, flags, timestamp, bus, frames, &list)
    }
    guard status == noErr else { return status }
    for i in 0..<Int(frames) {
      pending[filled] = scratch[i]
      filled += 1
      if filled == Self.frameSamples {
        let frame = pending.withUnsafeBytes { Data($0) }
        filled = 0
        queue.async { [onFrame] in onFrame(frame) }
      }
    }
    return noErr
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
