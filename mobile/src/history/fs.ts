import { Directory, File, Paths } from 'expo-file-system';
import type { HistoryFs } from './store';

// The document directory, where the sessions live.
export const documentFs: HistoryFs = {
  async read(path) {
    const f = new File(Paths.document, path);
    return f.exists ? f.text() : null;
  },
  async write(path, body) {
    const f = new File(Paths.document, path);
    const dir = new Directory(f.parentDirectory.uri);
    if (!dir.exists) dir.create({ intermediates: true });
    f.write(body);
  },
  async removeDir(path) {
    const dir = new Directory(Paths.document, path);
    if (dir.exists) dir.delete();
  },
  async listDirs(path) {
    const dir = new Directory(Paths.document, path);
    if (!dir.exists) return [];
    return dir.list().filter((entry): entry is Directory => entry instanceof Directory).map((d) => d.name);
  },
};
