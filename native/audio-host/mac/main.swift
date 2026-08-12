// sokuji-audio-host - per-application audio capture for macOS.
//
//   sokuji-audio-host --list
//       Writes one JSON array to stdout and exits 0.
//       [{"id":"pid:1234","label":"Google Chrome","exe":"Google Chrome","active":true}]
//
//   sokuji-audio-host --target pid:1234
//   sokuji-audio-host --target system
//       `system` taps everything the machine plays. It is served by a global
//       Core Audio tap rather than getDisplayMedia, so whole-system capture
//       needs only the audio-capture grant - never Screen Recording.
//
//       Writes raw PCM to stdout until killed, fixed at
//       24000 Hz, 1 channel, signed 16-bit little-endian.
//       Writes one JSON object per line to stderr:
//         {"event":"format","sampleRate":24000,"channels":1,"encoding":"s16le"}
//         {"event":"warning","code":"silent_no_permission|retarget_failed"}
//         {"event":"error","code":"..."}
//
//       A targeted capture starts whether or not the application is currently
//       playing, and follows the application's audio process objects as macOS
//       destroys and recreates them - see retarget() below.
//
//   sokuji-audio-host --ensure-unity-gain <device name substring>
//       Restores that device's volume to unity and clears its mute, then writes
//       one JSON object to stdout and exits 0:
//         {"found":true,"name":"SokujiVirtualAudio","changed":true,
//          "before":{"output":0.5,"input":0.5},"after":{"output":1,"input":1},
//          "unmuted":false}
//       A device that is not present is {"found":false} and still exit 0 - not
//       having the driver installed is a normal state, not a failure.
//
// Exit codes: 0 clean, 1 runtime failure, 2 bad usage.
//
// stdout carries ONLY PCM. Everything else goes to stderr, or the audio stream
// is corrupted.
//
// PERMISSION: Core Audio process taps are gated by TCC
// (System Settings > Privacy & Security > System Audio Recording Only). A denial
// does NOT surface as an error - tap creation succeeds, the IOProc fires on
// schedule, buffers arrive the right size, and every sample is zero. This was
// measured: the same code returns real audio once the grant exists and pure
// silence without it. The "silent_no_permission" warning below exists so the app
// can tell that apart from "the user simply isn't playing anything".
//
// TCC attributes a request to the *responsible* process, so this helper must be
// spawned by Sokuji.app. Run standalone from a shell it can never be granted.
import Foundation
import CoreAudio
import AudioToolbox
import AppKit

// The pipeline consumes 24 kHz mono s16. The tap hands us 48 kHz float32, so
// unlike the Windows helper - where WASAPI converts for us - we convert here.
let kOutRate = 24000.0
let kOutChannels = 1

// Most silence the writer will synthesise in one go to catch up to wall clock.
// The read that precedes it times out at 0.1 s, so a healthy loop owes about
// that much; this leaves an order of magnitude for scheduling jitter and treats
// anything beyond it as a clock jump to be absorbed, not replayed.
let kMaxSilenceCatchUp = 1.0

// MARK: - small helpers

func emit(_ json: String) {
    FileHandle.standardError.write((json + "\n").data(using: .utf8)!)
}

func emitError(_ code: String) { emit("{\"event\":\"error\",\"code\":\"\(code)\"}") }

func jsonEscape(_ s: String) -> String {
    var o = ""
    for c in s.unicodeScalars {
        switch c {
        case "\"": o += "\\\""
        case "\\": o += "\\\\"
        case "\n": o += "\\n"
        case "\r": o += "\\r"
        case "\t": o += "\\t"
        default:
            if c.value < 0x20 { o += String(format: "\\u%04x", c.value) } else { o.unicodeScalars.append(c) }
        }
    }
    return o
}

func globalAddress(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector,
                               mScope: kAudioObjectPropertyScopeGlobal,
                               mElement: kAudioObjectPropertyElementMain)
}

func objectIDs(_ selector: AudioObjectPropertySelector) -> [AudioObjectID] {
    var addr = globalAddress(selector)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == noErr,
          size > 0 else { return [] }
    var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids) == noErr
    else { return [] }
    return ids
}

func pidOf(_ obj: AudioObjectID) -> pid_t? {
    var addr = globalAddress(kAudioProcessPropertyPID)
    var pid: pid_t = 0
    var size = UInt32(MemoryLayout<pid_t>.size)
    return AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, &pid) == noErr ? pid : nil
}

