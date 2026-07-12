# Local Inference UI Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the WASM `local_inference` settings UI structurally identical to `local_native` — `ModelManagementSection` self-reads the store, its `ModelCard` gains a body slot, and the TTS voice control moves inside the selected TTS card via a new `LocalInferenceVoiceSection`.

**Architecture:** Mirror the native pattern (two parallel components, not merged). `ModelManagementSection` drops its `localInferenceSettings`/`onUpdateSettings` props for `useLocalInferenceSettings()`/`useUpdateLocalInference()`, owns the voice state inline (exactly as `NativeModelManagementSection` owns its voice state), and renders `LocalInferenceVoiceSection` in the selected TTS card's `model-card__body`. The voice block leaves `ProviderSpecificSettings`/`TtsSpeedControl`.

**Tech Stack:** React + TypeScript (strict), Zustand (settingsStore + modelStore), `@testing-library/react` + vitest, IndexedDB (`voiceStorage`), `modelManifest`.

## Global Constraints

- TypeScript strict; English-only comments. Conventional commits. Tests are the gate (vitest); `tsc` is not repo-clean and is not a gate.
- Do not change observable WASM behavior: model selection/download; Edge-TTS voice selection incl. loading/error/no-voices states + auto-select-first; Supertonic select/import/rename/delete incl. reconcile-on-delete; the speaker slider for other engines.
- The WASM model UI has ZERO existing tests — write characterization tests that lock behavior, then move under green.
- Relocate effects verbatim with their exact dependency arrays (Edge-TTS fetch + auto-select-first are loop/timing-sensitive).
- Keep the shared `VoiceLibrarySection` (no fork); keep existing SCSS class names.
- Do not touch native (`NativeModelManagementSection` / `NativeVoiceSection` / `NativeModelCard`).
- Voice state is INLINE in `ModelManagementSection` (mirror native) — do NOT extract a hook.

## File Structure

