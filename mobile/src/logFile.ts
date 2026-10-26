import { File, Paths } from 'expo-file-system';

// Gate A log on disk, so a tester's run can be read from the Mac after the fact:
// Android `adb shell run-as <package> cat files/gate-a.log`, iOS `devicectl device
// copy from --domain-type appDataContainer`. One file per session start.
let current: File | null = null;

export function openLogFile(): string {
  const name = `gate-a-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  current = new File(Paths.document, name);
  current.create();
  return current.uri;
}

export function appendLog(line: string): void {
  try {
    current?.writeSync(`${line}\n`, { append: true });
  } catch {
    // The on-screen log still has the line; a full disk must not stop the session.
  }
}
