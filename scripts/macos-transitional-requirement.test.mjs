// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createAfterSign,
  parseDesignatedRequirement,
  buildTransitionalRequirement,
  acceptsDeveloperId,
  DEVELOPER_ID_TEAM,
} = require('./macos-transitional-requirement.js');

// What `codesign -d -r-` reports for the installed v0.46.1 (LittleSilver, 2026-10-26).
const ROOT = '92e86a47b9d0179e060c7e7cea61b8f9d4f3c350';
const SELF_SIGNED_REPORT =
  'Executable=/Applications/Sokuji.app/Contents/MacOS/Sokuji\n' +
  `designated => identifier "ai.kizunaai.sokuji" and certificate root = H"${ROOT}"\n`;
const AD_HOC_REPORT =
  'Executable=/tmp/Sokuji.app/Contents/MacOS/Sokuji\n' +
  '# designated => cdhash H"0123456789abcdef0123456789abcdef01234567"\n';

// The requirement Sophie verified by hand on LittleSilver.
const EXPECTED =
  `identifier "ai.kizunaai.sokuji" and (certificate root = H"${ROOT}" or anchor apple generic and ` +
  'certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists ' +
  'and certificate leaf[subject.OU] = "48ST7Q3ACJ")';

describe('parseDesignatedRequirement', () => {
  it('reads the identifier and the self-signed root', () => {
    expect(parseDesignatedRequirement(SELF_SIGNED_REPORT)).toEqual({
      requirement: `identifier "ai.kizunaai.sokuji" and certificate root = H"${ROOT}"`,
      identifier: 'ai.kizunaai.sokuji',
      rootHash: ROOT,
    });
  });

  it('has no root for an ad-hoc signature', () => {
    expect(parseDesignatedRequirement(AD_HOC_REPORT).rootHash).toBeNull();
  });

  it('returns null when there is no requirement at all', () => {
    expect(parseDesignatedRequirement('code object is not signed at all\n')).toBeNull();
  });
});

describe('buildTransitionalRequirement', () => {
  it('admits the self-signed root or a Developer ID certificate of the team', () => {
    expect(buildTransitionalRequirement({ identifier: 'ai.kizunaai.sokuji', rootHash: ROOT })).toBe(EXPECTED);
    expect(DEVELOPER_ID_TEAM).toBe('48ST7Q3ACJ');
  });

  it('refuses inputs that would change the requirement language', () => {
    expect(() => buildTransitionalRequirement({ identifier: 'a" or true', rootHash: ROOT })).toThrow();
    expect(() => buildTransitionalRequirement({ identifier: 'ai.kizunaai.sokuji', rootHash: 'abc' })).toThrow();
    expect(() => buildTransitionalRequirement({ identifier: 'ai.kizunaai.sokuji', rootHash: ROOT, teamId: 'X") or ("' })).toThrow();
  });
});

describe('acceptsDeveloperId', () => {
  it('is true for the transitional requirement and false for the self-signed one', () => {
    expect(acceptsDeveloperId(EXPECTED)).toBe(true);
    expect(acceptsDeveloperId(parseDesignatedRequirement(SELF_SIGNED_REPORT).requirement)).toBe(false);
  });

  it('recognises the form codesign displays it in', () => {
    const displayed =
      `identifier "ai.kizunaai.sokuji" and (certificate root = H"${ROOT}" or anchor apple generic and ` +
      'certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */ and certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */ ' +
      'and certificate leaf[subject.OU] = "48ST7Q3ACJ")';
    expect(acceptsDeveloperId(displayed)).toBe(true);
    expect(acceptsDeveloperId(displayed.replace('"48ST7Q3ACJ"', '48ST7Q3ACJ'))).toBe(true);
    expect(acceptsDeveloperId(displayed.replace('48ST7Q3ACJ', '48ST7Q3ACJX'))).toBe(false);
  });

  it('does not accept a different team', () => {
    expect(acceptsDeveloperId(EXPECTED, 'AAAAAAAAAA')).toBe(false);
  });
});

const context = (overrides = {}) => ({
  electronPlatformName: 'darwin',
  appOutDir: '/out/mac-arm64',
  packager: {
    appInfo: { productFilename: 'Sokuji' },
    platformSpecificBuildOptions: { identity: 'Sokuji Code Signing' },
    codeSigningInfo: { value: Promise.resolve({ keychainFile: '/tmp/csc/build.keychain' }) },
  },
  ...overrides,
});

// A fake `codesign`: reports `before` until the bundle is re-signed, then
// whatever requirement the re-sign asked for (or `after` when given).
function fakeCodesign({ before, after } = {}) {
  const calls = [];
  let report = before;
  const run = (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === '-d') return report;
    if (args[0] === '--force') {
      const r = args.find((a) => a.startsWith('-r='));
      report = after ?? `Executable=x\n${r.slice(3)}\n`;
    }
    return '';
  };
  return { run, calls };
}

describe('afterSign', () => {
  it('re-signs only the main bundle, keeping its metadata, with the transitional requirement', async () => {
    const { run, calls } = fakeCodesign({ before: SELF_SIGNED_REPORT });
    await createAfterSign({ run, log: () => {} })(context());

    const resign = calls.find((c) => c[1] === '--force');
    expect(resign).toEqual([
      'codesign', '--force', '--sign', 'Sokuji Code Signing',
      '--preserve-metadata=identifier,entitlements,flags,runtime',
      '--timestamp',
      `-r=designated => ${EXPECTED}`,
      '--keychain', '/tmp/csc/build.keychain',
      '/out/mac-arm64/Sokuji.app',
    ]);
    expect(calls).toContainEqual(['codesign', '--verify', '--deep', '--strict', '/out/mac-arm64/Sokuji.app']);
  });

  it('leaves ad-hoc builds alone', async () => {
    const { run, calls } = fakeCodesign({ before: AD_HOC_REPORT });
    await createAfterSign({ run, log: () => {} })(context());
    expect(calls.some((c) => c[1] === '--force')).toBe(false);
  });

  it('does nothing off macOS', async () => {
    const { run, calls } = fakeCodesign({ before: SELF_SIGNED_REPORT });
    await createAfterSign({ run, log: () => {} })(context({ electronPlatformName: 'linux' }));
    expect(calls).toEqual([]);
  });

  it('does not re-sign a bundle that already admits Developer ID', async () => {
    const { run, calls } = fakeCodesign({ before: `designated => ${EXPECTED}\n` });
    await createAfterSign({ run, log: () => {} })(context());
    expect(calls.some((c) => c[1] === '--force')).toBe(false);
  });

  it('fails the build when the re-signed requirement does not admit Developer ID', async () => {
    const { run } = fakeCodesign({ before: SELF_SIGNED_REPORT, after: SELF_SIGNED_REPORT });
    await expect(createAfterSign({ run, log: () => {} })(context())).rejects.toThrow(/unexpected requirement/);
  });

  it('fails when no signing identity is configured', async () => {
    const { run } = fakeCodesign({ before: SELF_SIGNED_REPORT });
    const ctx = context();
    ctx.packager.platformSpecificBuildOptions = {};
    await expect(createAfterSign({ run, log: () => {} })(ctx)).rejects.toThrow(/identity/);
  });
});
