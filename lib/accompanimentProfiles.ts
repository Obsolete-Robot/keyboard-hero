import type {
  AccompanimentBassStep,
  AccompanimentHarmonyStep,
  SongAccompaniment,
} from "@/lib/songs";

type Profile = Omit<SongAccompaniment, "arrangementId" | "progression">;

const bass = (
  at: number,
  tone: AccompanimentBassStep["tone"],
  duration = 0.18,
  velocity = 0.68,
): AccompanimentBassStep => ({ at, tone, duration, velocity });

const chord = (
  at: number,
  duration = 0.22,
  velocity = 0.46,
): AccompanimentHarmonyStep => ({ at, duration, velocity });

const EIGHTHS_4 = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
const EIGHTHS_3 = [0, 1 / 6, 1 / 3, 0.5, 2 / 3, 5 / 6];
const QUARTERS_4 = [0, 0.25, 0.5, 0.75];
const OFFBEATS_4 = [0.125, 0.375, 0.625, 0.875];
const PULSES_3 = [0, 1 / 3, 2 / 3];
const EIGHTHS_2 = [0, 0.25, 0.5, 0.75];

/**
 * Explicit musical identities for the career. Patterns are normalized to a
 * measure so 3/4, 3/8, and compound meters keep their own physical pulse.
 */