func boolProp(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector) -> Bool {
    var addr = globalAddress(sel)
    var v: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    return AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, &v) == noErr && v != 0
}

func stringProp(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector) -> String? {
    var addr = globalAddress(sel)
    var size = UInt32(MemoryLayout<CFString?>.size)
    var value: CFString? = nil
    let st = withUnsafeMutablePointer(to: &value) {
        AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, $0)
    }
    guard st == noErr, let v = value else { return nil }
    return v as String
}

// MARK: - --list

struct Source {
    let pid: pid_t
    let label: String
    let exe: String
    let active: Bool
}

/// Applications that hold an audio process object.
///
/// Unlike Linux and Windows this needs no window-title lookup: macOS hands us a
/// localized application name for free. Window titles would be nicer still but
/// are gated behind Screen Recording, which is far too heavy a permission to ask
/// for a label.
func listSources() -> [Source] {
    var out: [Source] = []
    let self_ = getpid()

    for obj in objectIDs(kAudioHardwarePropertyProcessObjectList) {
        guard let pid = pidOf(obj), pid != self_ else { continue }

        // Most audio process objects are daemons - CoreSpeech, loginwindow,
        // universalaccessd, systemsoundserverd and friends. Listing them buried
        // the handful of real applications 30 rows deep. A regular activation
        // policy means "has a Dock icon", which is exactly the set a user can
        // recognise and would ever want to translate.
        guard let app = NSRunningApplication(processIdentifier: pid),
              app.activationPolicy == .regular,
              let label = app.localizedName, !label.isEmpty else { continue }

        let bundle = app.bundleIdentifier ?? stringProp(obj, kAudioProcessPropertyBundleID)

        out.append(Source(pid: pid,
                          label: label,
                          exe: bundle ?? label,
                          // The listed process is the user-facing app, which
                          // in a multi-process app renders nothing itself - so
                          // ask its whole tree, or every browser reads as idle.
                          active: isRenderingOutput(audioObjectsInTree(of: pid))))
    }

    // Applications actually making noise are the likely target; float them up.
    out.sort { a, b in a.active == b.active ? a.label < b.label : a.active && !b.active }

    // Two copies of one application used to be disambiguated here, by appending
    // the pid only when the names collided. The app now appends it to every row
    // on every platform (see withPid in electron/audio-host.js), so doing it
    // here too would print the pid twice.
    return out
}

func runList() -> Int32 {
    let rows = listSources().map { s in
        "{\"id\":\"pid:\(s.pid)\",\"label\":\"\(jsonEscape(s.label))\",\"exe\":\"\(jsonEscape(s.exe))\",\"active\":\(s.active)}"
    }
    FileHandle.standardOutput.write(("[" + rows.joined(separator: ",") + "]").data(using: .utf8)!)
    return 0
}

// MARK: - --ensure-unity-gain

// macOS keeps a per-device volume in coreaudiod's own settings store and pushes
// it onto the driver as the device registers, so the stored value outlives the
// driver binary - reinstalling the driver does not reset it.
//
// A macOS 15 -> 26 upgrade was measured leaving SokujiVirtualAudio's stored
// volume at scalar 0.5. The driver's volume control is logarithmic across a
// 64 dB range, so scalar 0.5 is -32 dB: it passes 2.5% of the amplitude, not
// half. Nothing errors and audio still flows, but the receiving application
// hears what sounds like silence and the level meter in Audio MIDI Setup does
// not move - which reads as "the virtual device is broken", and is exactly how
// it was reported.
//
// Unity is the only meaningful setting for a bus no human listens to directly,
// so put it back instead of asking every user to find a slider they never
// knowingly moved. Writing the scalar needs no privilege and no entitlement,
// and coreaudiod persists it at its next restart - verified on 26.6.1.

func scopedAddress(_ selector: AudioObjectPropertySelector,
                   _ scope: AudioObjectPropertyScope) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector,
                               mScope: scope,
                               mElement: kAudioObjectPropertyElementMain)
}

