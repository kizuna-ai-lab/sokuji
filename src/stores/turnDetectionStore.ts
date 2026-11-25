/**
 * Turn detection, one set of values for every local recognizer (`settings.turnDetection.*`). Migrated once from the
 * local provider's old VAD keys; written only by that migration and by the user's changes.
 */
import { create } from 'zustand';
import {
  clampTurnDetection,
  LEGACY_TURN_DETECTION_FIELDS,
  migrateTurnDetection,
  TURN_DETECTION_DEFAULTS,
  TURN_DETECTION_PREFIX,
  type TurnDetectionSettings,
} from '../lib/turn/turnDetectionSettings';
import type { ISettingsService } from '../services/interfaces/ISettingsService';
import { persistSetting } from '../services/persistSetting';

type Field = keyof TurnDetectionSettings;
const FIELDS = Object.keys(LEGACY_TURN_DETECTION_FIELDS) as Field[];
const keyOf = (field: Field) => `${TURN_DETECTION_PREFIX}.${field}`;

interface TurnDetectionStore {
  settings: TurnDetectionSettings;
  /** Clamps, sets, and persists each field that changed. */
  update(patch: Partial<TurnDetectionSettings>): void;
  /** The eight sliders back to their defaults; Normal / Smart stays as it is. */
  restoreDefaults(): void;
}

export const useTurnDetectionStore = create<TurnDetectionStore>()((set, get) => ({
  settings: TURN_DETECTION_DEFAULTS,
  update(patch) {
    const before = get().settings;
    // Each field is clamped to its own range; a silence threshold above the threshold stays stored (the VAD config applies the smaller).
    const next = { ...before, ...clampTurnDetection({ ...before, ...patch }) };
    const changed = FIELDS.filter((field) => next[field] !== before[field]);
    if (changed.length === 0) return;
    set({ settings: next });
    for (const field of changed) void persistSetting(keyOf(field), next[field]);
  },
  restoreDefaults() {
    const { endOfTurn: _kept, ...sliders } = TURN_DETECTION_DEFAULTS;
    get().update(sliders);
  },
}));

/** Reads the stored values and the old ones, migrates, and writes only what the migration takes over. */
export async function loadTurnDetection(service: Pick<ISettingsService, 'getSetting'>): Promise<void> {
  const read = async (keyFor: (field: Field) => string) =>
    Object.fromEntries(await Promise.all(FIELDS.map(async (field) => [field, await service.getSetting<unknown>(keyFor(field), undefined)] as const)));
  const [stored, legacy] = await Promise.all([
    read(keyOf),
    read((field) => `settings.localInference.${LEGACY_TURN_DETECTION_FIELDS[field]}`),
  ]);
  const { settings, writes } = migrateTurnDetection(stored, legacy);
  useTurnDetectionStore.setState({ settings });
  for (const field of Object.keys(writes) as Field[]) void persistSetting(keyOf(field), writes[field]);
}
