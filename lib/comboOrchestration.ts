import type { SongNote } from "@/lib/songs";

export type ComboOrchestrationChallenge = "easy" | "medium" | "hard";

export interface ComboOrchestrationLayers {
  /** Notes shared by Medium and Hard but absent from the player's Easy chart. */
  shared: SongNote[];
  /** Medium-only notes that fade away as the Hard arrangement takes over. */
  mediumOnly: SongNote[];
  /** Hard notes absent from the player's chart and the Medium bridge. */
  hardOnly: SongNote[];
}

export interface ComboOrchestrationMix {
  shared: number;
  mediumOnly: number;
  hardOnly: number;
}

const ATTACK_PRECISION = 1_000_000;
const POWER_LAYER_START_COMBO = 8;
const PRIMARY_LAYER_GROWTH_NOTES = 12;
const HARD_LAYER_START_COMBO = 16;
const HARD_LAYER_GROWTH_NOTES = 16;

const clamp01 = (value: number): number =>
  Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

const attackKey = (note: Pick<SongNote, "midi" | "startBeat">): string =>
  `${Math.round(note.startBeat * ATTACK_PRECISION)}:${note.midi}`;

const attackKeys = (notes: readonly SongNote[]): Set<string> =>
  new Set(notes.map(attackKey));

const notesAbsentFrom = (
  notes: readonly SongNote[],
  excludedAttacks: ReadonlySet<string>,
): SongNote[] => notes.filter((note) => !excludedAttacks.has(attackKey(note)));

/**
 * Splits the harder charts into non-duplicating, audible-only arrangement
 * layers. Attack identity deliberately ignores authored ids and durations:
 * every challenge chart has its own ids, while a shared piano attack must only
 * sound once beneath the note the player is already performing.
 */
export function buildComboOrchestrationLayers(
  playerNotes: readonly SongNote[],
  challenge: ComboOrchestrationChallenge,
  mediumNotes: readonly SongNote[] = [],
  hardNotes: readonly SongNote[] = [],
): ComboOrchestrationLayers {
  const empty: ComboOrchestrationLayers = {
    shared: [],
    mediumOnly: [],
    hardOnly: [],
  };
  if (challenge === "hard") return empty;

  const playerAttacks = attackKeys(playerNotes);
  if (challenge === "medium") {
    return {
      ...empty,
      hardOnly: notesAbsentFrom(hardNotes, playerAttacks),
    };
  }

  const mediumExtras = notesAbsentFrom(mediumNotes, playerAttacks);
  const hardExtras = notesAbsentFrom(hardNotes, playerAttacks);
  const mediumExtraAttacks = attackKeys(mediumExtras);
  const hardExtraAttacks = attackKeys(hardExtras);

  return {
    // Use Medium's authored feel while the shared pitches carry through both
    // stages of the Easy -> Medium -> Hard transition.
    shared: mediumExtras.filter((note) => hardExtraAttacks.has(attackKey(note))),
    mediumOnly: mediumExtras.filter(
      (note) => !hardExtraAttacks.has(attackKey(note)),
    ),
    hardOnly: hardExtras.filter(
      (note) => !mediumExtraAttacks.has(attackKey(note)),
    ),
  };
}

const primaryLayerMix = (combo: number): number =>
  0.36 +
  0.64 *
    clamp01((combo - POWER_LAYER_START_COMBO) / PRIMARY_LAYER_GROWTH_NOTES);

const laterHardLayerMix = (combo: number): number =>
  combo < HARD_LAYER_START_COMBO
    ? 0
    : 0.26 +
      0.74 *
        clamp01(
          (combo - HARD_LAYER_START_COMBO) / HARD_LAYER_GROWTH_NOTES,
        );

/**
 * Converts a live Power Mode streak into musical layer gains. Nothing is
 * audible before Power Mode is actually active, regardless of the raw combo.
 */
export function comboOrchestrationMix(
  challenge: ComboOrchestrationChallenge,
  combo: number,
  powerActive: boolean,
): ComboOrchestrationMix {
  const empty: ComboOrchestrationMix = {
    shared: 0,
    mediumOnly: 0,
    hardOnly: 0,
  };
  if (!powerActive || challenge === "hard") return empty;

  const safeCombo = Number.isFinite(combo) ? Math.max(0, combo) : 0;
  const primary = primaryLayerMix(safeCombo);
  if (challenge === "medium") {
    return { ...empty, hardOnly: primary };
  }

  const hard = laterHardLayerMix(safeCombo);
  return {
    shared: Math.max(primary, hard),
    mediumOnly: primary * (1 - hard),
    hardOnly: hard,
  };
}