func volumeScalar(_ device: AudioObjectID, _ scope: AudioObjectPropertyScope) -> Float32? {
    var addr = scopedAddress(kAudioDevicePropertyVolumeScalar, scope)
    guard AudioObjectHasProperty(device, &addr) else { return nil }
    var value: Float32 = 0
    var size = UInt32(MemoryLayout<Float32>.size)
    guard AudioObjectGetPropertyData(device, &addr, 0, nil, &size, &value) == noErr else { return nil }
    return value
}

/// True only when the value was actually written. A device without the control,
/// or one that reports it read-only, is not a failure worth reporting: some
/// virtual devices legitimately have no volume at all.
func setVolumeScalar(_ device: AudioObjectID, _ scope: AudioObjectPropertyScope, _ value: Float32) -> Bool {
    var addr = scopedAddress(kAudioDevicePropertyVolumeScalar, scope)
    guard AudioObjectHasProperty(device, &addr) else { return false }
    var settable: DarwinBoolean = false
    guard AudioObjectIsPropertySettable(device, &addr, &settable) == noErr, settable.boolValue else { return false }
    var v = value
    return AudioObjectSetPropertyData(device, &addr, 0, nil, UInt32(MemoryLayout<Float32>.size), &v) == noErr
}

func muteFlag(_ device: AudioObjectID, _ scope: AudioObjectPropertyScope) -> UInt32? {
    var addr = scopedAddress(kAudioDevicePropertyMute, scope)
    guard AudioObjectHasProperty(device, &addr) else { return nil }
    var value: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    guard AudioObjectGetPropertyData(device, &addr, 0, nil, &size, &value) == noErr else { return nil }
    return value
}

func clearMute(_ device: AudioObjectID, _ scope: AudioObjectPropertyScope) -> Bool {
    var addr = scopedAddress(kAudioDevicePropertyMute, scope)
    guard AudioObjectHasProperty(device, &addr) else { return false }
    var settable: DarwinBoolean = false
    guard AudioObjectIsPropertySettable(device, &addr, &settable) == noErr, settable.boolValue else { return false }
    var v: UInt32 = 0
    return AudioObjectSetPropertyData(device, &addr, 0, nil, UInt32(MemoryLayout<UInt32>.size), &v) == noErr
}

func jsonNumber(_ value: Float32?) -> String {
    guard let value else { return "null" }
    return String(format: "%.4f", value)
}

func runEnsureUnityGain(deviceName needle: String) -> Int32 {
    // Both scopes carry a control, and in BlackHole-derived drivers they are two
    // faces of one value - but that is the driver's business, not ours. Setting
    // each independently keeps this correct for any device.
    let scopes: [(String, AudioObjectPropertyScope)] = [
        ("output", kAudioObjectPropertyScopeOutput),
        ("input", kAudioObjectPropertyScopeInput),
    ]

    let device = objectIDs(kAudioHardwarePropertyDevices).first {
        (stringProp($0, kAudioObjectPropertyName) ?? "").localizedCaseInsensitiveContains(needle)
    }
    guard let device else {
        FileHandle.standardOutput.write("{\"found\":false}".data(using: .utf8)!)
        return 0
    }

    var before: [String: Float32?] = [:]
    var after: [String: Float32?] = [:]
    var changed = false
    var unmuted = false
    var writeFailed = false

    // Read every scope before writing any of them. In BlackHole-derived drivers
    // the two scopes are two faces of one stored value, so repairing the output
    // scope silently repairs the input scope too - and a read-as-you-go loop
    // would then report the input scope as having been fine all along. The
    // report is what we get to debug from, so it has to describe the state we
    // actually found.
    for (label, scope) in scopes { before[label] = volumeScalar(device, scope) }

    for (label, scope) in scopes {
        // Compared against a tolerance because the scalar makes a round trip
        // through the driver's dB curve: writing 1.0 and reading it back can
        // land a hair under, and re-writing it on every launch would be noise.
        if let current = before[label] ?? nil, current < 0.999 {
            if setVolumeScalar(device, scope, 1.0) { changed = true } else { writeFailed = true }
        }

        if let mute = muteFlag(device, scope), mute != 0 {
            if clearMute(device, scope) { unmuted = true } else { writeFailed = true }
        }
    }

    for (label, scope) in scopes { after[label] = volumeScalar(device, scope) }

    let name = stringProp(device, kAudioObjectPropertyName) ?? needle
    let json = "{\"found\":true,\"name\":\"\(jsonEscape(name))\"," +
        "\"changed\":\(changed),\"unmuted\":\(unmuted)," +
        "\"before\":{\"output\":\(jsonNumber(before["output"] ?? nil)),\"input\":\(jsonNumber(before["input"] ?? nil))}," +
        "\"after\":{\"output\":\(jsonNumber(after["output"] ?? nil)),\"input\":\(jsonNumber(after["input"] ?? nil))}}"
    FileHandle.standardOutput.write(json.data(using: .utf8)!)

    // A device that is present but refuses the write is worth surfacing: the
    // caller cannot tell it apart from success by the audio alone.
    if writeFailed {
        emitError("volume_write_failed")
        return 1
    }
    return 0
}

