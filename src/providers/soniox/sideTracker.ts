/**
 * Speaker-label → conversation-side attribution for the Both single-session
 * path (see docs/superpowers/specs/2026-07-30-soniox-diarization-attribution-design.md).
 *
 * Pure bookkeeping — no timers, no I/O. SonioxClient records one energy
 * sample per 100 ms mixer frame ACTUALLY SENT to the STT socket (dropped
 * frames don't advance the server's audio clock), so frame index × frameMs
 * lines up with token start_ms/end_ms. Channel A is the mic ('speaker'
 * side), channel B the far end ('participant').
 *
 * Three tiers, evaluated per inferSide call:
 *   1. an established speaker-label mapping (net energy-backed votes >= establishNet)
 *   2. a fresh energy verdict for the token's time window (also casts a vote)
 *   3. null — the caller falls back to the legacy language comparison,
 *      which never votes (in the same-language case it is exactly the
 *      unreliable witness this class exists to replace).
 */

export type UtteranceSide = 'speaker' | 'participant';

export interface SideEvidence {
  side: UtteranceSide;
  tier: 'label' | 'energy';
}

interface SideTrackerOptions {
  frameMs?: number;
  capacity?: number;
  energyRatio?: number;
  establishNet?: number;
}

const FRAME_MS = 100;
const CAPACITY_FRAMES = 600; // 60 s of timeline
const ENERGY_RATIO = 2;      // one channel must carry 2x the other's energy
const ESTABLISH_NET = 2;     // net votes before a label answers on its own

export class SonioxSideTracker {
  private readonly frameMs: number;
  private readonly capacity: number;
  private readonly energyRatio: number;
  private readonly establishNet: number;

  private framesA: number[] = [];
  private framesB: number[] = [];
  private baseIndex = 0; // absolute frame index of framesA[0]/framesB[0]
  // Net energy-backed votes per speaker label: positive = 'speaker' (A),
  // negative = 'participant' (B).
  private votes = new Map<string, number>();

  constructor(options: SideTrackerOptions = {}) {
    this.frameMs = options.frameMs ?? FRAME_MS;
    this.capacity = options.capacity ?? CAPACITY_FRAMES;
    this.energyRatio = options.energyRatio ?? ENERGY_RATIO;
    this.establishNet = options.establishNet ?? ESTABLISH_NET;
  }

  recordFrame(energyA: number, energyB: number): void {
    this.framesA.push(energyA);
    this.framesB.push(energyB);
    const over = this.framesA.length - this.capacity;
    if (over > 0) {
      this.framesA.splice(0, over);
      this.framesB.splice(0, over);
      this.baseIndex += over;
    }
  }

  inferSide(
    speaker: string | undefined,
    startMs: number | undefined,
    endMs: number | undefined
  ): SideEvidence | null {
    const energySide = this.energyVerdict(startMs, endMs);
    if (speaker && energySide) {
      this.votes.set(speaker, (this.votes.get(speaker) ?? 0) + (energySide === 'speaker' ? 1 : -1));
    }
    if (speaker) {
      const net = this.votes.get(speaker) ?? 0;
      if (Math.abs(net) >= this.establishNet) {
        return { side: net > 0 ? 'speaker' : 'participant', tier: 'label' };
      }
    }
    if (energySide) return { side: energySide, tier: 'energy' };
    return null;
  }

  reset(): void {
    this.framesA = [];
    this.framesB = [];
    this.baseIndex = 0;
    this.votes.clear();
  }

  private energyVerdict(startMs: number | undefined, endMs: number | undefined): UtteranceSide | null {
    if (startMs == null) return null;
    const from = Math.floor(startMs / this.frameMs);
    // Evicted history is unavailable evidence: a window whose head frames
    // were dropped must MISS (fall through to the next tier) rather than
    // vote from the retained tail — a partial window can misrepresent a
    // speaker transition. The fresh edge is different: `to` can round one
    // frame past the newest recorded audio (endMs defaulting, boundary
    // rounding), so it is clamped rather than failed.
    if (from < this.baseIndex) return null;
    const lastIndex = this.baseIndex + this.framesA.length - 1;
    const to = Math.min(
      Math.max(from, Math.ceil((endMs ?? startMs + this.frameMs) / this.frameMs) - 1),
      lastIndex
    );
    if (to < from) return null; // nothing recorded in the window yet
    let a = 0;
    let b = 0;
    for (let i = from; i <= to; i++) {
      const idx = i - this.baseIndex;
      a += this.framesA[idx];
      b += this.framesB[idx];
    }
    if (a > 0 && a >= this.energyRatio * b) return 'speaker';
    if (b > 0 && b >= this.energyRatio * a) return 'participant';
    return null;
  }
}
