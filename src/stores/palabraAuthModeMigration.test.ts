import { describe, it, expect } from 'vitest';
import { migratePalabraAuthMode } from './settingsStore';

describe('migratePalabraAuthMode', () => {
  it('keeps an explicitly stored app mode', () => {
    expect(migratePalabraAuthMode('app', { clientId: '', clientSecret: '' })).toEqual({});
  });

  it('keeps an explicitly stored platform mode even when legacy credentials exist', () => {
    expect(migratePalabraAuthMode('platform', { clientId: 'id', clientSecret: 'sec' })).toEqual({});
  });

  it('pins a legacy user (stored credentials, never chose a mode) to app', () => {
    expect(migratePalabraAuthMode('', { clientId: 'id', clientSecret: 'sec' })).toEqual({ authMode: 'app' });
  });

  it('pins to app when only one legacy field is present', () => {
    expect(migratePalabraAuthMode('', { clientId: 'id', clientSecret: '' })).toEqual({ authMode: 'app' });
    expect(migratePalabraAuthMode('', { clientId: '', clientSecret: 'sec' })).toEqual({ authMode: 'app' });
  });

  it('leaves a fresh install on the platform default', () => {
    expect(migratePalabraAuthMode('', { clientId: '', clientSecret: '' })).toEqual({ authMode: 'platform' });
  });
});
