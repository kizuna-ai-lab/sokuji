import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { exportFileName } from './export';
import type { StoredSession } from './store';

// Kept apart from export.ts, which the node tests import: these two modules are native.
/** Writes the export to the cache directory and opens the system share sheet on it. */
export async function shareExport(s: StoredSession, kind: 'txt' | 'json', body: string): Promise<void> {
  const f = new File(Paths.cache, exportFileName(s.startedAt, kind));
  f.write(body);
  await Sharing.shareAsync(f.uri, { mimeType: kind === 'txt' ? 'text/plain' : 'application/json', dialogTitle: f.name });
}
