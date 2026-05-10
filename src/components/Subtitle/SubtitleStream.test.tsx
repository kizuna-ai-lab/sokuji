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

describe('SubtitleStream — compact mode (up to 4 equal-height lines)', () => {
  it('renders four lines (speaker src/tr, participant src/tr) when all are present', () => {
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
    const lines = container.querySelectorAll('.subtitle-stream__line');
    expect(lines.length).toBe(4);
    expect(container.querySelector('.subtitle-stream__line--speaker.subtitle-stream__line--source p')!.textContent).toBe('hello');
    expect(container.querySelector('.subtitle-stream__line--speaker.subtitle-stream__line--translation p')!.textContent).toBe('你好');
    expect(container.querySelector('.subtitle-stream__line--participant.subtitle-stream__line--source p')!.textContent).toBe('再见');
    expect(container.querySelector('.subtitle-stream__line--participant.subtitle-stream__line--translation p')!.textContent).toBe('goodbye');
  });

  it('drops the participant-translation line when participantMode is "source"', () => {
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
    const lines = container.querySelectorAll('.subtitle-stream__line');
    expect(lines.length).toBe(3);
    expect(container.querySelector('.subtitle-stream__line--participant.subtitle-stream__line--translation')).toBeNull();
  });

  it('renders only speaker lines when there are no participant items', () => {
    const speakerOnly = items.filter((i) => i.source === 'speaker');
    const { container } = render(
      <SubtitleStream
        items={speakerOnly}
        compact
        fontSize={24}
        speakerMode="both"
        participantMode="both"
        sourceLanguage="en"
        targetLanguage="zh"
      />,
    );
    const lines = container.querySelectorAll('.subtitle-stream__line');
    expect(lines.length).toBe(2);
    expect(container.querySelector('.subtitle-stream__line--participant')).toBeNull();
  });

  it('concatenates multiple items in the same bucket (chronological order)', () => {
    const many: any[] = [
      ...items,
      { id: '5', source: 'speaker', role: 'user', type: 'message', status: 'completed', formatted: { text: 'world' }, sourceLanguage: 'en', targetLanguage: 'zh' },
    ];
    const { container } = render(
      <SubtitleStream
        items={many}
        compact
        fontSize={24}
        speakerMode="both"
        participantMode="both"
        sourceLanguage="en"
        targetLanguage="zh"
      />,
    );
    const speakerSrc = container.querySelector('.subtitle-stream__line--speaker.subtitle-stream__line--source p')!;
    expect(speakerSrc.textContent).toBe('hello world');
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
    expect(root.style.getPropertyValue('--conversation-font-size')).toBe('36px');
  });
});

describe('SubtitleStream — expanded mode (per-item rows)', () => {
  it('renders one ConversationRow per visible item, no compact lines', () => {
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
    expect(container.querySelector('.subtitle-stream__line')).toBeNull();
  });
});