export const ACCOMPANIMENT_PROFILES = {
  "first-five-launch": {
    name: "Launch-pad pulse",
    drumKit: "studio",
    bassVoice: "round",
    harmonyVoice: "piano",
    kick: [0, 0.5], snare: [0.5], hats: QUARTERS_4,
    bass: [bass(0, "root", 0.4), bass(0.5, "fifth", 0.34, 0.58)],
    harmony: [chord(0, 0.82, 0.34)], voicingOffset: 0,
  },
  "hot-cross-buns": {
    name: "Toy-room bounce",
    drumKit: "folk",
    bassVoice: "pluck",
    harmonyVoice: "bell",
    kick: [0, 0.75], snare: [0.5], hats: OFFBEATS_4,
    bass: [bass(0, "root", 0.22), bass(0.5, "root", 0.2, 0.56)],
    harmony: [chord(0.25, 0.16, 0.48), chord(0.75, 0.16, 0.42)], voicingOffset: 1,
  },
  "au-clair-de-la-lune": {
    name: "Moonlit celesta",
    drumKit: "brushes",
    bassVoice: "round",
    harmonyVoice: "bell",
    kick: [0], snare: [0.75], hats: QUARTERS_4,
    bass: [bass(0, "root", 0.72, 0.55)],
    harmony: [chord(0, 0.92, 0.32)], voicingOffset: 2,
  },
  "ode-to-joy": {
    name: "Festival strings",
    drumKit: "orchestral",
    bassVoice: "cello",
    harmonyVoice: "strings",
    kick: [0, 0.5], snare: [0.25, 0.75], hats: QUARTERS_4,
    bass: [bass(0, "root", 0.46, 0.72), bass(0.5, "fifth", 0.4, 0.66)],
    harmony: [chord(0, 0.46, 0.5), chord(0.5, 0.46, 0.46)], voicingOffset: 0,
  },
  "twinkle-little-star": {
    name: "Starlight lullaby",
    drumKit: "brushes",
    bassVoice: "round",
    harmonyVoice: "bell",
    kick: [0, 0.5], snare: [0.75], hats: OFFBEATS_4,
    bass: [bass(0, "root", 0.44, 0.58), bass(0.5, "fifth", 0.35, 0.5)],
    harmony: [chord(0, 0.9, 0.3)], voicingOffset: 1,
  },
  "itsy-bitsy-spider": {
    name: "Storybook spider-step",
    drumKit: "folk",
    bassVoice: "pluck",
    harmonyVoice: "bell",
    kick: [0, 0.5], snare: [0.75], hats: OFFBEATS_4,
    bass: [bass(0, "root", 0.32, 0.62), bass(0.5, "fifth", 0.26, 0.54)],
    harmony: [chord(0.25, 0.2, 0.44), chord(0.75, 0.18, 0.4)], voicingOffset: 2,
  },
  "lightly-row": {
    name: "Alpine folk skip",
    drumKit: "folk",
    bassVoice: "upright",
    harmonyVoice: "piano",
    kick: [0, 0.5, 0.75], snare: [0.25, 0.75], hats: EIGHTHS_4,
    bass: [bass(0, "root"), bass(0.5, "fifth"), bass(0.875, "approach", 0.1, 0.48)],
    harmony: [chord(0.25, 0.18), chord(0.75, 0.18, 0.42)], voicingOffset: 2,
  },
  "marys-two-hand-march": {
    name: "Schoolyard parade",
    drumKit: "march",
    bassVoice: "tuba",
    harmonyVoice: "brass",
    kick: [0, 0.5], snare: [0.25, 0.75], hats: EIGHTHS_4,
    openHat: [0.875],
    bass: [bass(0, "root", 0.22, 0.76), bass(0.5, "fifth", 0.22, 0.7)],
    harmony: [chord(0.25, 0.18, 0.54), chord(0.75, 0.18, 0.5)], voicingOffset: 0,
  },
  "london-bridge": {
    name: "Bridge-stomp band",
    drumKit: "folk",
    bassVoice: "pluck",
    harmonyVoice: "piano",
    kick: [0, 0.5], snare: [0.25, 0.75], hats: QUARTERS_4,
    bass: [bass(0, "root", 0.3), bass(0.5, "fifth", 0.28)],
    harmony: [chord(0, 0.2), chord(0.5, 0.2, 0.42)], voicingOffset: 1,
  },
  "row-row-row-your-boat": {
    name: "Riverboat six-eight",
    drumKit: "folk",
    bassVoice: "upright",
    harmonyVoice: "piano",
    kick: [0], snare: [0.5], hats: EIGHTHS_3,
    openHat: [5 / 6],
    bass: [bass(0, "root", 0.42), bass(0.5, "fifth", 0.38, 0.61)],
    harmony: [chord(0, 0.42, 0.38), chord(0.5, 0.42, 0.44)], voicingOffset: 2,
  },
  "amazing-grace": {
    name: "Sunday organ room",
    drumKit: "brushes",
    bassVoice: "round",
    harmonyVoice: "organ",
    kick: [0], snare: [2 / 3], hats: PULSES_3,
    bass: [bass(0, "root", 0.86, 0.55)],
    harmony: [chord(0, 0.94, 0.42)], voicingOffset: 0,
  },
  "simple-gifts": {
    name: "Shaker floorboards",
    drumKit: "folk",
    bassVoice: "upright",
    harmonyVoice: "piano",
    kick: [0, 0.5, 0.875], snare: [0.25, 0.75], hats: EIGHTHS_4,
    bass: [bass(0, "root"), bass(0.5, "fifth"), bass(0.75, "octave", 0.16, 0.54)],
    harmony: [chord(0.25, 0.18), chord(0.75, 0.18)], voicingOffset: 1,
  },
  "yankee-doodle": {
    name: "Fife-and-drum corps",
    drumKit: "march",
    bassVoice: "tuba",
    harmonyVoice: "brass",
    kick: [0, 0.5], snare: [0.25, 0.5, 0.75], hats: EIGHTHS_2,
    bass: [bass(0, "root", 0.34, 0.75), bass(0.5, "fifth", 0.3, 0.68)],
    harmony: [chord(0.25, 0.2, 0.5), chord(0.75, 0.2, 0.48)], voicingOffset: 2,
  },
  "jingle-bells": {
    name: "Sleigh-bell pocket",
    drumKit: "folk",
    bassVoice: "pluck",
    harmonyVoice: "bell",
    kick: [0, 0.5], snare: [0.25, 0.75], hats: EIGHTHS_4,
    openHat: [0.125, 0.625],
    bass: [bass(0, "root"), bass(0.5, "fifth")],
    harmony: [chord(0.25, 0.18, 0.55), chord(0.75, 0.18, 0.52)], voicingOffset: 0,
  },
  "auld-lang-syne": {
    name: "Hearthside farewell",
    drumKit: "brushes",
    bassVoice: "upright",
    harmonyVoice: "strings",
    kick: [0], snare: [0.75], hats: [0, 0.5],
    bass: [bass(0, "root", 0.72, 0.58), bass(0.75, "approach", 0.14, 0.42)],
    harmony: [chord(0, 0.9, 0.4)], voicingOffset: 1,
  },
  "frere-jacques-canon": {
    name: "Pizzicato round",
    drumKit: "none",
    bassVoice: "pluck",
    harmonyVoice: "harpsichord",
    kick: [], snare: [], hats: [],
    bass: [bass(0, "root", 0.22), bass(0.25, "fifth", 0.18, 0.52), bass(0.5, "octave", 0.2, 0.58), bass(0.75, "fifth", 0.18, 0.5)],
    harmony: [chord(0, 0.18, 0.4), chord(0.5, 0.18, 0.38)], voicingOffset: 2,
  },
  "sakura-sakura": {
    name: "Lantern garden",
    drumKit: "folk",
    bassVoice: "round",
    harmonyVoice: "bell",
    kick: [0], snare: [], hats: [0.5],
    bass: [bass(0, "root", 0.8, 0.48)],
    harmony: [chord(0, 0.38, 0.3), chord(0.75, 0.16, 0.28)], voicingOffset: 0,
  },
  "scarborough-fair": {
    name: "Dorian drone",
    drumKit: "brushes",
    bassVoice: "cello",
    harmonyVoice: "strings",
    kick: [0], snare: [2 / 3], hats: PULSES_3,
    bass: [bass(0, "root", 0.94, 0.57)],
    harmony: [chord(1 / 3, 0.58, 0.36)], voicingOffset: 1,
  },
  "saints-syncopation-lab": {
    name: "Second-line brass",
    drumKit: "march",
    bassVoice: "tuba",
    harmonyVoice: "brass",
    kick: [0, 0.375, 0.5, 0.875], snare: [0.25, 0.625, 0.75], hats: EIGHTHS_4,
    openHat: [0.875],
    bass: [bass(0, "root", 0.18, 0.78), bass(0.375, "fifth", 0.15, 0.62), bass(0.5, "octave", 0.18, 0.7), bass(0.875, "approach", 0.1, 0.58)],
    harmony: [chord(0.125, 0.16, 0.56), chord(0.625, 0.16, 0.52)], voicingOffset: 2,
  },
  "greensleeves": {
    name: "Renaissance consort",
    drumKit: "folk",
    bassVoice: "cello",
    harmonyVoice: "harpsichord",
    kick: [0], snare: [0.5], hats: [0, 1 / 3, 0.5, 5 / 6],
    bass: [bass(0, "root", 0.44, 0.65), bass(0.5, "fifth", 0.4, 0.58)],
    harmony: [chord(1 / 6, 0.28, 0.43), chord(2 / 3, 0.25, 0.4)], voicingOffset: 0,
  },
  "clockwork-minuet": {
    name: "Clockwork chamber",
    drumKit: "none",
    bassVoice: "cello",
    harmonyVoice: "harpsichord",
    kick: [], snare: [], hats: [],
    bass: [bass(0, "root", 0.26, 0.68), bass(1 / 3, "fifth", 0.2, 0.52), bass(2 / 3, "octave", 0.2, 0.55)],
    harmony: [chord(1 / 3, 0.18, 0.44), chord(2 / 3, 0.18, 0.42)], voicingOffset: 1,
  },
  "drunken-sailor": {
    name: "Forecastle stomp",
    drumKit: "folk",
    bassVoice: "upright",
    harmonyVoice: "brass",
    kick: [0, 1 / 3], snare: [0.5], hats: EIGHTHS_3,
    openHat: [5 / 6],
    bass: [bass(0, "root", 0.24, 0.78), bass(0.5, "fifth", 0.22, 0.7), bass(5 / 6, "approach", 0.1, 0.55)],
    harmony: [chord(0, 0.2, 0.5), chord(0.5, 0.2, 0.48)], voicingOffset: 2,
  },
  "minuet-in-g": {
    name: "Courtly trio",
    drumKit: "none",
    bassVoice: "cello",
    harmonyVoice: "harpsichord",
    kick: [], snare: [], hats: [],
    bass: [bass(0, "root", 0.3, 0.66), bass(1 / 3, "fifth", 0.18, 0.48), bass(2 / 3, "fifth", 0.18, 0.46)],
    harmony: [chord(1 / 3, 0.2, 0.46), chord(2 / 3, 0.2, 0.44)], voicingOffset: 0,
  },
  "brahms-lullaby": {
    name: "Cradle strings",
    drumKit: "brushes",
    bassVoice: "round",
    harmonyVoice: "strings",
    kick: [0], snare: [], hats: PULSES_3,
    bass: [bass(0, "root", 0.88, 0.5)],
    harmony: [chord(0, 0.94, 0.34)], voicingOffset: 1,
  },
  "twelve-bar-neon-blues": {
    name: "Neon blues shuffle",
    drumKit: "rock",
    bassVoice: "upright",
    harmonyVoice: "organ",
    kick: [0, 0.375, 0.5], snare: [0.25, 0.75], hats: [0, 0.125, 0.375, 0.5, 0.625, 0.875],
    openHat: [0.875],
    bass: [bass(0, "root", 0.18, 0.76), bass(0.25, "fifth", 0.15, 0.62), bass(0.5, "octave", 0.18, 0.72), bass(0.75, "approach", 0.14, 0.58)],
    harmony: [chord(0.125, 0.18, 0.5), chord(0.625, 0.18, 0.48)], voicingOffset: 2,
  },
  "prelude-in-c-major": {
    name: "Bach continuo",
    drumKit: "none",
    bassVoice: "cello",
    harmonyVoice: "harpsichord",
    kick: [], snare: [], hats: [],
    bass: [bass(0, "root", 0.72, 0.62), bass(0.75, "fifth", 0.18, 0.45)],
    harmony: [chord(0, 0.18, 0.42), chord(0.25, 0.18, 0.36), chord(0.5, 0.18, 0.4), chord(0.75, 0.18, 0.36)], voicingOffset: 0,
  },
  "canon-chord-forge": {
    name: "Canon string engine",
    drumKit: "orchestral",
    bassVoice: "cello",
    harmonyVoice: "strings",
    kick: [0, 0.5], snare: [0.75], hats: QUARTERS_4,
    bass: [bass(0, "root", 0.46, 0.7), bass(0.5, "fifth", 0.42, 0.62)],
    harmony: [chord(0, 0.94, 0.48)], voicingOffset: 1,
  },
  "swan-lake-theme": {
    name: "Moonlit ballet pit",
    drumKit: "orchestral",
    bassVoice: "cello",
    harmonyVoice: "strings",
    kick: [0], snare: [2 / 3], hats: PULSES_3,
    bass: [bass(0, "root", 0.32, 0.68), bass(1 / 3, "fifth", 0.22, 0.48), bass(2 / 3, "octave", 0.2, 0.52)],
    harmony: [chord(1 / 3, 0.24, 0.45), chord(2 / 3, 0.24, 0.48)], voicingOffset: 2,
  },
  "can-can": {
    name: "Galop orchestra",
    drumKit: "orchestral",
    bassVoice: "tuba",
    harmonyVoice: "brass",
    kick: [0, 0.5, 0.75], snare: [0.25, 0.5, 0.75], hats: EIGHTHS_2,
    bass: [bass(0, "root", 0.2, 0.82), bass(0.5, "fifth", 0.18, 0.76), bass(0.75, "octave", 0.14, 0.62)],
    harmony: [chord(0.25, 0.18, 0.58), chord(0.75, 0.18, 0.56)], voicingOffset: 0,
  },
  "fur-elise": {
    name: "Bagatelle salon",
    drumKit: "none",
    bassVoice: "cello",
    harmonyVoice: "piano",
    kick: [], snare: [], hats: [],
    bass: [bass(0, "root", 0.38, 0.64), bass(2 / 3, "fifth", 0.24, 0.48)],
    harmony: [chord(1 / 3, 0.24, 0.38), chord(2 / 3, 0.22, 0.4)], voicingOffset: 1,
  },
  "rondo-alla-turca": {
    name: "Turkish percussion",
    drumKit: "march",
    bassVoice: "pluck",
    harmonyVoice: "piano",
    kick: [0, 0.5], snare: [0.25, 0.5, 0.75], hats: EIGHTHS_2,
    openHat: [0.75],
    bass: [bass(0, "root", 0.2, 0.78), bass(0.5, "octave", 0.18, 0.72)],
    harmony: [chord(0.25, 0.18, 0.54), chord(0.75, 0.18, 0.52)], voicingOffset: 2,
  },
  "the-entertainer": {
    name: "Ragtime house band",
    drumKit: "studio",
    bassVoice: "upright",
    harmonyVoice: "piano",
    kick: [0, 0.5], snare: [0.25, 0.75], hats: [0.25, 0.75],
    bass: [bass(0, "root", 0.18, 0.78), bass(0.5, "fifth", 0.18, 0.72)],
    harmony: [chord(0.25, 0.2, 0.58), chord(0.75, 0.2, 0.56)], voicingOffset: 0,
  },
  "arpeggio-accelerator": {
    name: "Voltage arpeggiator",
    drumKit: "electronic",
    bassVoice: "synth",
    harmonyVoice: "synth",
    kick: [0, 0.375, 0.5, 0.75], snare: [0.25, 0.75], hats: EIGHTHS_4,
    openHat: [0.875],
    bass: [bass(0, "root", 0.22, 0.8), bass(0.375, "octave", 0.14, 0.58), bass(0.5, "fifth", 0.2, 0.7), bass(0.875, "approach", 0.1, 0.56)],
    harmony: [chord(0.125, 0.12, 0.48), chord(0.375, 0.12, 0.44), chord(0.625, 0.12, 0.5), chord(0.875, 0.1, 0.46)], voicingOffset: 1,
  },
  "in-the-hall-of-the-mountain-king": {
    name: "Mountain ostinato",
    drumKit: "orchestral",
    bassVoice: "cello",
    harmonyVoice: "strings",
    kick: [0, 0.5, 0.75], snare: [0.25, 0.75], hats: EIGHTHS_4,
    bass: [bass(0, "root", 0.2, 0.8), bass(0.25, "fifth", 0.16, 0.58), bass(0.5, "octave", 0.2, 0.74), bass(0.75, "approach", 0.15, 0.62)],
    harmony: [chord(0, 0.18, 0.5), chord(0.5, 0.18, 0.54)], voicingOffset: 2,
  },
  "flight-of-the-bumblebee": {
    name: "Orchestral chase",
    drumKit: "orchestral",
    bassVoice: "cello",
    harmonyVoice: "strings",
    kick: [0, 0.375, 0.5, 0.625, 0.875], snare: [0.25, 0.75], hats: EIGHTHS_4,
    openHat: [0.875],
    bass: [bass(0, "root", 0.2, 0.84), bass(0.5, "octave", 0.18, 0.72)],
    // The melody is intentionally chromatic; a low sustained string bed leaves
    // it room instead of firing block chords against every passing tone.
    harmony: [chord(0, 0.92, 0.28)], voicingOffset: 0,
  },
  "neon-skyline-finale": {
    name: "Skyline arena band",
    drumKit: "rock",
    bassVoice: "synth",
    harmonyVoice: "synth",
    kick: [0, 0.375, 0.5, 0.75, 0.875], snare: [0.25, 0.75], hats: EIGHTHS_4,
    openHat: [0.375, 0.875],
    bass: [bass(0, "root", 0.2, 0.86), bass(0.375, "octave", 0.12, 0.64), bass(0.5, "fifth", 0.2, 0.78), bass(0.875, "approach", 0.1, 0.7)],
    harmony: [chord(0, 0.2, 0.58), chord(0.375, 0.12, 0.48), chord(0.5, 0.2, 0.6), chord(0.875, 0.1, 0.52)], voicingOffset: 1,
  },
} as const satisfies Readonly<Record<string, Profile>>;

export type AccompanimentProfileId = keyof typeof ACCOMPANIMENT_PROFILES;

export function accompanimentFor(
  familyId: string,
  progression: readonly string[],
  measuresPerPass: number,
): SongAccompaniment {
  const profile = ACCOMPANIMENT_PROFILES[familyId as AccompanimentProfileId];
  if (!profile) {
    throw new Error(`Missing authored accompaniment profile for ${familyId}.`);
  }
  const measureCount = Math.max(1, Math.round(measuresPerPass));
  const formProgression = Array.from(
    { length: measureCount },
    (_, measure) => progression[measure % progression.length] ?? "C",
  );
  return {
    arrangementId: familyId,
    // Materialize one complete song pass so the chord form always resets with
    // the melody, even when the source shorthand does not divide the form.
    progression: formProgression,
    ...profile,
  };
}
