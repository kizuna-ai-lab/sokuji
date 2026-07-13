import { describe, it, expect } from 'vitest';
import { matchImportedFiles, filesToImportMap, ModelImportError, buildDownloadCommand } from './modelImport';

describe('matchImportedFiles', () => {
  it('matches by exact filename', () => {
    const r = matchImportedFiles(['config.json'], ['config.json']);
    expect(r.matched).toEqual({ 'config.json': 'config.json' });
    expect(r.missing).toEqual([]);
    expect(r.unexpected).toEqual([]);
  });

  it('matches a subpath file by relative-path suffix (directory pick)', () => {
    const r = matchImportedFiles(
      ['onnx/audio_encoder.onnx'],
      ['Voxtral-Mini-4B/onnx/audio_encoder.onnx'],
    );
    expect(r.matched).toEqual({ 'onnx/audio_encoder.onnx': 'Voxtral-Mini-4B/onnx/audio_encoder.onnx' });
    expect(r.missing).toEqual([]);
  });

  it('falls back to basename match when only flat filenames are provided', () => {
    const r = matchImportedFiles(['onnx/audio_encoder.onnx'], ['audio_encoder.onnx']);
    expect(r.matched).toEqual({ 'onnx/audio_encoder.onnx': 'audio_encoder.onnx' });
    expect(r.missing).toEqual([]);
  });

  it('reports missing expected files', () => {
    const r = matchImportedFiles(['a.json', 'b.onnx'], ['a.json']);
    expect(r.matched).toEqual({ 'a.json': 'a.json' });
    expect(r.missing).toEqual(['b.onnx']);
  });

  it('reports provided files that match nothing as unexpected', () => {
    const r = matchImportedFiles(['a.json'], ['a.json', 'notes.txt']);
    expect(r.unexpected).toEqual(['notes.txt']);
  });

  it('does not consume one provided file for two expected files', () => {
    // Two distinct expected files, only one provided → exactly one matched.
    const r = matchImportedFiles(['onnx/x.onnx', 'onnx/y.onnx'], ['x.onnx']);
    expect(Object.keys(r.matched)).toEqual(['onnx/x.onnx']);
    expect(r.missing).toEqual(['onnx/y.onnx']);
  });

  it('prefers an exact match over a basename collision', () => {
    // Provided has both a nested and a flat file; exact path wins for the nested one.
    const r = matchImportedFiles(
      ['onnx/model.onnx', 'model.onnx'],
      ['onnx/model.onnx', 'model.onnx'],
    );
    expect(r.matched['onnx/model.onnx']).toBe('onnx/model.onnx');
    expect(r.matched['model.onnx']).toBe('model.onnx');
    expect(r.missing).toEqual([]);
  });
});

describe('filesToImportMap', () => {
  it('keys files by webkitRelativePath when present, else by name', () => {
    const flat = { name: 'config.json' };
    const nested = { name: 'audio_encoder.onnx', webkitRelativePath: 'root/onnx/audio_encoder.onnx' };
    const map = filesToImportMap([flat, nested] as any);
    expect([...map.keys()]).toEqual(['config.json', 'root/onnx/audio_encoder.onnx']);
    expect(map.get('config.json')).toBe(flat);
    expect(map.get('root/onnx/audio_encoder.onnx')).toBe(nested);
  });
});

describe('buildDownloadCommand', () => {
  const files = [
    { filename: 'config.json', url: 'https://huggingface.co/org/repo/resolve/main/config.json' },
    { filename: 'onnx/audio_encoder_q4.onnx', url: 'https://huggingface.co/org/repo/resolve/main/onnx/audio_encoder_q4.onnx' },
  ];

  it('passes files to hf as positional args, not via --include', () => {
    // `hf download`'s --include takes ONE glob; extra args become positional
    // FILENAMES and --include is ignored — which silently drops the first file.
    // The correct form lists every file positionally.
    const cmd = buildDownloadCommand('hf', 'org/repo', 'my-model', files);
    expect(cmd).not.toContain('--include');
    expect(cmd).toContain('hf download org/repo');
    expect(cmd).toContain('HF_HUB_DISABLE_XET=1');
    expect(cmd).toContain('--local-dir my-model');
    // Every file — including the first, config.json — is present as a filename.
    expect(cmd).toContain('config.json');
    expect(cmd).toContain('onnx/audio_encoder_q4.onnx');
  });

  it('builds a per-file curl command that follows redirects and creates subdirs', () => {
    const cmd = buildDownloadCommand('curl', 'org/repo', 'my-model', files);
    expect(cmd).toContain('curl -L --create-dirs -o my-model/config.json');
    expect(cmd).toContain('https://huggingface.co/org/repo/resolve/main/config.json');
    expect(cmd).toContain('my-model/onnx/audio_encoder_q4.onnx');
  });

  it('falls back to curl when there is no HF repo (self-hosted model)', () => {
    const cmd = buildDownloadCommand('hf', undefined, 'my-model', files);
    expect(cmd).toContain('curl -L');
    expect(cmd).not.toContain('hf download');
  });

  it('cuts exactly the 4 HF path segments in wget, preserving the onnx/ subdir', () => {
    // HF resolve URL path is /org/repo/resolve/main/<file> — 4 directory
    // segments before the file. --cut-dirs=4 strips them and keeps onnx/ for
    // subpath files; over-cutting (5) would flatten onnx/x.onnx into the root.
    const cmd = buildDownloadCommand('wget', 'org/repo', 'my-model', files);
    expect(cmd).toContain('--cut-dirs=4');
    expect(cmd).not.toContain('--cut-dirs=5');
  });
});

describe('ModelImportError', () => {
  it('carries the missing and unexpected file lists', () => {
    const err = new ModelImportError(['b.onnx'], ['junk.txt']);
    expect(err.name).toBe('ModelImportError');
    expect(err.missing).toEqual(['b.onnx']);
    expect(err.unexpected).toEqual(['junk.txt']);
    expect(err.message).toMatch(/b\.onnx/);
  });
});
