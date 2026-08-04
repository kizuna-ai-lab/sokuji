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
//         {"event":"warning","code":"silent_no_permission"}
//         {"event":"error","code":"..."}
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
                          active: boolProp(obj, kAudioProcessPropertyIsRunningOutput)))
    }

    // Applications actually making noise are the likely target; float them up.
    out.sort { a, b in a.active == b.active ? a.label < b.label : a.active && !b.active }

    // Same application twice is ambiguous in a picker; disambiguate only then.
    var counts: [String: Int] = [:]
    for s in out { counts[s.label, default: 0] += 1 }
    return out.map { s in
        (counts[s.label] ?? 0) > 1
            ? Source(pid: s.pid, label: "\(s.label) (\(s.pid))", exe: s.exe, active: s.active)
            : s
    }
}

func runList() -> Int32 {
    let rows = listSources().map { s in
        "{\"id\":\"pid:\(s.pid)\",\"label\":\"\(jsonEscape(s.label))\",\"exe\":\"\(jsonEscape(s.exe))\",\"active\":\(s.active)}"
    }
    FileHandle.standardOutput.write(("[" + rows.joined(separator: ",") + "]").data(using: .utf8)!)
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

    /// Blocks until at least `minimum` samples are available or the ring closes.
    func read(into dst: inout [Float], minimum: Int) -> Int {
        lock.lock()
        while count < minimum && !closed { lock.wait() }
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

func runCapture(pid: pid_t?) -> Int32 {
    var procObj: AudioObjectID? = nil
    if let pid {
        guard let found = objectIDs(kAudioHardwarePropertyProcessObjectList).first(where: { pidOf($0) == pid }) else {
            emitError("no_such_audio_process")
            return 1
        }
        procObj = found
    }

    let tapUUID = UUID()
    // Excluding nothing yields a global tap; both variants are governed by the
    // same audio-capture permission.
    let desc = procObj.map { CATapDescription(monoMixdownOfProcesses: [$0]) }
        ?? CATapDescription(stereoGlobalTapButExcludeProcesses: [])
    desc.uuid = tapUUID
    desc.name = "Sokuji Application Capture"
    desc.isPrivate = true   // visible only to us; CATapUnmuted is the default

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
    var streamAddr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreams,
                                                mScope: kAudioObjectPropertyScopeInput,
                                                mElement: kAudioObjectPropertyElementMain)
    var streamSize: UInt32 = 0
    AudioObjectGetPropertyDataSize(aggID, &streamAddr, 0, nil, &streamSize)
    if streamSize >= UInt32(MemoryLayout<AudioObjectID>.size) {
        var streamIDs = [AudioObjectID](repeating: 0, count: Int(streamSize) / MemoryLayout<AudioObjectID>.size)
        if AudioObjectGetPropertyData(aggID, &streamAddr, 0, nil, &streamSize, &streamIDs) == noErr,
           let first = streamIDs.first {
            var fmtAddr = globalAddress(kAudioStreamPropertyVirtualFormat)
            var asbd = AudioStreamBasicDescription()
            var asbdSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
            if AudioObjectGetPropertyData(first, &fmtAddr, 0, nil, &asbdSize, &asbd) == noErr, asbd.mSampleRate > 0 {
                inRate = asbd.mSampleRate
                if asbd.mChannelsPerFrame > 0 { channelsIn = asbd.mChannelsPerFrame }
            }
        }
    }
    let decimation = max(1, Int((inRate / kOutRate).rounded()))

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

    // Writer thread: decimate to 24 kHz, convert to s16, push to stdout.
    let writer = Thread {
        var floats = [Float](repeating: 0, count: 4096)
        var pcm = [Int16](repeating: 0, count: 4096 / 2 + 1)
        let out = FileHandle.standardOutput

        while !gStop {
            let n = ring.read(into: &floats, minimum: decimation * 256)
            if n == 0 { if gStop { break } else { continue } }

            // Average each group of `decimation` samples. A box filter is a
            // crude anti-alias, but its null sits exactly at the new Nyquist
            // and speech going to ASR does not need better.
            var outCount = 0
            var i = 0
            while i + decimation <= n {
                var acc: Float = 0
                for k in 0..<decimation { acc += floats[i + k] }
                let v = acc / Float(decimation)
                let clamped = max(-1.0, min(1.0, v))
                pcm[outCount] = Int16(clamped * 32767.0)
                outCount += 1
                i += decimation
            }
            if outCount > 0 {
                pcm.withUnsafeBufferPointer { bp in
                    let data = Data(bytes: bp.baseAddress!, count: outCount * MemoryLayout<Int16>.size)
                    out.write(data)
                }
            }
        }
    }
    writer.start()

    // Watch the target and the permission situation from the main thread.
    while !gStop {
        Thread.sleep(forTimeInterval: 0.25)

        // A global tap has no target process to outlive.
        if let pid, kill(pid, 0) != 0 && errno == ESRCH {
            emitError("target_gone")
            gStop = true
            break
        }

        // Silence that never breaks is the signature of a missing TCC grant.
        // Report it once, as a warning rather than an error: a genuinely quiet
        // application looks the same and must keep working.
        state.lock.lock()
        if !state.warned && !state.sawNonZero && Date().timeIntervalSince(state.startedAt) > 3.0 {
            state.warned = true
            emit("{\"event\":\"warning\",\"code\":\"silent_no_permission\"}")
        }
        state.lock.unlock()
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
    exit(2)
}
