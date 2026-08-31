import React from 'react';
import { SiApple } from 'react-icons/si';
import { Gpu } from 'lucide-react';

type Entry = { Icon: React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }>; label: string };

// gpu-cuda/gpu-dml (NVIDIA CUDA, DirectML) died with the last catalog rows
// that ever produced them — the ONNX/MLX TTS deployments removed in Task 5's
// catalog rewire onto native_tts (inventory §4.4: every gpu-cuda/gpu-dml tier
// string outside catalog.py's Deployment docstring belonged to a TTS row; ASR
// and translate only ever use gpu-vulkan/gpu-metal/cpu). Either tier now
// falls through to the generic gpu-* fallback below.
const TIER_ICONS: Record<string, Entry> = {
  'gpu-metal': { Icon: SiApple, label: 'Apple Metal' },
  // NOT SiVulkan: Simple Icons' Vulkan mark is the horizontal "VULKAN"
  // wordmark — unreadable at tag size. The tag text already names the API,
  // so vendor-neutral APIs get lucide's graphics-card glyph instead.
  'gpu-vulkan': { Icon: Gpu, label: 'Vulkan' },
};

/** Brand/API mark for a sidecar hardware tier — monochrome (inherits currentColor).
 *  Vendor logo where the API is vendor-exclusive (cuda/metal), a graphics-card
 *  glyph for vendor-neutral APIs (vulkan/dml) and unknown gpu-* tiers, and
 *  nothing for cpu. */
export function TierIcon({ tier, size = 10 }: { tier: string; size?: number }): React.ReactElement | null {
  const entry = TIER_ICONS[tier] ?? (tier.startsWith('gpu-') ? { Icon: Gpu, label: 'GPU' } : null);
  if (!entry) return null;
  const { Icon, label } = entry;
  return (
    <span role="img" aria-label={label} data-tier={tier} className="tier-icon">
      <Icon size={size} aria-hidden={true} />
    </span>
  );
}