- `src/components/Settings/sections/ModelManagementSection.tsx` (modify) — self-取 store; `ModelCard` gains `children` + `model-card__body`; owns voice state (Task 3); renders `LocalInferenceVoiceSection` in the TTS card body.
- `src/components/Settings/sections/LocalInferenceVoiceSection.tsx` (create) — presentation switch by TTS engine (edge `<select>` / Supertonic `VoiceLibrarySection` / speaker slider).
- `src/components/Settings/sections/LocalInferenceVoiceSection.test.tsx` (create).
- `src/components/Settings/sections/ModelManagementSection.test.tsx` (create) — characterization + self-取 + body slot.
- `src/components/Settings/sections/ProviderSpecificSettings.tsx` (modify) — simplify the WASM branch; remove the relocated voice state/JSX; drop the `ModelManagementSection` props.
- `src/components/Settings/sections/ModelManagementSection.scss` (modify) — add `.model-card__body` (same as native's, in ModelManagementSection.scss it already exists from the native embed task — verify; reuse).

> **Note:** `.model-card__body` was already added to `ModelManagementSection.scss` during the native embed work (commit history: "embed TTS voice section inside the selected MOSS card"). Verify it exists; if so, do NOT redefine it — both card components share that stylesheet.

---

### Task 1: `ModelManagementSection` self-取 store (drop props)

**Files:**
- Modify: `src/components/Settings/sections/ModelManagementSection.tsx` (props interface lines 34-38; signature 261-265; destructure 309; all `onUpdateSettings(` call sites; auto-select effect deps)
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx:1919-1923` (call site)
- Test: `src/components/Settings/sections/ModelManagementSection.test.tsx` (create)

**Interfaces:**
- Consumes: `useLocalInferenceSettings()` → `LocalInferenceSettings` and `useUpdateLocalInference()` → `(patch: Partial<LocalInferenceSettings>) => void` (both already exported from `src/stores/settingsStore.ts:1916,1966`).
- Produces: `ModelManagementSection` props become `{ isSessionActive: boolean }` only.

- [ ] **Step 1: Write the failing test** (`ModelManagementSection.test.tsx`)

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ModelManagementSection } from './ModelManagementSection';

const mockSettings = {
  sourceLanguage: 'en', targetLanguage: 'en',
  asrModel: '', translationModel: '', ttsModel: '',
  ttsSpeakerId: 0, ttsSpeed: 1, edgeTtsVoice: '',
};
const mockUpdate = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => fb ?? _k }),
}));
vi.mock('../../../stores/settingsStore', () => ({
  useLocalInferenceSettings: () => mockSettings,
  useUpdateLocalInference: () => mockUpdate,
}));
// modelStore surface used by the component — all no-ops/empty so it renders.
vi.mock('../../../stores/modelStore', () => ({
  useModelStatuses: () => ({}),
  useModelDownloads: () => ({}),
  useDownloadErrors: () => ({}),
  useStorageUsedMb: () => 0,
  useModelInitialized: () => true,
  useWebGPUAvailable: () => true,
  useDeviceFeatures: () => [],
  useModelVariants: () => ({}),
  useModelStore: Object.assign(
    (sel: any) => sel({
      initialize: vi.fn(), downloadModel: vi.fn(), cancelDownload: vi.fn(),
      deleteModel: vi.fn(), deleteAllModels: vi.fn(), rememberModels: vi.fn(),
    }),
    { getState: () => ({ rememberModels: vi.fn() }) },
  ),
}));

beforeEach(() => { mockUpdate.mockReset(); });

describe('ModelManagementSection (self-取)', () => {
  it('renders without settings/update props', async () => {
    render(<ModelManagementSection isSessionActive={false} />);
    await waitFor(() => expect(screen.getByText('ASR (Speech Recognition)')).toBeInTheDocument());
  });
});
```

> Adjust the mocked `modelStore` hook names to the ACTUAL imports at the top of `ModelManagementSection.tsx` (read lines 1-30 first; the names above match `useModelStatuses`/`useModelDownloads`/`useDownloadErrors`/`useStorageUsedMb`/`useModelInitialized`/`useWebGPUAvailable`/`useDeviceFeatures`/`useModelVariants`/`useModelStore`). The group title fallback text `ASR (Speech Recognition)` must match the `ModelGroup` title used in the file — confirm and adjust.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/components/Settings/sections/ModelManagementSection.test.tsx`
Expected: FAIL — `ModelManagementSection` currently requires `localInferenceSettings`/`onUpdateSettings` props (TS/runtime error: settings undefined).

- [ ] **Step 3: Make `ModelManagementSection` self-取**

In `ModelManagementSection.tsx`:
- Change the props interface (lines 34-38) to:
  ```tsx
  interface ModelManagementSectionProps {
    isSessionActive: boolean;
  }
  ```
- Change the signature (261-265) to `export function ModelManagementSection({ isSessionActive }: ModelManagementSectionProps) {` and add, right after `const { t } = useTranslation();`:
  ```tsx
  const settings = useLocalInferenceSettings();
  const updateLocalInference = useUpdateLocalInference();
  ```
  Add the imports at the top: `import { useLocalInferenceSettings, useUpdateLocalInference } from '../../../stores/settingsStore';` (keep the `LocalInferenceSettings` type import).
- Line 309: change `const { sourceLanguage, ... } = localInferenceSettings;` → `= settings;`.
- Replace every `onUpdateSettings(` with `updateLocalInference(` (call sites incl. the TTS group ~643/680, ASR ~511/548, translation ~572/616, and the auto-select effect's `onUpdateSettings(updates)` ~363).
- In the auto-select effect deps array (~373), replace `onUpdateSettings` with `updateLocalInference`.

- [ ] **Step 4: Update the call site** (`ProviderSpecificSettings.tsx:1919-1923`)

```tsx
        <ModelManagementSection isSessionActive={isSessionActive} />
```
(Remove the `localInferenceSettings`/`onUpdateSettings` props. Leave the rest of `renderLocalInferenceSettings` untouched in this task — the voice block moves in Task 3.)

- [ ] **Step 5: Run the test + the broader settings suite**

Run: `npx vitest run src/components/Settings/sections/ModelManagementSection.test.tsx src/components/Settings/sections`
Expected: PASS (new test green; nothing else regressed).

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings/sections/ModelManagementSection.tsx src/components/Settings/sections/ProviderSpecificSettings.tsx src/components/Settings/sections/ModelManagementSection.test.tsx
git commit -m "refactor(settings): ModelManagementSection self-reads the local_inference store

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FwG2ZVytakArmYteZcoutS"
```

---

### Task 2: `LocalInferenceVoiceSection` (standalone presentation, switch by engine)

**Files:**
- Create: `src/components/Settings/sections/LocalInferenceVoiceSection.tsx`
- Create: `src/components/Settings/sections/LocalInferenceVoiceSection.test.tsx`

**Interfaces:**
- Consumes: shared `VoiceLibrarySection` + `VoiceEntry` from `./VoiceLibrarySection`; `getManifestEntry` from `../../../lib/local-inference/modelManifest`; edge voice type from `../../../lib/edge-tts/voiceList` (read its export to get the right type; below uses a minimal `EdgeVoiceOption`).
- Produces:
  ```tsx
  export type EdgeVoiceStatus = 'idle' | 'loading' | 'loaded' | 'error';
  export interface LocalInferenceVoiceSectionProps {
    ttsModel: string;                 // engine resolved via getManifestEntry(ttsModel)?.engine
    isSessionActive?: boolean;
    // edge-tts
    edgeVoices: { ShortName: string; label: string }[];
    edgeVoiceStatus: EdgeVoiceStatus;
    edgeTtsVoice: string;
    // supertonic
    supertonicVoices: VoiceEntry[];   // ids 'preset:<sid>' | 'imported:<sid>'
    supertonicSelectedId: string;
    onImportVoice: (file: File) => Promise<void>;
    onRenameVoice: (sid: number, name: string) => Promise<void>;
    onDeleteVoice: (sid: number) => Promise<void>;
    // other engines
    ttsSpeakerId: number;
    numSpeakers: number;              // speaker slider max (>=1)
    // settings writes (edgeTtsVoice / ttsSpeakerId)
    onUpdate: (patch: { edgeTtsVoice?: string; ttsSpeakerId?: number }) => void;
  }
  ```

- [ ] **Step 1: Write the failing test** (`LocalInferenceVoiceSection.test.tsx`)

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LocalInferenceVoiceSection from './LocalInferenceVoiceSection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => fb ?? _k }),
}));
// Engine resolution drives which control renders.
vi.mock('../../../lib/local-inference/modelManifest', () => ({
  getManifestEntry: (id: string) => ({
    'edge-model': { engine: 'edge-tts' },
    'super-model': { engine: 'supertonic' },
    'matcha-model': { engine: 'matcha' },
  }[id]),
}));
// VoiceLibrarySection is covered by its own tests — stub to a marker + capture props.
let lastVLS: any = null;
vi.mock('./VoiceLibrarySection', () => ({
  __esModule: true,
  default: (props: any) => { lastVLS = props; return <div data-testid="vls" />; },
}));

const base = {
  isSessionActive: false,
  edgeVoices: [{ ShortName: 'en-US-A', label: 'A' }, { ShortName: 'en-US-B', label: 'B' }],
  edgeVoiceStatus: 'loaded' as const,
  edgeTtsVoice: 'en-US-A',
  supertonicVoices: [{ id: 'preset:0', label: 'Sarah', group: 'builtin' as const, removable: false }],
  supertonicSelectedId: 'preset:0',
  onImportVoice: vi.fn(), onRenameVoice: vi.fn(), onDeleteVoice: vi.fn(),
  ttsSpeakerId: 0, numSpeakers: 8,
  onUpdate: vi.fn(),
};

beforeEach(() => { lastVLS = null; vi.clearAllMocks(); });

describe('LocalInferenceVoiceSection', () => {
  it('edge engine → <select> writes edgeTtsVoice', () => {
    const onUpdate = vi.fn();
    render(<LocalInferenceVoiceSection {...base} ttsModel="edge-model" onUpdate={onUpdate} />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'en-US-B' } });
    expect(onUpdate).toHaveBeenCalledWith({ edgeTtsVoice: 'en-US-B' });
  });

  it('supertonic engine → renders VoiceLibrarySection with dropdown/upload capability', () => {
    render(<LocalInferenceVoiceSection {...base} ttsModel="super-model" />);
    expect(screen.getByTestId('vls')).toBeInTheDocument();
    expect(lastVLS.capability).toEqual({ importModes: ['upload'], curation: false, presentation: 'dropdown' });
    expect(lastVLS.selectedId).toBe('preset:0');
  });

  it('supertonic select writes ttsSpeakerId via sidFromVoiceId', () => {
    const onUpdate = vi.fn();
    render(<LocalInferenceVoiceSection {...base} ttsModel="super-model" onUpdate={onUpdate}
      supertonicVoices={[{ id: 'imported:7', label: 'Mine', group: 'custom', removable: true }]} />);
    lastVLS.onSelect('imported:7');
    expect(onUpdate).toHaveBeenCalledWith({ ttsSpeakerId: 7 });
  });

  it('other engine → speaker slider writes ttsSpeakerId', () => {
    const onUpdate = vi.fn();
    render(<LocalInferenceVoiceSection {...base} ttsModel="matcha-model" onUpdate={onUpdate} />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '3' } });
    expect(onUpdate).toHaveBeenCalledWith({ ttsSpeakerId: 3 });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/components/Settings/sections/LocalInferenceVoiceSection.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `LocalInferenceVoiceSection.tsx`**

```tsx
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import VoiceLibrarySection, { type VoiceEntry } from './VoiceLibrarySection';
import { getManifestEntry } from '../../../lib/local-inference/modelManifest';

export type EdgeVoiceStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface LocalInferenceVoiceSectionProps {
  ttsModel: string;
  isSessionActive?: boolean;
  edgeVoices: { ShortName: string; label: string }[];
  edgeVoiceStatus: EdgeVoiceStatus;
  edgeTtsVoice: string;
  supertonicVoices: VoiceEntry[];
  supertonicSelectedId: string;
  onImportVoice: (file: File) => Promise<void>;
  onRenameVoice: (sid: number, name: string) => Promise<void>;
  onDeleteVoice: (sid: number) => Promise<void>;
  ttsSpeakerId: number;
  numSpeakers: number;
  onUpdate: (patch: { edgeTtsVoice?: string; ttsSpeakerId?: number }) => void;
}

/** sid is encoded as the suffix after the ':' in a VoiceEntry id ('preset:7' → 7). */
const sidFromVoiceId = (id: string): number => Number(id.slice(id.indexOf(':') + 1));

/**
 * Voice control embedded in the selected local_inference TTS card. Mirrors
 * NativeVoiceSection: presentation only, switching on the selected TTS engine.
 * State (edge voice list, Supertonic library) is owned by ModelManagementSection.
 */
const LocalInferenceVoiceSection: React.FC<LocalInferenceVoiceSectionProps> = ({
  ttsModel, isSessionActive = false,
  edgeVoices, edgeVoiceStatus, edgeTtsVoice,
  supertonicVoices, supertonicSelectedId, onImportVoice, onRenameVoice, onDeleteVoice,
  ttsSpeakerId, numSpeakers, onUpdate,
}) => {
  const { t } = useTranslation();
  const engine = getManifestEntry(ttsModel)?.engine;

  const onSupertonicSelect = useCallback((id: string) => onUpdate({ ttsSpeakerId: sidFromVoiceId(id) }), [onUpdate]);

  if (engine === 'edge-tts') {
    let placeholder: string | null = null;
    if (edgeVoiceStatus === 'loading' || edgeVoiceStatus === 'idle') {
      placeholder = t('settings.loadingVoices', 'Loading voices...');
    } else if (edgeVoiceStatus === 'error') {
      placeholder = t('settings.edgeTtsVoiceLoadError', 'Failed to load voices — check LogsPanel');
    } else if (edgeVoices.length === 0) {
      placeholder = t('settings.edgeTtsNoVoicesForLanguage', 'No voices available for this language');
    }
    return (
      <div className="setting-item">
        <div className="setting-label"><span>{t('settings.edgeTtsVoice', 'Voice')}</span></div>
        <select
          className="select-dropdown"
          value={edgeTtsVoice}
          onChange={(e) => onUpdate({ edgeTtsVoice: e.target.value })}
          disabled={isSessionActive || edgeVoices.length === 0}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {edgeVoices.map((v) => (<option key={v.ShortName} value={v.ShortName}>{v.label}</option>))}
        </select>
      </div>
    );
  }

  if (engine === 'supertonic') {
    return (
      <VoiceLibrarySection
        voices={supertonicVoices}
        selectedId={supertonicSelectedId}
        onSelect={onSupertonicSelect}
        onImport={onImportVoice}
        onRename={(id, name) => onRenameVoice(sidFromVoiceId(id), name)}
        onDelete={(id) => onDeleteVoice(sidFromVoiceId(id))}
        capability={{ importModes: ['upload'], curation: false, presentation: 'dropdown' }}
        isSessionActive={isSessionActive}
      />
    );
  }

  // Other engines (matcha / piper / icefall …): a speaker-id slider.
  const max = Math.max(1, numSpeakers) - 1;
  return (
    <div className="setting-item">
      <div className="setting-label"><span>{t('settings.speaker', 'Speaker')}</span></div>
      <input
        type="range" min={0} max={max} step={1} value={Math.min(ttsSpeakerId, max)}
        onChange={(e) => onUpdate({ ttsSpeakerId: Number(e.target.value) })}
        disabled={isSessionActive || max === 0}
      />
    </div>
  );
};

export default LocalInferenceVoiceSection;
```

> Read the CURRENT edge-tts `<select>` JSX (`ProviderSpecificSettings.tsx:1945-1965`), the Supertonic `VoiceLibrarySection` usage (`:1968-1980`), and the speaker slider for "other" engines (search the file for the existing slider rendering) — match their exact class names, label keys (`getVoiceDisplayName` may format the edge label; if so, the parent passes `label` already formatted), and the `numSpeakers` source. The `label` field on `edgeVoices` is the pre-formatted display name (apply `getVoiceDisplayName` in the parent when building the list). If the current speaker control isn't a slider but another widget, replicate THAT widget here instead.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/components/Settings/sections/LocalInferenceVoiceSection.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/LocalInferenceVoiceSection.tsx src/components/Settings/sections/LocalInferenceVoiceSection.test.tsx
git commit -m "feat(settings): LocalInferenceVoiceSection (per-engine voice control)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FwG2ZVytakArmYteZcoutS"
```

---

### Task 3: Integrate — card body slot + relocate voice state + remove from ProviderSpecificSettings

**Files:**
- Modify: `src/components/Settings/sections/ModelManagementSection.tsx` (`ModelCard` body slot; `renderCard`/`renderSubGroups` `renderBody`; own the voice state; render `LocalInferenceVoiceSection` in the selected TTS card body)
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx` (remove relocated voice state lines ~229-404 that are WASM-voice-only, and the voice JSX inside `TtsSpeedControl` ~1930-2010; the WASM branch keeps `ModelManagementSection` + plain `TtsSpeedControl` + SpeechMode/Prompt/Vad)
- Modify: `src/components/Settings/sections/ModelManagementSection.test.tsx` (add body-slot + relocated-behavior tests)

**Interfaces:**
- Consumes: `LocalInferenceVoiceSection` (Task 2) with the exact prop shape from its Interfaces block; `voiceStorage` (`listVoices`/`addVoice`/`renameVoice`/`deleteVoice`) and the edge voice fetch utility — both currently imported by `ProviderSpecificSettings`; move those imports into `ModelManagementSection`.
- Produces: the selected TTS card renders `LocalInferenceVoiceSection` in `model-card__body`.

- [ ] **Step 1: Write failing tests** (append to `ModelManagementSection.test.tsx`)

```tsx
import { within } from '@testing-library/react';

describe('ModelManagementSection — embedded voice', () => {
  it('renders the voice control inside the selected TTS card (and nowhere else)', async () => {
    // Select a supertonic TTS model so the card body renders VoiceLibrarySection.
    // (Extend the mocks: make getManifestByType('tts') include a supertonic model,
    //  statuses[id]='downloaded', mockSettings.ttsModel=<that id>. See note below.)
    render(<ModelManagementSection isSessionActive={false} />);
    const card = await waitFor(() => screen.getByTestId('model-card-super-model'));
    expect(within(card).queryByText('Voice')).toBeTruthy(); // body present in the selected card
  });
});
```

> This test needs the `modelStore`/`modelManifest` mocks extended so a supertonic TTS model is compatible + downloaded + selected. Read how `ModelManagementSection` resolves `compatibleTtsModels` and the manifest, then mock `getManifestByType`/`getManifestEntry` accordingly. If a full voice-capable render proves too entangled with the existing mock surface, instead assert via a smaller seam (e.g. that `renderBody` is passed to the TTS `renderSubGroups`) and rely on `LocalInferenceVoiceSection.test.tsx` for the control behavior — but do NOT write a vacuous test. Add a `data-testid={`model-card-${entry.id}`}` to `ModelCard`'s root div if not already present, to target the card.

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run src/components/Settings/sections/ModelManagementSection.test.tsx`
Expected: FAIL — no body rendered (slot + wiring absent).

- [ ] **Step 3: Add the `ModelCard` body slot**

In `ModelManagementSection.tsx` `ModelCard`:
- Add `children?: React.ReactNode;` to the destructured props and the prop type object.
- Add `data-testid={entry ? \`model-card-${entry.id}\` : 'model-card-none'}` to the real-model root `<div className={classNames} onClick={handleClick}>` (line 115) if not present.
- After the `model-card__top-row` div closes (before the root `</div>` at line ~219), add:
  ```tsx
  {isSelected && children && (
    <div className="model-card__body" onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  )}
  ```

- [ ] **Step 4: Thread `renderBody` through `renderCard` / `renderSubGroups`**

- `renderCard` (461-486): add a 4th param `renderBody?: (entry: ModelManifestEntry) => React.ReactNode`, and pass `children={renderBody?.(entry)}` to `<ModelCard>`.
- `renderSubGroups` (489-499): add a 4th param `renderBody?: (entry: ModelManifestEntry) => React.ReactNode` and forward it: `renderItem={(m) => renderCard(m, selectedId, onSelect, renderBody)}`.

- [ ] **Step 5: Move the voice state into `ModelManagementSection`**

Move these from `ProviderSpecificSettings.tsx` into the `ModelManagementSection` body (after the existing hooks), changing `localInferenceSettings`→`settings` and `updateLocalInferenceSettings`→`updateLocalInference`:
- Edge-TTS: `edgeTtsVoiceStatus` state + its fetch effect + `filteredVoices` memo + the auto-select-first-voice effect (ProviderSpecificSettings.tsx ~229, ~258, the edge fetch effect, and ~398-404). Build the `edgeVoices` list as `{ ShortName, label: getVoiceDisplayName(voice) }[]`.
- Supertonic: `isSupertonicTts`, `supertonicTtsEntry`, `importedVoices` (+ its load effect ~271-278), `supertonicVoiceEntries` memo (~287-307), `supertonicSelectedId` memo (~318), and `handleImportVoice`/`handleRenameVoice`/`handleDeleteVoice` (~328-352). Keep the IndexedDB `voiceStorage` imports — move them to `ModelManagementSection`.
- Move the needed imports (`getVoiceDisplayName`, edge voice fetch util, `voiceStorage`, `VoiceEntry` type, `getManifestEntry`) into `ModelManagementSection`.

Then render the body for the TTS group only — change the TTS `renderSubGroups` call (635-648) to pass a `renderBody`:

```tsx
renderSubGroups(
  compatibleTtsModels,
  ttsModel,
  (id) => {
    updateLocalInference({ ttsModel: id });
    useModelStore.getState().rememberModels(sourceLanguage, targetLanguage, asrModel, translationModel, id);
  },
  (entry) => entry.id === ttsModel ? (
    <LocalInferenceVoiceSection
      ttsModel={ttsModel}
      isSessionActive={isSessionActive}
      edgeVoices={edgeVoices}
      edgeVoiceStatus={edgeTtsVoiceStatus}
      edgeTtsVoice={settings.edgeTtsVoice}
      supertonicVoices={supertonicVoiceEntries}
      supertonicSelectedId={supertonicSelectedId}
      onImportVoice={handleImportVoice}
      onRenameVoice={handleRenameVoice}
      onDeleteVoice={handleDeleteVoice}
      ttsSpeakerId={settings.ttsSpeakerId}
      numSpeakers={supertonicTtsEntry?.numSpeakers ?? 1}
      onUpdate={(patch) => updateLocalInference(patch)}
    />
  ) : null,
)
```

> `entry.id === ttsModel` gates so only the selected TTS card builds the body (the `ModelCard` `isSelected && children` gate is the real guard, but this avoids constructing it for every card). `supertonicTtsEntry?.numSpeakers` — use whatever field the manifest exposes for the speaker count; read the current slider's max source and match it. Import `LocalInferenceVoiceSection from './LocalInferenceVoiceSection'`.

- [ ] **Step 6: Remove the voice block from `ProviderSpecificSettings`**

- In `renderLocalInferenceSettings` (1912-…), the `TtsSpeedControl` currently wraps the voice picker as `children` (1929-2010+). Change it to a plain control with NO children:
  ```tsx
  <TtsSpeedControl
    value={localInferenceSettings.ttsSpeed}
    onChange={(ttsSpeed) => updateLocalInferenceSettings({ ttsSpeed })}
    disabled={isSessionActive}
  />
  ```
- Delete the now-unused relocated state/handlers/effects/imports from `ProviderSpecificSettings.tsx` (the edge + supertonic blocks moved in Step 5). Leave anything still used by other providers untouched (verify each symbol's other uses before deleting — e.g. `getManifestEntry` may be used elsewhere; only remove imports that become unused).

- [ ] **Step 7: Run the full affected suite**

Run: `npx vitest run src/components/Settings/sections src/stores`
Expected: PASS — new ModelManagementSection embed test + LocalInferenceVoiceSection + VoiceLibrarySection + NativeVoiceSection + native model section all green.

- [ ] **Step 8: Commit**

```bash
git add src/components/Settings/sections/ModelManagementSection.tsx src/components/Settings/sections/ProviderSpecificSettings.tsx src/components/Settings/sections/ModelManagementSection.test.tsx
git commit -m "feat(settings): embed local_inference voice control inside the selected TTS card

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FwG2ZVytakArmYteZcoutS"
```

---

## Self-Review

- **Spec coverage:** self-取 (Task 1) ✓; ModelCard body slot (Task 3 Step 3) ✓; `LocalInferenceVoiceSection` switch-by-engine (Task 2) ✓; relocate edge + supertonic state with verbatim effects (Task 3 Step 5) ✓; remove from ProviderSpecificSettings/TtsSpeedControl (Task 3 Step 6) ✓; characterization/tests-first (each task writes failing tests first; Task 2 fully unit-tests the control behavior) ✓; preserve edge placeholders / auto-select / supertonic reconcile (carried verbatim in Step 5; behavior asserted by Task 2 for the presentation and relied on as verbatim for the effects) ✓; SCSS `.model-card__body` reused (note in File Structure) ✓; native untouched ✓.
- **Type consistency:** `LocalInferenceVoiceSectionProps` is defined once (Task 2) and consumed with the same fields in Task 3 Step 5; `sidFromVoiceId` lives in `LocalInferenceVoiceSection`; `onUpdate` patch shape `{ edgeTtsVoice?, ttsSpeakerId? }` matches both the component and the call site; `updateLocalInference` name used consistently after Task 1.
- **Placeholder scan:** the `>` notes are implementer guidance to match existing code exactly (label formatting, numSpeakers source, speaker-widget type), not deferred work — they point at concrete lines to read. The reconcile-on-delete + edge fetch effects are moved verbatim (existing code), not re-specified, per the "relocate verbatim" constraint.

## Risks (from the spec)

- No prior coverage on a stateful cross-boundary move — mitigated by tests-first per task and verbatim effect relocation. Reviewer must confirm the edge fetch + auto-select-first + supertonic reconcile effects moved with identical deps/logic.
- `ModelManagementSection` grows (model + voice state) — accepted for native symmetry (inline, no hook).
- Parallel duplication with native (two card/section/voice components) — accepted (mirror, not merge).
