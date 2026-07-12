# GPU Vendor Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a vendor/API brand mark (NVIDIA for CUDA, Apple for Metal, Vulkan, a neutral chip for DirectML) in each native model card's capability tag, replacing the generic lucide `Zap` glyph.

**Architecture:** A new presentational `TierIcon` component maps the sidecar tier string to a monochrome `react-icons`/lucide glyph; it's dropped into the existing tier tag in `NativeModelManagementSection`. Renderer-only, no sidecar change.

**Tech Stack:** React + TypeScript, `react-icons` (new dep, simple-icons set), `lucide-react` (existing), SCSS, vitest + `@testing-library/react`.

## Global Constraints

- **Monochrome** — icons take no `color`, inheriting the tag's muted-gray `currentColor`. No brand colors.
- **Mapping by API exclusivity:** `gpu-cuda`→`SiNvidia` ("NVIDIA CUDA"), `gpu-metal`→`SiApple` ("Apple Metal"), `gpu-vulkan`→`SiVulkan` ("Vulkan"), `gpu-dml`→lucide `Cpu` ("DirectML"), any other `gpu-*`→lucide `Cpu` ("GPU"), `cpu`→nothing.
- **Scope:** the per-model tier tag only (`NativeModelManagementSection.tsx`). No device-selector badges, no sidecar/tier-string change, no `tierLabel()` text change.
- **`Zap` stays imported** in `NativeModelManagementSection.tsx` — it's still used by the auto-selected badge (line ~121); only the tier-tag usage (line ~108) is replaced.
- **a11y:** the icon is wrapped in a `<span role="img" aria-label={label}>` so it has an accessible name and is testable; the inner glyph is `aria-hidden`.
- Tests: `npm run test -- <file> --run` (vitest); build: `npm run build`.

---

### Task 1: `TierIcon` component + `react-icons` dependency

**Files:**
- Create: `src/components/Settings/sections/TierIcon.tsx`
- Create (test): `src/components/Settings/sections/TierIcon.test.tsx`
- Modify: `package.json`, `package-lock.json` (via `npm install react-icons`)

**Interfaces:**
- Produces: `export function TierIcon({ tier, size }: { tier: string; size?: number }): React.ReactElement | null` — Task 2 renders `<TierIcon tier={tier} size={10} />`.

- [ ] **Step 1: Add the `react-icons` dependency**

Run: `npm install react-icons`
Expected: `react-icons` added to `package.json` dependencies; `package-lock.json` updated; exit 0.

- [ ] **Step 2: Write the failing test**

Create `src/components/Settings/sections/TierIcon.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TierIcon } from './TierIcon';

describe('TierIcon', () => {
  // Query the wrapper span by its data-tier and assert aria-label + that a glyph rendered.
  // (Robust against react-icons/lucide a11y quirks — avoids ambiguous getByRole('img').)
  const cases: [string, string][] = [
    ['gpu-cuda', 'NVIDIA CUDA'],
    ['gpu-metal', 'Apple Metal'],
    ['gpu-vulkan', 'Vulkan'],
    ['gpu-dml', 'DirectML'],
    ['gpu-rocm', 'GPU'],            // unknown gpu-* -> neutral chip fallback
  ];
  it.each(cases)('renders tier %s labeled "%s"', (tier, label) => {
    const { container } = render(<TierIcon tier={tier} />);
    const el = container.querySelector(`[data-tier="${tier}"]`);
    expect(el).not.toBeNull();
    expect(el).toHaveAttribute('aria-label', label);
    expect(el!.querySelector('svg')).not.toBeNull();   // an actual glyph rendered
  });

  it('renders nothing for cpu', () => {
    const { container } = render(<TierIcon tier="cpu" />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test -- src/components/Settings/sections/TierIcon.test.tsx --run`
Expected: FAIL — `Failed to resolve import "./TierIcon"` (component not created yet).

- [ ] **Step 4: Write the component**

Create `src/components/Settings/sections/TierIcon.tsx`:

```tsx
import React from 'react';
import { SiNvidia, SiApple, SiVulkan } from 'react-icons/si';
import { Cpu } from 'lucide-react';

type Entry = { Icon: React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }>; label: string };

const TIER_ICONS: Record<string, Entry> = {
  'gpu-cuda': { Icon: SiNvidia, label: 'NVIDIA CUDA' },
  'gpu-metal': { Icon: SiApple, label: 'Apple Metal' },
  'gpu-vulkan': { Icon: SiVulkan, label: 'Vulkan' },
  'gpu-dml': { Icon: Cpu, label: 'DirectML' },
};

/** Brand/API mark for a sidecar hardware tier — monochrome (inherits currentColor).
 *  Vendor logo where the API is vendor-exclusive (cuda/metal), the Vulkan API mark for
 *  vulkan, a neutral chip for DirectML / unknown gpu-* tiers, and nothing for cpu. */
export function TierIcon({ tier, size = 10 }: { tier: string; size?: number }): React.ReactElement | null {
  const entry = TIER_ICONS[tier] ?? (tier.startsWith('gpu-') ? { Icon: Cpu, label: 'GPU' } : null);
  if (!entry) return null;
  const { Icon, label } = entry;
  return (
    <span role="img" aria-label={label} title={label} data-tier={tier} className="tier-icon">
      <Icon size={size} aria-hidden={true} />
    </span>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- src/components/Settings/sections/TierIcon.test.tsx --run`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/components/Settings/sections/TierIcon.tsx src/components/Settings/sections/TierIcon.test.tsx
git commit -m "feat(ui): TierIcon — GPU vendor/API brand marks for native model tiers"
```

---

### Task 2: Wire `TierIcon` into the model card tier tag + align the badge

**Files:**
- Modify: `src/components/Settings/sections/NativeModelManagementSection.tsx` (~line 108)
- Modify: `src/components/Settings/sections/ModelManagementSection.scss` (`&__lang-tag`, ~line 288)

**Interfaces:**
- Consumes: `TierIcon` (Task 1).

- [ ] **Step 1: Import `TierIcon`**

In `src/components/Settings/sections/NativeModelManagementSection.tsx`, add to the imports (near the top, after the existing relative imports):

```tsx
import { TierIcon } from './TierIcon';
```

Leave the existing `import { ChevronDown, ..., Zap, ... } from 'lucide-react';` line unchanged — `Zap` is still used by the auto-selected badge below.

- [ ] **Step 2: Replace the tier-tag glyph**

In the same file, find the tier-tag return (currently):

```tsx
                return (
                  <span className="model-card__lang-tag">
                    {tl.accel && <Zap size={10} />}{tl.label}{rtf}
                  </span>
                );
```

Replace the inner content so the vendor mark is used instead of the `Zap`:

```tsx
                return (
                  <span className="model-card__lang-tag">
                    <TierIcon tier={tier} size={10} />{tl.label}{rtf}
                  </span>
                );
```

(`tier` is already in scope from the `const tier = ...` lines just above; `TierIcon` returns `null` for `cpu`, so the `tl.accel &&` gate is no longer needed.)

- [ ] **Step 3: Align the icon in the tag**

In `src/components/Settings/sections/ModelManagementSection.scss`, change the `&__lang-tag` rule from `display: inline-block;` to a flex row so the icon sits centered next to the text:

```scss
  &__lang-tag {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 6px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 3px;
    font-size: vars.$font-caption;
    color: vars.$text-muted;
  }
```

(Only the first line changes from `inline-block` to the three flex lines; padding/background/etc. stay.)

- [ ] **Step 4: Verify the renderer suite + build**

Run: `npm run test -- src/components/Settings/ --run`
Expected: PASS (TierIcon test + any existing Settings tests).

Run: `npm run build`
Expected: exit 0 (confirms the `react-icons/si` import resolves and tree-shakes in the production bundle).

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/NativeModelManagementSection.tsx src/components/Settings/sections/ModelManagementSection.scss
git commit -m "feat(ui): show GPU vendor/API marks on native model tier tags"
```

---

### Task 3: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Full renderer test suite**

Run: `npm run test -- --run`
Expected: PASS (no regression).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 3: Commit only if Steps 1-2 surfaced a fix**

If a fix was needed: `git add -A && git commit -m "test(ui): green gpu-vendor-badges suite"`. Otherwise nothing to commit.
