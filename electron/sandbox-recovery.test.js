import { describe, it, expect, vi } from 'vitest';
import {
  parseIcaclsAces,
  findExplicitOrphanSids,
} from './sandbox-recovery.js';

// A realistic orphan AppContainer package SID: "S-1-15-2" followed by 7
// sub-authority groups. Matches /S-1-15-2(?:-\d+){6,}/.
const ORPHAN_A =
  'S-1-15-2-1111111111-2222222222-3333333333-4444444444-5555555555-6666666666-7777777777';
const ORPHAN_B =
  'S-1-15-2-3624051433-2125758914-1423191267-1740899205-1073925389-3782572162-737981194';

// A clean, healthy directory ACL — no AppContainer package SIDs at all.
const CLEAN = [
  'C:\\SokujiSandboxTest NT AUTHORITY\\SYSTEM:(OI)(CI)(F)',
  '                     BUILTIN\\Administrators:(OI)(CI)(F)',
  '                     CREATOR OWNER:(OI)(CI)(IO)(F)',
  '                     BUILTIN\\Users:(OI)(CI)(RX)',
  '',
  'Successfully processed 1 files; Failed processing 0 files.',
].join('\r\n');

// An EXPLICIT orphan ACE (no "(I)" inherited flag) plus normal inherited ACEs.
const EXPLICIT_ORPHAN = [
  `C:\\SokujiSandboxTest ${ORPHAN_A}:(OI)(CI)(F)`,
  '                     NT AUTHORITY\\SYSTEM:(I)(OI)(CI)(F)',
  '                     BUILTIN\\Administrators:(I)(OI)(CI)(F)',
  '',
  'Successfully processed 1 files; Failed processing 0 files.',
].join('\r\n');

// The SAME orphan SID but INHERITED (has the "(I)" flag) — must be ignored,
// because we only remove explicit ACEs at the directory that defines them.
const INHERITED_ORPHAN = [
  `C:\\Users\\jiang\\AppData\\Local\\Sokuji ${ORPHAN_A}:(I)(OI)(CI)(F)`,
  '                                         NT AUTHORITY\\SYSTEM:(I)(OI)(CI)(F)',
  '',
  'Successfully processed 1 files; Failed processing 0 files.',
].join('\r\n');

// Legit AppContainer well-known SIDs shown as RAW SIDs must NOT match:
// S-1-15-2-1 (ALL APPLICATION PACKAGES) and S-1-15-2-2 (ALL RESTRICTED
// APPLICATION PACKAGES) each have only ONE sub-authority after S-1-15-2.
const LEGIT_WELLKNOWN = [
  'C:\\SokujiSandboxTest S-1-15-2-1:(OI)(CI)(RX)',
  '                     S-1-15-2-2:(OI)(CI)(RX)',
  '                     Everyone:(RX)',
  '',
  'Successfully processed 1 files; Failed processing 0 files.',
].join('\r\n');

// A non-English (Chinese) localized "account unknown" label wrapping an
// explicit orphan SID. The account name is localized; the SID is stable. We
// must extract by SID, never by name.
const NON_ENGLISH_LOCALE = [
  `C:\\SokujiSandboxTest 账户未知(${ORPHAN_B}):(OI)(CI)(F)`,
  '                     NT AUTHORITY\\SYSTEM:(I)(OI)(CI)(F)',
  '',
  'Successfully processed 1 files; Failed processing 0 files.',
].join('\r\n');

describe('parseIcaclsAces', () => {
  it('returns no ACEs for a clean directory', () => {
    expect(parseIcaclsAces(CLEAN)).toEqual([]);
  });

  it('flags an explicit orphan ACE as not inherited', () => {
    const aces = parseIcaclsAces(EXPLICIT_ORPHAN);
    expect(aces).toEqual([{ sid: ORPHAN_A, inherited: false }]);
  });

  it('flags an inherited orphan ACE as inherited', () => {
    const aces = parseIcaclsAces(INHERITED_ORPHAN);
    expect(aces).toEqual([{ sid: ORPHAN_A, inherited: true }]);
  });

  it('ignores legit well-known S-1-15-2-1 / S-1-15-2-2 raw SIDs', () => {
    expect(parseIcaclsAces(LEGIT_WELLKNOWN)).toEqual([]);
  });

  it('extracts the SID even when wrapped in a localized account name', () => {
    const aces = parseIcaclsAces(NON_ENGLISH_LOCALE);
    expect(aces).toEqual([{ sid: ORPHAN_B, inherited: false }]);
  });
});

describe('findExplicitOrphanSids', () => {
  it('returns [] for a clean directory', () => {
    expect(findExplicitOrphanSids(CLEAN)).toEqual([]);
  });

  it('returns the explicit orphan SID', () => {
    expect(findExplicitOrphanSids(EXPLICIT_ORPHAN)).toEqual([ORPHAN_A]);
  });

  it('does NOT return an inherited orphan SID', () => {
    expect(findExplicitOrphanSids(INHERITED_ORPHAN)).toEqual([]);
  });

  it('does NOT return legit well-known SIDs', () => {
    expect(findExplicitOrphanSids(LEGIT_WELLKNOWN)).toEqual([]);
  });

  it('deduplicates repeated explicit orphan SIDs', () => {
    const doubled = [
      `C:\\SokujiSandboxTest ${ORPHAN_A}:(OI)(F)`,
      `                     ${ORPHAN_A}:(CI)(F)`,
      '',
    ].join('\r\n');
    expect(findExplicitOrphanSids(doubled)).toEqual([ORPHAN_A]);
  });
});
