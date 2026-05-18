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

  it('drops items beyond BUCKET_MAX_CHARS to keep the band fast', () => {
    // ~2000-char cap; 10 × 250-char items = 2500 chars total → at least one drops.
    const bigItems: any[] = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      source: 'speaker',
      role: 'user',
      type: 'message',
      status: 'completed',
      formatted: { text: 'x'.repeat(250) },
      sourceLanguage: 'en',
      targetLanguage: 'zh',
    }));
    const { container } = render(
      <SubtitleStream
        items={bigItems}
        compact
        fontSize={24}
        speakerMode="both"
        participantMode="both"
        sourceLanguage="en"
        targetLanguage="zh"
      />,
    );
    const spans = container.querySelectorAll(
      '.subtitle-stream__line--speaker.subtitle-stream__line--source .subtitle-stream__item',
    );
    expect(spans.length).toBeLessThan(10);
    expect(spans.length).toBeGreaterThan(0);
  });

  it('renders one span per visible item with the item id as the key', () => {
    const many: any[] = [
      { id: '1', source: 'speaker', role: 'user', type: 'message', status: 'completed', formatted: { text: 'hello' },  sourceLanguage: 'en', targetLanguage: 'zh' },
      { id: '5', source: 'speaker', role: 'user', type: 'message', status: 'completed', formatted: { text: 'world' },  sourceLanguage: 'en', targetLanguage: 'zh' },
      { id: '9', source: 'speaker', role: 'user', type: 'message', status: 'completed', formatted: { text: 'again' }, sourceLanguage: 'en', targetLanguage: 'zh' },
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
    const spans = container.querySelectorAll(
      '.subtitle-stream__line--speaker.subtitle-stream__line--source .subtitle-stream__item',
    );
    expect(spans.length).toBe(3);
    // Chronological order: oldest first
    expect(spans[0].textContent).toBe('hello');
    expect(spans[1].textContent).toBe(' world');
    expect(spans[2].textContent).toBe(' again');
  });

  it('routes error / system items into the translation bucket so they remain visible', () => {
    const withError: any[] = [
      ...items,
      { id: 'e1', source: 'speaker', role: 'system', type: 'error', status: 'completed', formatted: { text: '[error] connection lost' }, sourceLanguage: 'en', targetLanguage: 'zh' },
    ];
    const { container } = render(
      <SubtitleStream
        items={withError}
        compact
        fontSize={24}
        speakerMode="both"
        participantMode="both"
        sourceLanguage="en"
        targetLanguage="zh"
      />,
    );
    const speakerTr = container.querySelector('.subtitle-stream__line--speaker.subtitle-stream__line--translation p')!;
    expect(speakerTr.textContent).toContain('[error] connection lost');
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

  it('does not mark items as new on the very first render (no flash for pre-existing items)', () => {
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
    const newSpans = container.querySelectorAll('.subtitle-stream__item--new');
    expect(newSpans.length).toBe(0);
  });

  it('marks only items that arrive after the first render as new', () => {
    const { container, rerender } = render(
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
    // First render — none should be new
    expect(container.querySelectorAll('.subtitle-stream__item--new').length).toBe(0);

    // A new speaker source item arrives
    const arrived: any[] = [
      ...items,
      { id: 'NEW1', source: 'speaker', role: 'user', type: 'message', status: 'completed', formatted: { text: 'just arrived' }, sourceLanguage: 'en', targetLanguage: 'zh' },
    ];
    rerender(
      <SubtitleStream
        items={arrived}
        compact
        fontSize={24}
        speakerMode="both"
        participantMode="both"
        sourceLanguage="en"
        targetLanguage="zh"
      />,
    );
    const newSpans = container.querySelectorAll('.subtitle-stream__item--new');
    expect(newSpans.length).toBe(1);
    expect(newSpans[0].textContent).toContain('just arrived');
  });

  it('suppresses the --new class when newItemHighlightEnabled is false', () => {
    const { container, rerender } = render(
      <SubtitleStream
        items={[] as any[]}
        compact
        fontSize={24}
        speakerMode="both"
        participantMode="both"
        sourceLanguage="en"
        targetLanguage="zh"
        newItemHighlightEnabled={false}
      />,
    );
    // Item arrives post-mount — would be 'new' if the highlight were enabled.
    const arrived: any[] = [
      { id: 'AFTER', source: 'speaker', role: 'user', type: 'message', status: 'completed', formatted: { text: 'after mount' }, sourceLanguage: 'en', targetLanguage: 'zh' },
    ];
    rerender(
      <SubtitleStream
        items={arrived}
        compact
        fontSize={24}
        speakerMode="both"
        participantMode="both"
        sourceLanguage="en"
        targetLanguage="zh"
        newItemHighlightEnabled={false}
      />,
    );
    // Span exists, just without the highlight modifier.
    expect(container.querySelectorAll('.subtitle-stream__item').length).toBe(1);
    expect(container.querySelectorAll('.subtitle-stream__item--new').length).toBe(0);
  });

  it('does not re-toggle the --new class when a streaming item grows in place', () => {
    // Empty first render so the streaming item isn't classified 'existing'.
    const { container, rerender } = render(
      <SubtitleStream
        items={[] as any[]}
        compact
        fontSize={24}
        speakerMode="both"
        participantMode="both"
        sourceLanguage="en"
        targetLanguage="zh"
      />,
    );
    expect(container.querySelectorAll('.subtitle-stream__item--new').length).toBe(0);

    // Streaming item arrives post-mount → classified 'new', should animate.
    const partial: any[] = [
      { id: 'GROW', source: 'speaker', role: 'user', type: 'message', status: 'in_progress', formatted: { text: 'Hel' }, sourceLanguage: 'en', targetLanguage: 'zh' },
    ];
    rerender(
      <SubtitleStream
        items={partial}
        compact
        fontSize={24}
        speakerMode="both"
        participantMode="both"
        sourceLanguage="en"
        targetLanguage="zh"
      />,
    );
    const afterArrival = container.querySelectorAll('.subtitle-stream__item--new');
    expect(afterArrival.length).toBe(1);
    expect(afterArrival[0].textContent).toContain('Hel');

    // Same id, more text — state must remain 'new' (no re-toggle, no extra spans).
    const grown: any[] = [
      { id: 'GROW', source: 'speaker', role: 'user', type: 'message', status: 'completed', formatted: { text: 'Hello world' }, sourceLanguage: 'en', targetLanguage: 'zh' },
    ];
    rerender(
      <SubtitleStream
        items={grown}
        compact
        fontSize={24}
        speakerMode="both"
        participantMode="both"
        sourceLanguage="en"
        targetLanguage="zh"
      />,
    );
    const afterGrowth = container.querySelectorAll('.subtitle-stream__item--new');
    expect(afterGrowth.length).toBe(1);
    expect(afterGrowth[0].textContent).toContain('Hello world');
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
