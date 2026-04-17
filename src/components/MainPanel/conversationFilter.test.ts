import { describe, it, expect } from 'vitest';
import type { ConversationItem } from '../../services/interfaces/IClient';
import { shouldShowItem } from './conversationFilter';

const baseItem = (over: Partial<ConversationItem>): ConversationItem => ({
  id: 'i',
  role: 'user',
  type: 'message',
  status: 'completed',
  formatted: { text: 't' },
  ...over,
});

describe('shouldShowItem', () => {
  it('keeps speaker source when speakerMode=source', () => {
    const item = baseItem({ source: 'speaker', role: 'user' });
    expect(shouldShowItem(item, 'source', 'both')).toBe(true);
  });

  it('hides speaker translation when speakerMode=source', () => {
    const item = baseItem({ source: 'speaker', role: 'assistant' });
    expect(shouldShowItem(item, 'source', 'both')).toBe(false);
  });

  it('hides speaker source when speakerMode=translation', () => {
    const item = baseItem({ source: 'speaker', role: 'user' });
    expect(shouldShowItem(item, 'translation', 'both')).toBe(false);
  });

  it('keeps speaker translation when speakerMode=translation', () => {
    const item = baseItem({ source: 'speaker', role: 'assistant' });
    expect(shouldShowItem(item, 'translation', 'both')).toBe(true);
  });

  it('keeps both speaker roles when speakerMode=both', () => {
    expect(shouldShowItem(baseItem({ source: 'speaker', role: 'user' }), 'both', 'both')).toBe(true);
    expect(shouldShowItem(baseItem({ source: 'speaker', role: 'assistant' }), 'both', 'both')).toBe(true);
  });

  it('keeps participant source when participantMode=source', () => {
    const item = baseItem({ source: 'participant', role: 'user' });
    expect(shouldShowItem(item, 'both', 'source')).toBe(true);
  });

  it('hides participant translation when participantMode=source', () => {
    const item = baseItem({ source: 'participant', role: 'assistant' });
    expect(shouldShowItem(item, 'both', 'source')).toBe(false);
  });

  it('hides participant source when participantMode=translation', () => {
    const item = baseItem({ source: 'participant', role: 'user' });
    expect(shouldShowItem(item, 'both', 'translation')).toBe(false);
  });

  it('keeps participant translation when participantMode=translation', () => {
    const item = baseItem({ source: 'participant', role: 'assistant' });
    expect(shouldShowItem(item, 'both', 'translation')).toBe(true);
  });

  it('applies speaker mode to items without a source field (default speaker)', () => {
    const item = baseItem({ source: undefined, role: 'assistant' });
    expect(shouldShowItem(item, 'source', 'both')).toBe(false);
    expect(shouldShowItem(item, 'translation', 'both')).toBe(true);
  });

  it('always shows error items regardless of filter', () => {
    const item = baseItem({ type: 'error', role: 'assistant', source: 'speaker' });
    expect(shouldShowItem(item, 'source', 'source')).toBe(true);
  });

  it('always shows system-role items regardless of filter', () => {
    const item = baseItem({ role: 'system', source: 'speaker' });
    expect(shouldShowItem(item, 'source', 'source')).toBe(true);
  });

  it('always shows function_call items regardless of filter', () => {
    // Tool calls arrive with role='assistant' but type='function_call'; they
    // must NOT be filtered out when the user picks source-only or translation-only.
    const item = baseItem({ type: 'function_call', role: 'assistant', source: 'speaker' });
    expect(shouldShowItem(item, 'source', 'source')).toBe(true);
    expect(shouldShowItem(item, 'translation', 'translation')).toBe(true);
  });

  it('always shows function_call_output items regardless of filter', () => {
    const item = baseItem({ type: 'function_call_output', role: 'assistant', source: 'speaker' });
    expect(shouldShowItem(item, 'source', 'source')).toBe(true);
    expect(shouldShowItem(item, 'translation', 'translation')).toBe(true);
  });
});
