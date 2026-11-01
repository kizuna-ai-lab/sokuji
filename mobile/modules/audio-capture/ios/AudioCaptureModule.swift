import AVFoundation
import ExpoModulesCore

struct CaptureOptions: Record {
  @Field var echoCancellation: Bool = false
  @Field var sampleRate: Int = 16000
  @Field var inputDeviceId: String? = nil
}

public class AudioCaptureModule: Module {
  private var unit: VoiceProcessingUnit?
  private var observers: [NSObjectProtocol] = []
  // An interruption reaches this module and, through the library, JS: both tear
  // down, so every start and stop runs here, one at a time.
  private let control = DispatchQueue(label: "ai.kizunaai.sokuji.audiocapture.control")

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
        try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothA2DP])
      }
      try session.setActive(true)
      let route = session.currentRoute
      print("[audio-capture] in \(route.inputs.map(\.portType.rawValue)) out \(route.outputs.map(\.portType.rawValue))")
      weak var failed: VoiceProcessingUnit?
      let unit = VoiceProcessingUnit(
        onFrame: { [weak self] frame in self?.sendEvent("audio", ["bytes": frame]) },
        onFailure: { [weak self] message in
          self?.control.async {
            guard let self, self.unit === failed else { return }
            self.stop()
            self.sendEvent("stopped", ["reason": "error", "message": message])
          }
        })
      failed = unit
      try unit.start(echoCancellation: options.echoCancellation)
      self.unit = unit
      self.observers = [
        NotificationCenter.default.addObserver(
          forName: AVAudioSession.interruptionNotification, object: session, queue: nil
        ) { [weak self] note in
          guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            AVAudioSession.InterruptionType(rawValue: raw) == .began
          else { return }
          self?.control.async {
            guard let self, self.unit === unit else { return }
            self.stop()
            self.sendEvent("stopped", ["reason": "interrupted"])
          }
        },
        NotificationCenter.default.addObserver(
          forName: AVAudioSession.mediaServicesWereResetNotification, object: session, queue: nil
        ) { [weak self] _ in
          self?.control.async {
            guard let self, self.unit === unit else { return }
            self.stop()
            self.sendEvent("stopped", ["reason": "error", "message": "the audio services restarted"])
          }
        },
      ]
      return ["chain": options.echoCancellation ? "voiceProcessing" : "none", "sampleRate": Int(VoiceProcessingUnit.sampleRate)]
    }.runOnQueue(control)

    AsyncFunction("stopCapture") {
      self.stop()
    }.runOnQueue(control)

    Function("listInputs") { () -> [[String: String]] in
      []
    }

    OnDestroy {
      self.control.sync { self.stop() }
    }
  }

  private func stop() {
    observers.forEach(NotificationCenter.default.removeObserver)
    observers = []
    unit?.stop()
    unit = nil
  }
}
