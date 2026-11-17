// B-11: a Soniox key belongs to one region's project; the account page asks every region which one accepts it.
import { describe, it, expect, vi } from 'vitest';
import { regionsAccepting } from './keyRegion';
import type { SonioxCredentials, SonioxSettings } from './settings';
import type { CheckResult } from '../../lib/provider/types';

const settings = { region: 'jp' } as SonioxSettings;
const refused: CheckResult = { ok: false, code: 'auth', reason: 'HTTP 401' };

describe('regionsAccepting', () => {
  it('asks every region with the key, and says which accept it', async () => {
    const check = vi.fn(async (k: SonioxCredentials): Promise<CheckResult> => (k.region === 'us' ? { ok: true } : refused));
    const answer = await regionsAccepting('sk-1', settings, check);
    expect(answer).toEqual({ accepted: ['us'], unreachable: [] });
    expect(check.mock.calls.map(([k]) => [k.region, k.stt, k.tts])).toEqual([['us', 'sk-1', 'sk-1'], ['eu', 'sk-1', 'sk-1'], ['jp', 'sk-1', 'sk-1'], ['in', 'sk-1', 'sk-1']]);
  });

  it('says which regions could not be asked', async () => {
    const check = vi.fn(async (k: SonioxCredentials): Promise<CheckResult> => {
      if (k.region === 'eu') throw new Error('offline');
      return refused;
    });
    expect(await regionsAccepting('sk-1', settings, check)).toEqual({ accepted: [], unreachable: ['eu'] });
  });

  it('keeps the regions in their usual order whatever answers first', async () => {
    const check = vi.fn(async (k: SonioxCredentials): Promise<CheckResult> => {
      await new Promise((r) => setTimeout(r, k.region === 'us' ? 5 : 0));
      return { ok: true };
    });
    expect((await regionsAccepting('sk-1', settings, check)).accepted).toEqual(['us', 'eu', 'jp', 'in']);
  });

  it('trims the key it is given', async () => {
    const check = vi.fn(async (_k: SonioxCredentials): Promise<CheckResult> => refused);
    await regionsAccepting('  sk-1 \n', settings, check);
    expect(check.mock.calls[0][0].stt).toBe('sk-1');
  });
});
