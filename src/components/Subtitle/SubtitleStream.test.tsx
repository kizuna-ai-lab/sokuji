import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import SubtitleStream from './SubtitleStream';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

const items: any[] = [
  { id: '1', source: 'speaker',     role: 'user',      type: 'message', status: 'completed', formatted: { text: 'hello' },   sourceLanguage: 'en', targetLanguage: 'zh' },
  { id: '2', source: 'speaker',     role: 'assistant', type: 'message', status: 'completed', formatted: { text: '你好' },     sourceLanguage: 'en', targetLanguage: 'zh' },
  { id: '3', source: 'participant', role: 'user',      type: 'message', status: 'completed', formatted: { text: '再见' },    sourceLanguage: 'en', targetLanguage: 'zh' },
  { id: '4', source: 'participant', role: 'assistant', type: 'message', status: 'completed', formatted: { text: 'goodbye' },  sourceLanguage: 'en', targetLanguage: 'zh' },
];

describe('SubtitleStream — compact mode (flat two-line)', () => {
  it('concatenates user items into the source line and assistant items into the translation line', () => {
    const { container } = render(
      <SubtitleStream
        items={items}
        compact
        fontSize={24}
        speakerMode="both"
        participantMode="both"
        sourceLanguage="en"
        targetLanguage="zh"
      />,
    );
    const source = container.querySelector('.subtitle-stream__source')!;
    const translation = container.querySelector('.subtitle-stream__translation')!;
    expect(source.textContent).toBe('hello 再见');
    expect(translation.textContent).toBe('你好 goodbye');
  });

  it('respects participantMode="source": drops participant assistant from translation line', () => {
    const { container } = render(
      <SubtitleStream
        items={items}
        compact
        fontSize={24}
        speakerMode="both"
        participantMode="source"
        sourceLanguage="en"
        targetLanguage="zh"
      />,
    );
    const translation = container.querySelector('.subtitle-stream__translation')!;
    // participant assistant ('goodbye') hidden; only speaker assistant remains
    expect(translation.textContent).toBe('你好');
  });

  it('applies fontSize and color CSS variables', () => {
    const { container } = render(
      <SubtitleStream
        items={items}
        compact
        fontSize={36}
        speakerMode="both"
        participantMode="both"
        sourceLanguage="en"
        targetLanguage="zh"
        sourceTextColor="#FF0000"
        translationTextColor="#00FF00"
      />,
    );
    const root = container.querySelector('.subtitle-stream') as HTMLElement;
    expect(root.style.fontSize).toBe('36px');
    expect(root.style.getPropertyValue('--subtitle-source-color')).toBe('#FF0000');
    expect(root.style.getPropertyValue('--subtitle-translation-color')).toBe('#00FF00');
    // Also propagates to the var ConversationRow reads in expanded mode
    expect(root.style.getPropertyValue('--conversation-font-size')).toBe('36px');
  });
});

describe('SubtitleStream — expanded mode (per-item rows)', () => {
  it('renders one ConversationRow per visible item, no flat lines', () => {
    const { container } = render(
      <SubtitleStream
        items={items}
        compact={false}
        fontSize={24}
        speakerMode="both"
        participantMode="both"
        sourceLanguage="en"
        targetLanguage="zh"
      />,
    );
    expect(container.querySelectorAll('.conversation-row').length).toBe(4);
    expect(container.querySelector('.subtitle-stream__source')).toBeNull();
    expect(container.querySelector('.subtitle-stream__translation')).toBeNull();
  });
});
