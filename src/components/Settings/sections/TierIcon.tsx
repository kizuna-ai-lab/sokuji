import React from 'react';
import { SiNvidia, SiApple } from 'react-icons/si';
import { Gpu } from 'lucide-react';

type Entry = { Icon: React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }>; label: string };

const TIER_ICONS: Record<string, Entry> = {
  'gpu-cuda': { Icon: SiNvidia, label: 'NVIDIA CUDA' },
  'gpu-metal': { Icon: SiApple, label: 'Apple Metal' },
  // NOT SiVulkan: Simple Icons' Vulkan mark is the horizontal "VULKAN"
  // wordmark — unreadable at tag size. The tag text already names the API,
  // so vendor-neutral APIs get lucide's graphics-card glyph instead.
  'gpu-vulkan': { Icon: Gpu, label: 'Vulkan' },
  'gpu-dml': { Icon: Gpu, label: 'DirectML' },
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
    <span role="img" aria-label={label} title={label} data-tier={tier} className="tier-icon">
      <Icon size={size} aria-hidden={true} />
    </span>
  );
}
