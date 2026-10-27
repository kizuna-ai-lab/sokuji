// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { auditRoots } from '../../scripts/mobile-shared-audit.mjs';

/**
 * What the mobile app (Expo/Metro, under `mobile/`) may import from this repo.
 * Everything reachable from these roots must bundle under Metro and run on a
 * phone: no `import.meta` (Vite-only), no workers or stylesheets, no DOM,
 * Electron or extension globals, no Web Audio, and no package a phone cannot
 * carry or must not carry twice (react through a desktop store, posthog-js,
 * electron, the browser language detector). The locale catalogs are data and
 * are not listed; the i18n initialisation is the app's own.
 */
export const MOBILE_SHARED_ROOTS = [
  'src/providers/soniox/sttStream.ts',
  'src/providers/soniox/socket.ts',
  'src/providers/soniox/utterances.ts',
  'src/providers/soniox/leaseRequest.ts',
  'src/providers/soniox/lease.ts',
  'src/lib/soniox/regions.ts',
  'src/lib/contract/clock.ts',
  'src/lib/segmentation/SentenceStream.ts',
  'src/lib/segmentation/continuousSegments.ts',
  'src/lib/segmentation/sentenceEnd.ts',
  'src/lib/segmentation/silenceDeferral.ts',
  'src/lib/export/transcript.ts',
  'src/lib/conversation/Conversation.ts',
  'src/lib/projection/project.ts',
  'src/lib/projection/types.ts',
  'src/lib/contract/events.ts',
];

describe('mobile shared code', () => {
  it('bundles under Metro and runs without a browser', () => {
    const repoRoot = resolve(__dirname, '../..');
    expect(auditRoots(repoRoot, MOBILE_SHARED_ROOTS)).toEqual({});
  });
});
