import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React, { useRef } from 'react';
import { usePlaybackStore, usePlaybackHighlight } from './playbackStore';

function resetStore() {
  usePlaybackStore.setState({
    playingItemId: null,
    currentTime: null,
    progressRatio: 0,
    _cumOffset: 0,
    _lastBt: 0,
    _lastCt: 0,
    _maxProgress: 0,
    _raw: null,
  });
}

function Probe({ item, textOverride }: { item: any; textOverride?: string }) {
  const { isPlaying, highlightedChars } = usePlaybackHighlight(item, textOverride);
  const renders = useRef(0);
  renders.current += 1;
  return (
    <div>
      <span data-testid="playing">{String(isPlaying)}</span>
      <span data-testid="chars">{highlightedChars}</span>
      <span data-testid="renders">{renders.current}</span>
    </div>
  );
}

describe('usePlaybackHighlight', () => {
  beforeEach(resetStore);

  it('returns isPlaying=false / 0 when item is null', () => {
    render(<Probe item={null} />);
    expect(screen.getByTestId('playing').textContent).toBe('false');
    expect(screen.getByTestId('chars').textContent).toBe('0');
  });

  it('returns isPlaying=true with linear fallback when no audioSegments', () => {
    const item = { id: 'item_a', formatted: { text: 'Hello world' } };
    act(() => {
      usePlaybackStore.getState().setPlayingItem('item_a');
      usePlaybackStore.setState({ progressRatio: 0.5, currentTime: 2.0 });
    });
    render(<Probe item={item} />);
    expect(screen.getByTestId('playing').textContent).toBe('true');
    expect(screen.getByTestId('chars').textContent).toBe('5'); // floor(11 * 0.5)
  });

  it('uses audioSegments when present', () => {
    const item = {
      id: 'item_a',
      formatted: {
        transcript: 'Hello world',
        audioSegments: [
          { textEnd: 5, audioEnd: 1.0 },
          { textEnd: 11, audioEnd: 2.0 },
        ],
      },
    };
    act(() => {
      usePlaybackStore.getState().setPlayingItem('item_a');
      usePlaybackStore.setState({ currentTime: 1.5, progressRatio: 0 });
    });
    render(<Probe item={item} />);
    // 1.5s → 0.5/1.0 through seg 2 (textEnd 11, prev 5, width 6) → 5 + 3 = 8
    expect(screen.getByTestId('chars').textContent).toBe('8');
  });

  it('non-playing item does not re-render on currentTime tick', () => {
    const itemA = { id: 'item_a', formatted: { text: 'A' } };
    act(() => {
      usePlaybackStore.getState().setPlayingItem('item_b');
      usePlaybackStore.setState({ currentTime: 1.0, progressRatio: 0.1 });
    });
    render(<Probe item={itemA} />);
    const initialRenders = Number(screen.getByTestId('renders').textContent);

    act(() => {
      usePlaybackStore.setState({ currentTime: 1.1, progressRatio: 0.2 });
    });
    act(() => {
      usePlaybackStore.setState({ currentTime: 1.2, progressRatio: 0.3 });
    });

    const finalRenders = Number(screen.getByTestId('renders').textContent);
    expect(finalRenders).toBe(initialRenders);
  });

  it('uses textOverride length for indexing when provided', () => {
    // Provider has leading whitespace in transcript; SubtitleStream renders
    // a trimmed copy. The hook must index against what the caller renders.
    const item = {
      id: 'item_a',
      formatted: { text: '  Hello' }, // 7 chars including 2 leading spaces
    };
    act(() => {
      usePlaybackStore.getState().setPlayingItem('item_a');
      usePlaybackStore.setState({ progressRatio: 1.0, currentTime: 0 });
    });
    // With override 'Hello' (5 chars), full progress → 5
    render(<Probe item={item as any} textOverride="Hello" />);
    expect(screen.getByTestId('chars').textContent).toBe('5');
  });

  it('with audioSegments + textOverride, shifts indices by leading-trim offset', () => {
    // Provider returned a transcript with leading whitespace AND
    // per-segment audioSegments. Segment textEnd values index the original
    // (untrimmed) string. The caller (SubtitleStream's CompactSpan) renders
    // the trimmed copy, so highlightedChars must be relative to that.
    const item = {
      id: 'item_a',
      formatted: {
        text: '  Hello world',
        audioSegments: [
          { textEnd: 7, audioEnd: 1.0 },  // "  Hello" (original-indexed)
          { textEnd: 13, audioEnd: 2.0 }, // "  Hello world"
        ],
      },
    };
    act(() => {
      usePlaybackStore.getState().setPlayingItem('item_a');
      usePlaybackStore.setState({ currentTime: 1.5, progressRatio: 0 });
    });
    // 1.5s → 0.5/1.0 through seg 2 (width 6) → rawIndex = 7 + 3 = 10 in original.
    // Override "Hello world" (11 chars) strips 2 leading spaces, so the rendered
    // index is 10 - 2 = 8 → highlight covers "Hello wo".
    render(<Probe item={item as any} textOverride="Hello world" />);
    expect(screen.getByTestId('chars').textContent).toBe('8');
  });

  it('with audioSegments + textOverride, clamps index to rendered length', () => {
    // Trailing whitespace stripped by trim should not produce out-of-range
    // slice indices: rawIndex past renderedText.length is clamped.
    const item = {
      id: 'item_a',
      formatted: {
        text: 'Hello  ', // trailing whitespace
        audioSegments: [{ textEnd: 7, audioEnd: 1.0 }],
      },
    };
    act(() => {
      usePlaybackStore.getState().setPlayingItem('item_a');
      usePlaybackStore.setState({ currentTime: 0.99, progressRatio: 0 });
    });
    // Just before audioEnd: rawIndex approaches 7 (full original length).
    // Trimmed override "Hello" is 5 chars → clamp to 5.
    render(<Probe item={item as any} textOverride="Hello" />);
    expect(Number(screen.getByTestId('chars').textContent)).toBeLessThanOrEqual(5);
  });
});
