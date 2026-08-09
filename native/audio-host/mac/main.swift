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
func audioObjectsInTree(of targetPid: pid_t) -> [AudioObjectID] {
    let all = objectIDs(kAudioHardwarePropertyProcessObjectList)
    return all.filter { obj in
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

@inline(__always)
func appendSample(_ pcm: inout [Int16], _ v: Float) {
    let clamped = max(-1.0, min(1.0, v))
    pcm.append(Int16(clamped * 32767.0))
}

func runCapture(pid: pid_t?) -> Int32 {
    var procObjs: [AudioObjectID] = []
    if let pid {
        procObjs = audioObjectsInTree(of: pid)
        guard !procObjs.isEmpty else {
            emitError("no_such_audio_process")
            return 1
        }
    }

    let tapUUID = UUID()
    // Excluding nothing yields a global tap; both variants are governed by the
    // same audio-capture permission.
    let desc = procObjs.isEmpty
        ? CATapDescription(stereoGlobalTapButExcludeProcesses: [])
        : CATapDescription(monoMixdownOfProcesses: procObjs)
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
    // Resample by the true ratio, not an integer one. Rounding it meant a
    // 44.1 kHz tap - the common case on macOS - emitted 22050 Hz while still
    // declaring 24000 Hz, so everything downstream ran ~9% fast; a 16 kHz tap
    // (a Bluetooth headset in HFP) was out by a third.
    let ratio = inRate / kOutRate

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

        while !gStop {
            let n = ring.read(into: &floats, minimum: 256)
            if n == 0 { if gStop { break } else { continue } }

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

            if !pcm.isEmpty {
                pcm.withUnsafeBufferPointer { bp in
                    let data = Data(bytes: bp.baseAddress!, count: bp.count * MemoryLayout<Int16>.size)
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

        if unexplainedSilence && isRenderingOutput(procObjs) {
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
