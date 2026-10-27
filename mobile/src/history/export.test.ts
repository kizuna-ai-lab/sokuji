import { describe, it, expect } from 'vitest';
import { exportJson, exportText } from './export';
import type { StoredSession } from './store';
import { createTranscript } from '../session/transcript';

const labels = { me: 'Me', other: 'Other', noTranslation: '(no translation)', noSource: '(no source)', person: (n: number) => `Speaker ${n}` };
const header = { title: 'Sokuji transcript', generated: 'Generated', provider: 'Provider', models: 'Models', source: 'Source', target: 'Target', narrowed: 'Narrowed' };
const meta = { exportedAt: 1700000000000, appVersion: '1.0.0', provider: 'soniox', models: { stt: 'stt-rt-v5' } };

function session(lastStatus: string): StoredSession {
  const t = createTranscript({ source: 'en', target: 'zh', sessionId: 's1' });
  t.message([{ text: 'Good morning.', is_final: true, translation_status: 'original', language: 'en' }, { text: '<end>', is_final: true, translation_status: 'original' }]);
  t.message([{ text: '早上好。', is_final: true, translation_status: 'translation', language: 'zh' }, { text: '<end>', is_final: true, translation_status: 'translation' }]);
  return { id: 's1', startedAt: 1700000000000, endedAt: 1700000060000, source: 'en', target: 'zh', leg: t.leg(), lastStatus };
}

describe('exportText', () => {
  it('writes the header title, the source and the translation', () => {
    const txt = exportText(session('stopped'), labels, header, meta);
    expect(txt).toContain('Sokuji transcript');
    expect(txt).toContain('Good morning.');
    expect(txt).toContain('早上好。');
  });

  it('still exports a session that ended with sign-in required', () => {
    const txt = exportText(session('sign_in_required'), labels, header, meta);
    expect(txt).toContain('早上好。');
  });
});

describe('exportJson', () => {
  it('is the desktop JSON shape with the meta', () => {
    const json = JSON.parse(exportJson(session('stopped'), meta));
    expect(json.provider).toBe('soniox');
    expect(json.exportedAt).toBeDefined();
    expect(JSON.stringify(json)).toContain('早上好。');
  });
});
