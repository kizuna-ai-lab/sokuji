import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (k: string, d?: unknown, o?: Record<string, unknown>) =>
      typeof d === 'string' ? d.replace(/\{\{(\w+)\}\}/g, (_, n: string) => String(o?.[n])) : k,
  }),
}));

import RegionChangeConfirm from './RegionChangeConfirm';
import { useRegionChangeStore, type RegionChangeQuestion } from '../../stores/regionChangeStore';
import { useProviderStore } from '../../stores/providerStore';

const realAnswer = useRegionChangeStore.getState().answer;

const ask = (q: Partial<RegionChangeQuestion> = {}) =>
  act(() => {
    useRegionChangeStore.setState({
      question: { providerId: 'kizunaai_soniox', managed: true, from: 'us', to: 'jp', warning: { kind: 'built-in', name: 'Adrian' }, ...q },
    });
  });

beforeEach(() => {
  useRegionChangeStore.setState({ question: null, answer: realAnswer });
  useProviderStore.setState({ selectionLocked: false });
});

describe('RegionChangeConfirm', () => {
  it('renders nothing without a question', () => {
    render(<RegionChangeConfirm />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says what really happens: the built-in voice the new region will use, and the old voice staying', () => {
    render(<RegionChangeConfirm />);
    ask();
    const dialog = screen.getByRole('dialog', { name: 'Switch region?' });
    expect(dialog).toHaveTextContent("can't be used in 日本 (Japan)");
    expect(screen.getByText(/built-in voice Adrian/)).toBeTruthy();
    expect(dialog).toHaveTextContent('switching back to United States uses it again');
    expect(screen.getByRole('button', { name: 'Switch to 日本 (Japan)' })).toBeTruthy();
  });

  it('says the custom voice there is used, for a managed account with a voice in the new region', () => {
    render(<RegionChangeConfirm />);
    ask({ warning: { kind: 'custom' } });
    expect(screen.getByRole('dialog')).toHaveTextContent('Sessions in 日本 (Japan) will use the custom voice you created there. Your United States voice stays in United States.');
  });

  it('names the user’s own Soniox project for an own key, and the custom voice there when it has one', () => {
    render(<RegionChangeConfirm />);
    ask({ providerId: 'soniox', managed: false });
    expect(screen.getByRole('dialog')).toHaveTextContent('in your United States Soniox project');
    expect(screen.getByRole('dialog')).toHaveTextContent('create a custom voice in your 日本 (Japan) project');
    ask({ providerId: 'soniox', managed: false, warning: { kind: 'custom' } });
    expect(screen.getByRole('dialog')).toHaveTextContent('the custom voice in your 日本 (Japan) Soniox project');
  });

  it('Switch answers true; Cancel and × answer false', () => {
    const answer = vi.fn();
    useRegionChangeStore.setState({ answer });
    render(<RegionChangeConfirm />);
    ask();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to 日本 (Japan)' }));
    expect(answer).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(answer).toHaveBeenLastCalledWith(false);
    fireEvent.click(document.querySelector('.close-button') as HTMLElement);
    expect(answer).toHaveBeenCalledTimes(3);
    expect(answer).toHaveBeenLastCalledWith(false);
  });

  it('a session starting while the question is open answers it false and closes it', async () => {
    render(<RegionChangeConfirm />);
    let answered!: Promise<boolean>;
    act(() => {
      answered = useRegionChangeStore.getState().ask({ providerId: 'kizunaai_soniox', managed: true, from: 'us', to: 'jp', warning: { kind: 'built-in', name: 'Adrian' } });
    });
    expect(screen.getByRole('dialog')).toBeTruthy();
    act(() => { useProviderStore.setState({ selectionLocked: true }); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useRegionChangeStore.getState().question).toBeNull();
    await expect(answered).resolves.toBe(false);
  });
});