// MARK: - capture

/// Float samples handed from the realtime IOProc to the writer thread.
///
/// The IOProc must not block, and fwrite to a pipe can block for as long as the
/// reader is busy, so the two are decoupled. Overruns drop the oldest audio -
/// staying realtime-safe matters more than a few late milliseconds.
final class RingBuffer: @unchecked Sendable {
    private var storage: [Float]
    private var readIndex = 0
    private var count = 0
    private let lock = NSCondition()
    private var closed = false
    private(set) var overruns: UInt64 = 0

    init(capacity: Int) { storage = [Float](repeating: 0, count: capacity) }

    func write(_ src: UnsafePointer<Float>, _ n: Int) {
        lock.lock()
        for i in 0..<n {
            if count == storage.count {
                readIndex = (readIndex + 1) % storage.count
                count -= 1
                overruns &+= 1
            }
            storage[(readIndex + count) % storage.count] = src[i]
            count += 1
        }
        lock.signal()
        lock.unlock()
    }

    /// Blocks until at least `minimum` samples are available, the ring closes,
    /// or `timeout` elapses. A timeout returns 0 and is not an error: a tap
    /// whose process list is momentarily empty delivers no buffers at all - not
    /// even silent ones - so the caller has to make up the missing time itself.
    func read(into dst: inout [Float], minimum: Int, timeout: TimeInterval) -> Int {
        lock.lock()
        let deadline = Date().addingTimeInterval(timeout)
        while count < minimum && !closed {
            if !lock.wait(until: deadline) { break }
        }
        let n = min(count, dst.count)
        for i in 0..<n { dst[i] = storage[(readIndex + i) % storage.count] }
        readIndex = (readIndex + n) % storage.count
        count -= n
        lock.unlock()
        return n
    }

    func close() { lock.lock(); closed = true; lock.broadcast(); lock.unlock() }
}

final class CaptureState: @unchecked Sendable {
    var sawNonZero = false
    var startedAt = Date()
    var warned = false
    let lock = NSLock()
}

var gStop = false

/// Is the tapped target actually rendering audio right now?
///
/// For a global tap the question is whether *any* application is, since that is
/// what such a tap should be picking up.
func isRenderingOutput(_ targets: [AudioObjectID]) -> Bool {
    let objs = targets.isEmpty
        ? objectIDs(kAudioHardwarePropertyProcessObjectList)
        : targets
    return objs.contains { boolProp($0, kAudioProcessPropertyIsRunningOutput) }
}

func ppidOf(_ pid: pid_t) -> pid_t {
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
    guard sysctl(&mib, 4, &info, &size, nil, 0) == 0 else { return 0 }
    return info.kp_eproc.e_ppid
}

/// Every audio process object belonging to `pid` or to one of its descendants.
///
/// Browsers and other multi-process apps do not render audio from the process
/// the user picked: Chrome plays through a "Google Chrome Helper" child, and
/// tapping only the parent yields a tap that never fires - no data at all, not
/// even silence. Windows already captures the whole tree
/// (PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE) and Linux links every one
/// of the app's streams; this brings macOS in line.
///
/// The result is a snapshot, never a constant: measured on macOS 15.7.3, an
/// audio process object is destroyed when its process stops rendering and a
/// fresh one is created for the replacement. Killing Chrome's
/// audio.mojom.AudioService child took its object out of Chrome's tree and the
/// respawned service arrived as a different object under a different pid, so a
/// list resolved once at capture start goes stale on its own.
func audioObjectsInTree(of targetPid: pid_t) -> [AudioObjectID] {
    let all = objectIDs(kAudioHardwarePropertyProcessObjectList)
    return all.sorted().filter { obj in
        // pidOf is optional; an object without a pid cannot be in any tree.
        guard var current = pidOf(obj) else { return false }
        // Walk up to the target; the depth bound stops a cycle from hanging us.
        for _ in 0..<8 {
            if current == targetPid { return true }
            if current <= 1 { return false }
            current = ppidOf(current)
        }
        return false
    }
}

