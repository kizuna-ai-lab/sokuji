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

describe('SubtitleStream', () => {
  it('renders all 4 rows when both display modes are "both"', () => {
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
    expect(container.querySelectorAll('.conversation-row').length).toBe(4);
  });

  it('hides participant assistant when participantMode is "source"', () => {
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
    // 4 rows - 1 (participant assistant) = 3
    expect(container.querySelectorAll('.conversation-row').length).toBe(3);
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
  });
});
