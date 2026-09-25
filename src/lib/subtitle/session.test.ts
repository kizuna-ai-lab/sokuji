import { describe, it, expect } from 'vitest';
import type { RunState } from '../session/types';
import { idleOf, sameSession, subtitleSession } from './session';

const idle: RunState = { phase: 'idle' };
const input = { run: idle, readiness: { state: 'ready' as const, models: [] }, pair: { source: 'en', target: 'ja' }, turnMode: 'auto' as const, legs: ['speaker' as const] };

describe('idleOf', () => {
  it('shows a start under way first', () => {
    expect(idleOf({ phase: 'starting', step: 'opening' }, { state: 'not-ready', reason: 'no model' })).toEqual({ kind: 'starting' });
  });

  it("puts a provider that is not ready before an older failure", () => {
    const run: RunState = { phase: 'idle', lastEnd: { reason: 'start-failed', notice: { code: 'start_failed', message: 'boom' } } };
    expect(idleOf(run, { state: 'not-ready', reason: 'Download a model first.' })).toEqual({ kind: 'unready', message: 'Download a model first.' });
  });

  it("carries the provider's readiness code and params into the idle model", () => {
    expect(idleOf({ phase: 'idle' }, { state: 'not-ready', reason: 'r', code: 'no_asr', params: { source: 'en' } }))
      .toEqual({ kind: 'unready', message: 'r', code: 'no_asr', params: { source: 'en' } });
  });

  it('calls a refused or failed start a failure, with its notice', () => {
    const notice = { code: 'build_refused', message: 'no' };
    expect(idleOf({ phase: 'idle', lastEnd: { reason: 'refused', notice } }, undefined)).toEqual({ kind: 'failed', notice });
    expect(idleOf({ phase: 'idle', lastEnd: { reason: 'start-failed', notice } }, undefined)).toMatchObject({ kind: 'failed' });
  });

  it('calls any other end an ending — a run that failed mid-way included — and stopping too', () => {
    expect(idleOf({ phase: 'idle', lastEnd: { reason: 'user' } }, undefined)).toEqual({ kind: 'ended' });
    expect(idleOf({ phase: 'idle', lastEnd: { reason: 'leg-failed', notice: { code: 'leg_failed', message: 'x' } } }, undefined)).toEqual({ kind: 'ended' });
    expect(idleOf({ phase: 'stopping' }, undefined)).toEqual({ kind: 'ended' });
  });

  it('is ready before any run', () => {
    expect(idleOf(idle, undefined)).toEqual({ kind: 'ready' });
  });
});

describe('subtitleSession', () => {
  it('carries the phase, the time the run went live, and offers hold-to-talk only while running with manual turns', () => {
    const running: RunState = { phase: 'running', since: 1000, legs: { speaker: 'live' } };
    expect(subtitleSession({ ...input, run: running, turnMode: 'push-to-talk' })).toMatchObject({ phase: 'running', since: 1000, holdToTalk: true });
    expect(subtitleSession({ ...input, run: running }).holdToTalk).toBe(false);
    expect(subtitleSession({ ...input, turnMode: 'push-to-talk' })).toMatchObject({ since: null, holdToTalk: false });
  });

  it('allows a start only while idle and not blocked by the provider', () => {
    expect(subtitleSession(input).canStart).toBe(true);
    expect(subtitleSession({ ...input, readiness: undefined }).canStart).toBe(true);
    expect(subtitleSession({ ...input, readiness: { state: 'not-ready', reason: 'x' } }).canStart).toBe(false);
    expect(subtitleSession({ ...input, readiness: { state: 'checking' } }).canStart).toBe(false);
    expect(subtitleSession({ ...input, run: { phase: 'starting', step: 'checking' } }).canStart).toBe(false);
  });
});

describe('sameSession', () => {
  it('compares by value', () => {
    expect(sameSession(subtitleSession(input), subtitleSession({ ...input, legs: ['speaker'], pair: { source: 'en', target: 'ja' } }))).toBe(true);
    expect(sameSession(subtitleSession(input), subtitleSession({ ...input, legs: ['speaker', 'participant'] }))).toBe(false);
    expect(sameSession(subtitleSession(input), subtitleSession({ ...input, readiness: { state: 'not-ready', reason: 'x' } }))).toBe(false);
  });

  it('treats a different code, or different params, as a different idle body', () => {
    const withCode = (code: string, params: Record<string, string>) => subtitleSession({ ...input, readiness: { state: 'not-ready', reason: 'r', code, params } });
    expect(sameSession(withCode('no_asr', { source: 'en' }), withCode('local_models_missing', { source: 'en' }))).toBe(false);
    expect(sameSession(withCode('no_asr', { source: 'en' }), withCode('no_asr', { source: 'ja' }))).toBe(false);
  });
});
