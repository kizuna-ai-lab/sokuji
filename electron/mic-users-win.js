/**
 * Which applications are using a microphone right now, on Windows.
 *
 * A microphone another application holds in WASAPI exclusive mode makes our
 * capture fail with NotReadableError, and nothing in the renderer can tell
 * which application it is. Windows can: every client of a capture endpoint is
 * an audio session with a process id. Windows' privacy indicator store
 * (CapabilityAccessManager\ConsentStore) does not record an exclusive holder,
 * so the sessions are asked directly (spec 2026-10-13 §1).
 *
 * The probe is PowerShell with inline C#, so nothing new has to be built or
 * shipped. A PowerShell that refuses it (Constrained Language Mode, AppLocker,
 * a timeout) only means we cannot tell: the caller falls back to its general
 * wording.
 */

const { execFile: nodeExecFile } = require('child_process');

const PROBE = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom {}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices); }
[Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceCollection { int GetCount(out int count); int Item(int index, out IMMDevice device); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
  int OpenPropertyStore(int access, out IPropertyStore store);
}
[StructLayout(LayoutKind.Sequential)] struct PROPERTYKEY { public Guid fmtid; public int pid; }
[StructLayout(LayoutKind.Sequential)] struct PROPVARIANT { public short vt; short r1, r2, r3; public IntPtr p; IntPtr p2; }
[Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore { int GetCount(out int c); int GetAt(int i, out PROPERTYKEY k); int GetValue(ref PROPERTYKEY k, out PROPVARIANT v); }
[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionManager2 {
  int GetAudioSessionControl(IntPtr a, int b, out IntPtr c);
  int GetSimpleAudioVolume(IntPtr a, int b, out IntPtr c);
  int GetSessionEnumerator(out IAudioSessionEnumerator e);
}
[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionEnumerator { int GetCount(out int c); int GetSession(int i, out IAudioSessionControl2 s); }
[Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionControl2 {
  int GetState(out int state);
  int GetDisplayName(out IntPtr n); int SetDisplayName(IntPtr a, IntPtr b);
  int GetIconPath(out IntPtr n); int SetIconPath(IntPtr a, IntPtr b);
  int GetGroupingParam(out Guid g); int SetGroupingParam(IntPtr a, IntPtr b);
  int RegisterAudioSessionNotification(IntPtr a); int UnregisterAudioSessionNotification(IntPtr a);
  int GetSessionIdentifier(out IntPtr s); int GetSessionInstanceIdentifier(out IntPtr s);
  int GetProcessId(out int pid);
}
public class MicSession { public string device; public int pid; public string name; public string description; }
public static class MicSessions {
  public static List<MicSession> Active() {
    var found = new List<MicSession>();
    var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
    IMMDeviceCollection devices;
    enumerator.EnumAudioEndpoints(1 /* eCapture */, 1 /* DEVICE_STATE_ACTIVE */, out devices);
    int count; devices.GetCount(out count);
    var friendlyName = new PROPERTYKEY { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
    var managerId = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
    for (int i = 0; i < count; i++) {
      IMMDevice device; devices.Item(i, out device);
      IPropertyStore store; device.OpenPropertyStore(0 /* STGM_READ */, out store);
      PROPVARIANT value; store.GetValue(ref friendlyName, out value);
      string deviceName = Marshal.PtrToStringUni(value.p);
      // One row per device, so a device nobody uses still tells "found" from "no such device".
      found.Add(new MicSession { device = deviceName, pid = -1, name = "", description = "" });
      object manager;
      if (device.Activate(ref managerId, 23 /* CLSCTX_ALL */, IntPtr.Zero, out manager) != 0) continue;
      IAudioSessionEnumerator sessions; ((IAudioSessionManager2)manager).GetSessionEnumerator(out sessions);
      int n; sessions.GetCount(out n);
      for (int j = 0; j < n; j++) {
        IAudioSessionControl2 session; sessions.GetSession(j, out session);
        int state; session.GetState(out state);
        if (state != 1 /* AudioSessionStateActive */) continue;
        int pid; session.GetProcessId(out pid);
        string name = "", description = "";
        try {
          var process = Process.GetProcessById(pid);
          name = process.ProcessName;
          description = process.MainModule.FileVersionInfo.FileDescription ?? "";
        } catch {}
        found.Add(new MicSession { device = deviceName, pid = pid, name = name, description = description });
      }
    }
    return found;
  }
}
'@
$rows = @([MicSessions]::Active() | ForEach-Object {
  [pscustomobject]@{ device = $_.device; pid = $_.pid; name = $_.name; description = $_.description }
})
ConvertTo-Json -InputObject $rows -Compress
`;

/** Chromium appends " (vvvv:pppp)" to a USB device's label; Windows' own name has no such suffix. */
function deviceNameOf(label) {
  return label.replace(/ \([0-9a-f]{4}:[0-9a-f]{4}\)$/i, '');
}

/**
 * The applications using the capture device Chromium calls `label`.
 *
 * Answers `{ ok: true, users }` with their names when that device was found
 * (none: an empty list), `{ ok: true, users: null }` when no capture device by
 * that name has a session, and `{ ok: false, error }` when the probe could not
 * run. Never rejects.
 *
 * @param {string} label  The device label the renderer knows the microphone by
 * @param {{ ownPids?: number[], execFile?: Function, timeoutMs?: number }} [options]
 *   `ownPids`: Sokuji's own processes, left out of the answer
 */
function listMicrophoneUsers(label, { ownPids = [], execFile = nodeExecFile, timeoutMs = 4000 } = {}) {
  const encoded = Buffer.from(PROBE, 'utf16le').toString('base64');
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded];
  return new Promise((resolve) => {
    try {
      execFile('powershell.exe', args, { windowsHide: true, timeout: timeoutMs, encoding: 'utf8', maxBuffer: 1 << 20 }, (error, stdout) => {
        if (error) return resolve({ ok: false, error: error.message });
        let parsed;
        try {
          parsed = JSON.parse(stdout);
        } catch {
          return resolve({ ok: false, error: 'The probe did not answer with JSON' });
        }
        // PowerShell can still print a lone row as an object rather than an array of one.
        const sessions = Array.isArray(parsed) ? parsed : [parsed];
        const name = deviceNameOf(label);
        const onDevice = sessions.filter((s) => s && s.device === name);
        if (onDevice.length === 0) return resolve({ ok: true, users: null });
        const own = new Set(ownPids);
        // pid -1 is the probe's row for the device itself; 0 is the system's idle session.
        const users = onDevice
          .filter((s) => s.pid > 0 && !own.has(s.pid))
          .map((s) => s.description || `${s.name}.exe`);
        resolve({ ok: true, users: [...new Set(users)] });
      });
    } catch (error) {
      resolve({ ok: false, error: error.message });
    }
  });
}

module.exports = { listMicrophoneUsers, deviceNameOf };
