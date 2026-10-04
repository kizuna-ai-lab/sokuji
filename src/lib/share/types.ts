// src/lib/share/types.ts
/**
 * LAN caption sharing (spec 2026-10-04 §4): what the host renderer, the
 * main process and the viewer page exchange. Plain data, JSON-safe.
 */
import type { LegName } from '../conversation/types';

export interface ViewerRow { key: string; text: string; final: boolean }

export interface ViewerEntry {
  id: string;
  leg: LegName;
  t: number;
  languages: { source: string; target: string };
  source: ViewerRow[];
  translation: ViewerRow[];
}

export interface ShareState {
  phase: 'live' | 'idle';
  pair: { source: string; target: string };
  allowSave: boolean;
}

export type AddressKind = 'wifi' | 'wired' | 'other' | 'virtual';
export interface ShareAddress { address: string; label: string; kind: AddressKind }

export interface ShareStatus {
  running: boolean;
  port: number | null;
  addresses: ShareAddress[];
  selected: string | null;
  viewers: number;
  addressChanged: boolean;
}

export type ResetReason = 'clear' | 'restart';
export interface WifiHint { ssid: string; password: string }

export interface PresentInfo {
  url: string;
  pair: ShareState['pair'];
  phase: ShareState['phase'];
  viewers: number;
  wifi: WifiHint | null;
}

export type ViewerEvent =
  | { type: 'snapshot'; state: ShareState; entries: ViewerEntry[] }
  | { type: 'upsert'; entries: ViewerEntry[] }
  | { type: 'remove'; ids: string[] }
  | { type: 'clear'; reason: ResetReason }
  | { type: 'state'; state: ShareState }
  | { type: 'ended' };
