import { describe, it, expect } from 'vitest';
import { exportFilename } from './conversationExport';

describe('exportFilename', () => {
  it('stamps local time and the extension', () => {
    const ts = new Date(2026, 8, 18, 9, 5, 7).getTime();
    expect(exportFilename('txt', ts)).toBe('sokuji-conversation-20260918-090507.txt');
    expect(exportFilename('json', ts)).toBe('sokuji-conversation-20260918-090507.json');
  });
});