/// The tap description for one target. `nil` processes means the whole system.
///
/// A targeted capture always uses the mixdown initialiser, even while the list
/// is empty. The two initialisers are not interchangeable and the difference is
/// the whole per-application feature: measured on macOS 15.7.3, a mixdown tap
/// with an empty list captures nothing and clocks nothing, while the global
/// initialiser with an empty exclusion list captures every application. Reaching
/// for the wrong one when a target momentarily owns no audio objects is how a
/// capture of one application silently becomes a capture of all of them.
func tapDescription(processes: [AudioObjectID]?, uuid: UUID) -> CATapDescription {
    let desc = processes.map { CATapDescription(monoMixdownOfProcesses: $0) }
        ?? CATapDescription(stereoGlobalTapButExcludeProcesses: [])
    desc.uuid = uuid
    desc.name = "Sokuji Application Capture"
    desc.isPrivate = true   // visible only to us; CATapUnmuted is the default
    return desc
}

/// Point a live tap at a new set of process objects.
///
/// Writing kAudioTapPropertyDescription on a running tap is honoured in place:
/// measured on macOS 15.7.3, the HAL re-reads the list, audio from the newly
/// named processes arrives within one poll interval, and the aggregate device
/// keeps its IOProc, its clock and its sample rate throughout - no rebuild, no
/// gap in the frame count. That is why this is a property write rather than a
/// teardown of the tap, the aggregate device and the writer thread.
func retarget(_ tapID: AudioObjectID, processes: [AudioObjectID], uuid: UUID) -> OSStatus {
    var addr = globalAddress(kAudioTapPropertyDescription)
    var boxed: CATapDescription? = tapDescription(processes: processes, uuid: uuid)
    return withUnsafeMutablePointer(to: &boxed) {
        AudioObjectSetPropertyData(tapID, &addr, 0, nil,
                                   UInt32(MemoryLayout<CATapDescription?>.size), $0)
    }
}

/// The tap's current sample rate and channel count, read off the aggregate
/// device's input stream. Re-read after a retarget: the rate is the one thing a
/// new process list could plausibly change under the writer thread.
func inputFormat(of aggID: AudioObjectID) -> (rate: Double, channels: UInt32)? {
    var streamAddr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreams,
                                                mScope: kAudioObjectPropertyScopeInput,
                                                mElement: kAudioObjectPropertyElementMain)
    var streamSize: UInt32 = 0
    AudioObjectGetPropertyDataSize(aggID, &streamAddr, 0, nil, &streamSize)
    guard streamSize >= UInt32(MemoryLayout<AudioObjectID>.size) else { return nil }
    var streamIDs = [AudioObjectID](repeating: 0, count: Int(streamSize) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(aggID, &streamAddr, 0, nil, &streamSize, &streamIDs) == noErr,
          let first = streamIDs.first else { return nil }
    var fmtAddr = globalAddress(kAudioStreamPropertyVirtualFormat)
    var asbd = AudioStreamBasicDescription()
    var asbdSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
    guard AudioObjectGetPropertyData(first, &fmtAddr, 0, nil, &asbdSize, &asbd) == noErr,
          asbd.mSampleRate > 0 else { return nil }
    return (asbd.mSampleRate, max(1, asbd.mChannelsPerFrame))
}

/// Resampling ratio shared between the watch loop and the writer thread. It was
/// a `let` while the tap was immutable; a retarget can in principle bring a new
/// sample rate, and a writer using the old one would drift.
final class RatioBox: @unchecked Sendable {
    private var value: Double
    private let lock = NSLock()
    init(_ v: Double) { value = v }
    var current: Double { lock.lock(); defer { lock.unlock() }; return value }
    func set(_ v: Double) { lock.lock(); value = v; lock.unlock() }
}

@inline(__always)
func appendSample(_ pcm: inout [Int16], _ v: Float) {
    let clamped = max(-1.0, min(1.0, v))
    pcm.append(Int16(clamped * 32767.0))
}

