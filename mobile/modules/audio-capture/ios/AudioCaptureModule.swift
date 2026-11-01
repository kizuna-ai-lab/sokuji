import AVFoundation
import ExpoModulesCore

struct CaptureOptions: Record {
  @Field var echoCancellation: Bool = false
  @Field var sampleRate: Int = 16000
  @Field var inputDeviceId: String? = nil
}

public class AudioCaptureModule: Module {
  private var unit: VoiceProcessingUnit?
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("AudioCapture")

    Events("audio", "stopped")

    AsyncFunction("startCapture") { (options: CaptureOptions) -> [String: Any] in
      self.stop()
      let session = AVAudioSession.sharedInstance()
      // voiceChat is what lets the unit cancel; it may move Bluetooth to hands-free.
      if options.echoCancellation {
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetoothA2DP])
      } else {
        try session.setCategory(.playAndRecord, mode: .default, options: [.allowBluetoothA2DP])
      }
      try session.setActive(true)
      let route = session.currentRoute
      print("[audio-capture] in \(route.inputs.map(\.portType.rawValue)) out \(route.outputs.map(\.portType.rawValue))")
      let unit = VoiceProcessingUnit { [weak self] frame in
        self?.sendEvent("audio", ["bytes": frame])
      }
      try unit.start(echoCancellation: options.echoCancellation)
      self.unit = unit
      self.observer = NotificationCenter.default.addObserver(
        forName: AVAudioSession.interruptionNotification, object: session, queue: nil
      ) { [weak self] note in
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          AVAudioSession.InterruptionType(rawValue: raw) == .began
        else { return }
        self?.stop()
        self?.sendEvent("stopped", ["reason": "interrupted"])
      }
      return ["chain": options.echoCancellation ? "voiceProcessing" : "none", "sampleRate": Int(VoiceProcessingUnit.sampleRate)]
    }

    AsyncFunction("stopCapture") {
      self.stop()
    }

    Function("listInputs") { () -> [[String: String]] in
      []
    }

    OnDestroy {
      self.stop()
    }
  }

  private func stop() {
    if let observer {
      NotificationCenter.default.removeObserver(observer)
      self.observer = nil
    }
    unit?.stop()
    unit = nil
  }
}
