import { File, Paths } from 'expo-file-system';

// Development builds only: the session log on disk, so a tester's run can be
// read from the Mac after the fact (Android `adb shell run-as <package> cat
// files/<log>`, iOS `devicectl device copy from --domain-type
// appDataContainer`). One file per session start. Release builds write nothing.
const DEV = typeof __DEV__ === 'boolean' && __DEV__;
let current: File | null = null;

export function openLogFile(): string {
  if (!DEV) return '';
  const name = `session-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  current = new File(Paths.document, name);
  current.create();
  return current.uri;
}

export function appendLog(line: string): void {
  if (!DEV) return;
  try {
    current?.writeSync(`${line}\n`, { append: true });
  } catch {
    // A full disk must not stop the session.
  }
}