func runCapture(pid: pid_t?) -> Int32 {
    // The target must exist, but it need not be making a sound. An application
    // owns audio process objects only while something in its tree renders, so
    // requiring a non-empty list here refused to capture any application that
    // happened to be quiet at the moment the user pressed start - which is most
    // of them, most of the time. The tap is created empty instead and adopts the
    // target's objects as they appear, exactly as it does when they are replaced
    // mid-session.
    if let pid, kill(pid, 0) != 0, errno == ESRCH {
        emitError("no_such_audio_process")
        return 1
    }
    var procObjs: [AudioObjectID] = pid.map { audioObjectsInTree(of: $0) } ?? []

    let tapUUID = UUID()
    // Global and per-application taps are governed by the same audio-capture
    // permission; see tapDescription for why the two are never interchanged.
    let desc = tapDescription(processes: pid == nil ? nil : procObjs, uuid: tapUUID)

    var tapID: AudioObjectID = 0
    guard AudioHardwareCreateProcessTap(desc, &tapID) == noErr else {
        emitError("activation_failed")
        return 1
    }

    let aggDesc: [String: Any] = [
        kAudioAggregateDeviceNameKey: "Sokuji Application Capture",
        kAudioAggregateDeviceUIDKey: UUID().uuidString,
        kAudioAggregateDeviceIsPrivateKey: true,
        kAudioAggregateDeviceIsStackedKey: false,
        kAudioAggregateDeviceTapAutoStartKey: true,
        kAudioAggregateDeviceSubDeviceListKey: [[String: Any]](),
        kAudioAggregateDeviceTapListKey: [[
            kAudioSubTapDriftCompensationKey: true,
            kAudioSubTapUIDKey: tapUUID.uuidString,
        ]],
    ]
    var aggID: AudioObjectID = 0
    guard AudioHardwareCreateAggregateDevice(aggDesc as CFDictionary, &aggID) == noErr else {
        AudioHardwareDestroyProcessTap(tapID)
        emitError("initialize_failed")
        return 1
    }

    func teardown() {
        AudioHardwareDestroyAggregateDevice(aggID)
        AudioHardwareDestroyProcessTap(tapID)
    }

    // The tap's native rate; measured at 48 kHz float32 mono, but read it rather
    // than assume - the decimation factor below depends on it.
    var inRate = 48000.0
    var channelsIn: UInt32 = 1
    if let fmt = inputFormat(of: aggID) {
        inRate = fmt.rate
        channelsIn = fmt.channels
    }
    // Resample by the true ratio, not an integer one. Rounding it meant a
    // 44.1 kHz tap - the common case on macOS - emitted 22050 Hz while still
    // declaring 24000 Hz, so everything downstream ran ~9% fast; a 16 kHz tap
    // (a Bluetooth headset in HFP) was out by a third.
    let ratioBox = RatioBox(inRate / kOutRate)

    let ring = RingBuffer(capacity: Int(inRate) * 2)   // ~2 s of slack
    let state = CaptureState()

    var procID: AudioDeviceIOProcID?
    let ioStatus = AudioDeviceCreateIOProcIDWithBlock(&procID, aggID, nil) { _, inData, _, _, _ in
        let abl = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inData))
        for buf in abl {
            guard let raw = buf.mData else { continue }
            let n = Int(buf.mDataByteSize) / MemoryLayout<Float>.size
            if n == 0 { continue }
            let p = raw.assumingMemoryBound(to: Float.self)
            if !state.sawNonZero {
                for i in 0..<n where p[i] != 0 { state.sawNonZero = true; break }
            }
            // A per-process tap is a mono mixdown; a global tap is interleaved
            // stereo. Fold stereo down here so the writer thread always sees one
            // channel and the downstream format stays 24 kHz mono either way.
            if channelsIn > 1 {
                var mono = [Float](repeating: 0, count: n / Int(channelsIn))
                for f in 0..<mono.count {
                    var acc: Float = 0
                    for c in 0..<Int(channelsIn) { acc += p[f * Int(channelsIn) + c] }
                    mono[f] = acc / Float(channelsIn)
                }
                mono.withUnsafeBufferPointer { ring.write($0.baseAddress!, mono.count) }
            } else {
                ring.write(p, n)
            }
            break
        }
    }
    guard ioStatus == noErr, let procID else {
        teardown(); emitError("initialize_failed"); return 1
    }

    guard AudioDeviceStart(aggID, procID) == noErr else {
        teardown(); emitError("initialize_failed"); return 1
    }

    emit("{\"event\":\"format\",\"sampleRate\":24000,\"channels\":1,\"encoding\":\"s16le\"}")

    // Writer thread: resample to 24 kHz, convert to s16, push to stdout.
    let writer = Thread {
        var floats = [Float](repeating: 0, count: 4096)
        // Appended rather than indexed into a fixed buffer. The previous buffer
        // was sized for a 2:1 ratio and any tap at or below ~36 kHz overran it,
        // which in Swift is a trap that kills capture outright.
        var pcm = [Int16]()
        let out = FileHandle.standardOutput

        // Fractional read position, carried across chunks so the output rate
        // stays exact over time rather than drifting once per read.
        var phase = 0.0
        // The sample before the current chunk, needed to interpolate across the
        // boundary when upsampling.
        var previous: Float = 0
        var havePrevious = false

        // Wall-clock position of the last sample written. A tap with no process
        // in it - a target that has not started playing yet - delivers no
        // buffers at all, so without this the stream would simply stop until the
        // application made a sound, and everything downstream is built on the
        // stream never stalling.
        var writtenUntil = Date()

        func writePCM(_ samples: [Int16]) {
            guard !samples.isEmpty else { return }
            samples.withUnsafeBufferPointer { bp in
                let data = Data(bytes: bp.baseAddress!, count: bp.count * MemoryLayout<Int16>.size)
                out.write(data)
            }
            writtenUntil = writtenUntil.addingTimeInterval(Double(samples.count) / kOutRate)
        }

        while !gStop {
            let n = ring.read(into: &floats, minimum: 256, timeout: 0.1)
            if n == 0 {
                if gStop { break }
                // Fill the silence the tap owes us, so the reader sees an
                // unbroken 24 kHz stream whether or not the target is playing.
                //
                // Bounded, because the debt is measured against wall clock and
                // wall clock can jump: system sleep freezes this thread, and a
                // reader that stops draining stdout blocks it in writePCM. Both
                // return with writtenUntil hours behind, and materialising that
                // as one array is 2 bytes per 1/24000 s - an eight-hour sleep
                // asks for 1.4 GB and kills the helper instead of resuming it.
                // Past the cap the debt is uncollectable anyway: nobody wants
                // hours of injected silence, they want the stream to resume.
                let now = Date()
                if now.timeIntervalSince(writtenUntil) > kMaxSilenceCatchUp {
                    writtenUntil = now.addingTimeInterval(-kMaxSilenceCatchUp)
                }
                let owed = Int(now.timeIntervalSince(writtenUntil) * kOutRate)
                if owed > 0 { writePCM([Int16](repeating: 0, count: owed)) }
                continue
            }
            // Real audio has resumed; drop any silence we were about to owe
            // rather than inserting it in front of the samples.
            if writtenUntil < Date() { writtenUntil = Date() }
            let ratio = ratioBox.current

            pcm.removeAll(keepingCapacity: true)
            while true {
                if ratio >= 1.0 {
                    // Downsampling: average the input span this output sample
                    // covers. A box filter is a crude anti-alias, but its null
                    // sits at the new Nyquist and speech going to ASR does not
                    // need better.
                    let end = phase + ratio
                    if end > Double(n) { break }
                    let from = max(0, Int(phase))
                    let to = min(n, max(from + 1, Int(end)))
                    var acc: Float = 0
                    for k in from..<to { acc += floats[k] }
                    appendSample(&pcm, acc / Float(to - from))
                    phase = end
                } else {
                    // Upsampling: linear interpolation between neighbours.
                    if phase >= Double(n) { break }
                    let idx = Int(phase)
                    let frac = Float(phase - Double(idx))
                    let a = idx == 0 ? (havePrevious ? previous : floats[0]) : floats[idx - 1]
                    let b = floats[idx]
                    appendSample(&pcm, a + (b - a) * frac)
                    phase += ratio
                }
            }
            phase -= Double(n)
            if phase < 0 { phase = 0 }
            previous = floats[n - 1]
            havePrevious = true

            writePCM(pcm)
        }
    }
    writer.start()

    // Watch the target and the permission situation from the main thread.
    var warnedRetarget = false
    var renderingSince: Date? = nil
    while !gStop {
        Thread.sleep(forTimeInterval: 0.25)

        // A global tap has no target process to outlive.
        if let pid, kill(pid, 0) != 0 && errno == ESRCH {
            emitError("target_gone")
            gStop = true
            break
        }

        // Follow the target's audio process objects. Polling here rather than
        // installing a property listener keeps the update on the thread that
        // already owns teardown, so a listener callback cannot race the tap's
        // destruction.
        if let pid {
            let current = audioObjectsInTree(of: pid)
            if current != procObjs {
                let status = retarget(tapID, processes: current, uuid: tapUUID)
                if status == noErr {
                    procObjs = current
                    // A new process list could in principle bring a new sample
                    // rate; the writer would drift on the old one.
                    if let fmt = inputFormat(of: aggID), fmt.rate > 0 {
                        ratioBox.set(fmt.rate / kOutRate)
                    }
                } else if !warnedRetarget {
                    // A warning, not an error: the app answers an error by
                    // tearing the capture down, and a tap still pointing at the
                    // previous objects is worth more than no tap at all. Once
                    // only - this loop runs four times a second.
                    warnedRetarget = true
                    emit("{\"event\":\"warning\",\"code\":\"retarget_failed\"}")
                }
            }
        }

        // A missing TCC grant and a quiet application both look like silence,
        // so silence alone must never raise the warning - doing so cried wolf
        // every time the user simply was not playing anything. The signal is
        // the contradiction: Core Audio says the target is rendering output,
        // yet every sample we receive is zero.
        state.lock.lock()
        let unexplainedSilence = !state.warned
            && !state.sawNonZero
            && Date().timeIntervalSince(state.startedAt) > 3.0
        state.lock.unlock()

        // `procObjs` is now the live list, which is what makes this diagnostic
        // work at all: guarded by the frozen one it could never fire, because
        // the objects it asked about were the dead ones. An empty targeted list
        // means the target is rendering nothing - not "ask the whole system",
        // which is what isRenderingOutput does with an empty argument.
        let targetRendering = pid == nil
            ? isRenderingOutput([])
            : (!procObjs.isEmpty && isRenderingOutput(procObjs))

        // "Rendering" leads the first audible sample by a poll or two - Core
        // Audio marks the process as running output before the tap has handed us
        // anything - so an instantaneous reading fires the warning at the exact
        // moment a target starts playing, which is the one moment we can be sure
        // the permission is fine. Require the contradiction to hold for a while.
        if targetRendering {
            if renderingSince == nil { renderingSince = Date() }
        } else {
            renderingSince = nil
        }
        let renderingLongEnough = renderingSince.map { Date().timeIntervalSince($0) > 2.0 } ?? false

        if unexplainedSilence && renderingLongEnough {
            state.lock.lock()
            state.warned = true
            state.lock.unlock()
            emit("{\"event\":\"warning\",\"code\":\"silent_no_permission\"}")
        }
    }

    ring.close()
    AudioDeviceStop(aggID, procID)
    AudioDeviceDestroyIOProcID(aggID, procID)
    teardown()
    return 0
}

// MARK: - main

func SetupSignals() {
    signal(SIGINT)  { _ in gStop = true }
    signal(SIGTERM) { _ in gStop = true }
    signal(SIGPIPE, SIG_IGN)   // the parent closing the pipe is a normal stop
}

let args = CommandLine.arguments
if args.count >= 2 && args[1] == "--list" {
    exit(runList())
} else if args.count >= 3 && args[1] == "--ensure-unity-gain" {
    guard !args[2].isEmpty else {
        emitError("bad_device_name")
        exit(2)
    }
    exit(runEnsureUnityGain(deviceName: args[2]))
} else if args.count >= 3 && args[1] == "--target" {
    if args[2] == "system" {
        SetupSignals()
        exit(runCapture(pid: nil))
    }
    guard args[2].hasPrefix("pid:"), let pid = pid_t(args[2].dropFirst(4)), pid > 0 else {
        emitError("bad_target")
        exit(2)
    }
    SetupSignals()
    exit(runCapture(pid: pid))
} else {
    emit("usage:")
    emit("  sokuji-audio-host --list")
    emit("  sokuji-audio-host --target pid:<processId>")
    emit("  sokuji-audio-host --ensure-unity-gain <deviceName>")
    exit(2)
}
