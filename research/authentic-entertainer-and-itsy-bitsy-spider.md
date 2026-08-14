# Authentic score basis: The Entertainer and Itsy Bitsy Spider

Research date: 2026-08-14

## Scope and constraint

Keyboard Hero accepts MIDI 48-72 (C3-C5), as defined in `lib/songs.ts`. The goal is therefore to preserve each tune's pitches, intervals, rhythm, meter, and register as closely as that fixed range permits. Difficulty should change accompaniment density and practice tempo, not replace the tune with newly composed notes.

All durations below use the app's quarter-note transport unit: sixteenth = `0.25`, eighth = `0.5`, quarter = `1`, dotted quarter = `1.5`, dotted half = `3`.

## The Entertainer

### Sources and score facts

- The [Johns Hopkins Levy Collection record and first-edition images](https://levysheetmusic.mse.jhu.edu/collection/170/129) identify Scott Joplin, John Stark & Son, St. Louis, 1902, solo piano, plate 10-4. Its [first-edition PDF](https://levysheetmusic.mse.jhu.edu/sites/default/files/collection-pdfs/levy-170-129.pdf) is the primary notation source.
- The [Library of Congress record and scan](https://www.loc.gov/item/2023864238/) independently catalog the 1902 John Stark score as notated piano music.
- The [Mutopia edition](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=263) is a public-domain, machine-readable reproduction of the original edition. Its [LilyPond source](https://www.mutopiaproject.org/ftp/JoplinS/entertainer/entertainer.ly), [PDF](https://www.mutopiaproject.org/ftp/JoplinS/entertainer/entertainer-a4.pdf), and [MIDI](https://www.mutopiaproject.org/ftp/JoplinS/entertainer/entertainer.mid) were cross-checked against the first-edition scan.

Score facts: C major, 2/4, four-bar introduction, printed direction **“Not fast.”** Mutopia's MIDI uses quarter note = 72; that number is editorial playback guidance, not a metronome mark printed by Joplin. The famous first strain starts after the introduction. Joplin frequently doubles its tune in octaves/chords; the nearest playable melodic edge spans D4-E5 (MIDI 62-76), so it cannot fit C3-C5 unchanged.

### Exact source-grounded excerpt

This is the recognizable eight-bar phrase (pickup plus original bars 5-12), taking the lower member of Joplin's octave-doubled melodic line. It is loop-clean and totals 16 quarter-note beats.

```ts
const entertainerOriginalC = [
  [62, .25], [63, .25], [64, .25], [72, .5], [64, .25], [72, .5],
  [64, .25], [72, 1.5], [72, .25], [74, .25], [75, .25], [76, .25],
  [72, .25], [74, .25], [76, .5], [71, .25], [74, .5], [72, 1.5],
  [62, .25], [63, .25], [64, .25], [72, .5], [64, .25], [72, .5],
  [64, .25], [72, 1.75], [69, .25], [67, .25], [66, .25], [69, .25],
  [72, .25], [76, .5], [74, .25], [72, .25], [69, .25], [74, 1.5],
] as const;
```

Do **not** wrap D5-D#5-E5 down an octave individually: that reverses the written contour and makes the phrase sound wrong. The highest uniform transposition that fits the hardware is down four semitones, to A-flat major. It preserves every interval and rhythm, occupies B-flat3-C5 (MIDI 58-72), and raises the current chart's ceiling from A4 to the keyboard's C5.

```ts
const entertainer25KeyAb = [
  [58, .25], [59, .25], [60, .25], [68, .5], [60, .25], [68, .5],
  [60, .25], [68, 1.5], [68, .25], [70, .25], [71, .25], [72, .25],
  [68, .25], [70, .25], [72, .5], [67, .25], [70, .5], [68, 1.5],
  [58, .25], [59, .25], [60, .25], [68, .5], [60, .25], [68, .5],
  [60, .25], [68, 1.75], [65, .25], [63, .25], [62, .25], [65, .25],
  [68, .25], [72, .5], [70, .25], [68, .25], [65, .25], [70, 1.5],
] as const;

const entertainerHarmonyAb = ["Ab", "Db", "Eb7", "Ab", "Ab", "Db", "Bb7", "Eb7"] as const;
```

Implementation guidance:

- Easy: exact monophonic array, one hand, slower practice percentage.
- Medium: identical melody plus one quiet bass root per 2/4 measure from the harmony above.
- Hard: identical melody plus the score's ragtime pattern—bass on each beat and a compact chord on each offbeat eighth. The existing generic hard arranger attacks chords on downbeats, so a custom Entertainer accompaniment is materially more faithful.
- Use about quarter note = 72 at 100% tempo, retaining “Not fast.” Repeating this exact phrase is preferable to padding it with invented melodic material; authoring the complete 16-bar first strain from the same source is the ideal later extension.

## Itsy Bitsy Spider

### Sources, provenance, and limitation

- A current [C-major 6/8 melody-and-chord lead sheet](https://itsybitsykidsmusic.com/wp-content/uploads/2017/03/Lead-sheet-with-chords-itsy-bitsy-spider.pdf), labeled “Traditional,” directly notates the common U.S. tune, lyric alignment, register, and C/G7/Am harmony used below.
- The [MakingMusicFun notated piano score](https://makingmusicfun.net/public/assets/pdf/sheet_music/itsy-bitsy-spider-piano.pdf) independently shows the same common contour in G major, 6/8, marked Moderato. Its engraving and accompaniment are a copyrighted 2009 arrangement; use it as corroboration, not as app artwork or a copied accompaniment.
- Herbert S. Gardner's [composer-published IMSLP score](https://imslp.org/wiki/The_Itsy_Bitsy_Spider_6%2F8_%28Gardner%2C_Herbert_Straus%29) is a CC BY-SA 4.0 teaching arrangement in G major, 6/8, marked dotted quarter = 90. It corroborates the compound meter but is a 2017 arrangement, not an early source for the tune.
- Arthur Walbridge North's public-domain 1910 *Camp and Camino in Lower California* is available from the [Library of Congress](https://www.loc.gov/item/10013169/). Pages 279-280 print words for a “Spider Song,” but **no staff notation**. It is evidence for textual ancestry only and does not validate any pitch or rhythm. Do not cite it as the melody source.
- Ruth Crawford Seeger's *American Folk Songs for Children* (1948) includes “Eency Weency Spider,” but IMSLP warns that the collection is probably still protected in the United States. It is useful historical context, not the public-domain score basis for this implementation.

### Exact common melody

The lead sheet is C major, 6/8. Its optional pickup word “The” is G3 eighth; the main tune spans C4-G4, with G3 returning for “And the” before the final phrase. The whole source register G3-G4 (MIDI 55-67) already fits C3-C5, so **no transposition or octave folding is needed**.

For clean gameplay after the normal count-in, omit only the optional opening pickup “The” and begin on “Itsy.” This remains the exact notated melody from “Itsy” onward: 16 bars, 48 quarter-note beats.

```ts
const itsyBitsySpiderC6_8 = [
  [60, 1], [60, .5], [60, 1], [62, .5],
  [64, 1.5], [64, 1], [64, .5],
  [62, 1], [60, .5], [62, 1], [64, .5], [60, 3],
  [64, 1.5], [64, 1], [65, .5], [67, 1.5], [67, 1.5],
  [65, 1], [64, .5], [65, 1], [67, .5], [64, 3],
  [60, 1.5], [60, 1], [62, .5], [64, 1.5], [64, 1.5],
  [62, 1], [60, .5], [62, 1], [64, .5],
  [60, 1.5], [55, 1], [55, .5],
  [60, 1], [60, .5], [60, 1], [62, .5],
  [64, 1.5], [64, 1], [64, .5],
  [62, 1], [60, .5], [62, 1], [64, .5], [60, 3],
] as const;

const itsyHarmonyC = [
  "C", "C", "G7", "C", "C", "C", "G7", "C",
  "C", "Am", "G7", "C", "C", "C", "G7", "C",
] as const;
```

If the opening pickup must be retained exactly, place G3 eighth (`[55, .5]`) at the end of the count-in/anacrusis rather than inserting it as a full downbeat.

Implementation guidance:

- Easy: exact monophonic melody above.
- Medium: identical melody plus quiet left-hand roots at bar starts, using the 16-bar harmony array.
- Hard: identical melody plus bass on the first dotted-quarter pulse and a compact chord/shell on the second pulse. Do not change the melody or regularize it into 4/4.
- The lead sheet has no numeric tempo; MakingMusicFun says Moderato and Gardner uses dotted quarter = 90. Because the app stores quarter-note BPM, an editorial 100% tempo around quarter note = 132 (dotted quarter = 88) is a source-consistent, playable choice. Label it editorial rather than historical.

## Required catalog corrections

1. Change Itsy Bitsy Spider from 4/4 to 6/8 and replace its current approximate notes with the exact 48-beat C-major array.
2. Replace The Entertainer's current invented contour with the uniformly transposed A-flat array; set the key to A-flat major (adapted) and keep 2/4.
3. Keep the exact melody identical in Easy, Medium, and Hard. Difficulty comes from tempo targets and accompaniment density.
4. For The Entertainer, author the offbeat ragtime accompaniment rather than relying on generic downbeat block chords.
