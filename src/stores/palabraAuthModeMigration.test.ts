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

  it('treats whitespace-only legacy credentials as absent', () => {
    // extractCredentials trims and rejects whitespace-only values, so pinning
    // such a slice to app mode would strand the user on unusable credentials.
    expect(migratePalabraAuthMode('', { clientId: '   ', clientSecret: '' })).toEqual({ authMode: 'platform' });
    expect(migratePalabraAuthMode('', { clientId: '', clientSecret: '  ' })).toEqual({ authMode: 'platform' });
  });

  it('treats an unrecognized stored value as never stored', () => {
    // e.g. corrupted storage or a foreign value like 'Platform' (wrong case)
    expect(migratePalabraAuthMode('Platform', { clientId: 'id', clientSecret: 'sec' })).toEqual({ authMode: 'app' });
    expect(migratePalabraAuthMode('garbage', { clientId: '', clientSecret: '' })).toEqual({ authMode: 'platform' });
  });
});
