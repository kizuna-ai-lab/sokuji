# OmniVoice License Consent Gate (Plan 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reusable, license-aware **download-consent gate**: any native model card carrying a non-commercial `license` descriptor triggers a truthful CC-BY-NC consent dialog before download, remembered once per model. OmniVoice is the first consumer.

**Architecture:** Thread a `license` descriptor from the sidecar catalog through the wire to the renderer card; add a `LicenseConsentModal` fired from the native download handler before `download()`; persist acceptance per model.

**Tech Stack:** Python (sidecar catalog/serializer), React/TypeScript (renderer), i18next (30 locales).

## Global Constraints

- The `license` descriptor is DATA, not hardcoded UI: `{ spdx, name, url, nonCommercial: bool, sourceRepo, attribution }`. Only cards that set it (OmniVoice) gate; everything else is unaffected.
- Consent is **accept-once, persisted per model id** (survives reload); re-download after delete need not re-prompt.
- The dialog states the TRUE license (CC-BY-NC-4.0) even though onnx-community mislabels it apache-2.0; Sokuji disclaims relationship/warranty; non-commercial reminder; k2-fsa attribution.
- Reuse the existing `Modal` primitive (`src/components/Modal/Modal.tsx`) — do not build a new overlay.
- i18n: every new key added to ALL 30 `src/locales/*/translation.json` (enforced by `src/locales/locales.consistency.test.ts`), camelCase leaf keys, English fallback as 2nd `t()` arg.
- Comments/strings English (UI text via i18n).

---

## File Structure

- `sidecar/sokuji_sidecar/catalog.py` — `License` dataclass + `license` field on `TtsModel`; populate on the OmniVoice card (real CC-BY-NC values).
- `sidecar/sokuji_sidecar/accel.py` — serialize `license` in `_h_models_catalog` (~759-767).
- `src/lib/local-inference/native/nativeProtocol.ts` — `license?` on `NativeModelInfo`.
- `src/lib/local-inference/native/nativeCatalog.ts` — carry `license` onto `NativeModelCardSpec` / `infoToCard`.
- `src/components/Settings/shared/LicenseConsentModal.tsx` — new.
- `src/components/Settings/sections/NativeModelManagementSection.tsx` — fire the modal from `handleDownload` (line ~243); persist consent.
- `src/stores/nativeModelStore.ts` (or a small `licenseConsentStore`) — `acceptedLicenses` set, persisted.
- `src/locales/*/translation.json` (×30) — consent strings under `models`.
- Tests: `sidecar/tests/test_catalog.py` (license shape); a renderer test for the gate + persistence; the i18n consistency test (existing).

---

## Task 1: License descriptor through catalog → wire → card

**Files:** `catalog.py`, `accel.py`, `nativeProtocol.ts`, `nativeCatalog.ts`; Test `sidecar/tests/test_catalog.py`.

**Interfaces:**
- `License(spdx, name, url, non_commercial, source_repo, attribution)` dataclass; `TtsModel.license: Optional[License]`. Serialized as `{spdx,name,url,nonCommercial,sourceRepo,attribution}`. `NativeModelInfo.license?` + `NativeModelCardSpec.license?` carry it.

- [ ] **Step 1: failing test** — `test_catalog.py`: the `omnivoice-0.6b` card's `license` is present with `spdx="CC-BY-NC-4.0"`, `non_commercial=True`, `source_repo` set, `attribution="k2-fsa/OmniVoice"`; and `voice_capability`/serializer emit the camelCase dict.
- [ ] **Step 2: run — fails.**
- [ ] **Step 3: implement** the dataclass + field (`catalog.py`), populate the OmniVoice card (from Plan-2 Task 5 stub → real values), emit in `accel.py` serializer, add the TS types in `nativeProtocol.ts` + `nativeCatalog.ts`.
- [ ] **Step 4: run — passes.**
- [ ] **Step 5: commit** `feat(license): thread non-commercial license descriptor catalog→wire→card`.

---

## Task 2: LicenseConsentModal + gate the download

**Files:** Create `LicenseConsentModal.tsx`; Modify `NativeModelManagementSection.tsx`, consent store; Test a renderer test.

**Interfaces:**
- `<LicenseConsentModal isOpen license modelName onAccept onClose />` (on `Modal`, `WarningModal`-style acknowledge). Consent store: `hasAccepted(id): bool`, `accept(id): void` (persisted).
- In `handleDownload` (NativeModelManagementSection ~243): if `card.license?.nonCommercial && !hasAccepted(card.downloadId)` → open modal, and only call `download()` on accept (then `accept(id)`).

- [ ] **Step 1: failing test** — render the section (or a focused harness) with a card carrying `license.nonCommercial=true`; click Download → `download()` NOT called, modal shown; click accept → `download()` called once + consent persisted; a second Download does not re-prompt. A card with no license downloads immediately.
- [ ] **Step 2: run — fails.**
- [ ] **Step 3: implement** the modal (i18n copy: repo, CC-BY-NC terms, disclaimer, non-commercial reminder, k2-fsa attribution, "I understand — non-commercial only" primary + Cancel) + the handler gate + the persisted consent store.
- [ ] **Step 4: run — passes.**
- [ ] **Step 5: commit** `feat(license): consent modal gating non-commercial model downloads`.

---

## Task 3: i18n across all 30 locales

**Files:** `src/locales/*/translation.json` (×30); Test `locales.consistency.test.ts` (existing).

- [ ] **Step 1:** add the consent keys under `models` to `src/locales/en/translation.json` (title, body paragraphs with `{repo}`/`{attribution}` placeholders, understand button, cancel), then add the SAME keys to all 29 other locales (English text is acceptable as the fallback value where no translation is provided, but keys MUST exist in every file).
- [ ] **Step 2:** run `npx vitest run src/locales/locales.consistency.test.ts` → passes (no missing/stale keys, placeholders consistent).
- [ ] **Step 3: commit** `i18n(license): consent-gate strings across 30 locales`.

---

## Self-Review

**Spec coverage (Component 3):** generic license field catalog→wire→card (T1); reusable `LicenseConsentModal` fired before download, accept-once persisted (T2); i18n (T3). Clone UX needs no change (`transcript_required=False` → the existing native voice UI hides the transcript field). Matches the spec's Phase 2.

**Placeholder scan:** none — copy is real i18n strings; the OmniVoice license values are concrete (CC-BY-NC-4.0 / k2-fsa/OmniVoice / our repo).

**Type consistency:** `License`/`license` fields and the `{spdx,name,url,nonCommercial,sourceRepo,attribution}` shape are identical across `catalog.py`, the serializer, `NativeModelInfo`, `NativeModelCardSpec`, and the modal props.
