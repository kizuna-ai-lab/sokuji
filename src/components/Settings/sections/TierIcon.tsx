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
