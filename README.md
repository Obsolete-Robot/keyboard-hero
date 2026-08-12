# Keyboard Hero

A MIDI-powered, Three.js piano trainer built for a 25-key controller such as the
Akai MPK Mini IV. Falling-note gameplay, real-time timing feedback, adaptive
practice tools, and a Web Audio instrument turn a lesson into a stage set.

## Play

1. Run `npm install` and `npm run dev`.
2. Open the local URL in Chrome or Edge.
3. Allow MIDI access the first time the browser asks. Keyboard Hero reconnects
   the same input automatically on later visits; use **Connect MIDI** only as a
   fallback or to choose another input.
4. Align the keyboard once with its leftmost and rightmost keys. The alignment
   and MIDI channel are remembered for that browser. Re-align after changing
   the controller's octave, transpose, or preset settings.

No controller is required for a test drive. The lower computer-keyboard row
(`Z` through `M`) plays C3–B3; the upper row (`Q` through `I`) plays C4–C5,
with number/letter keys between them for the black notes.

## Practice tools

- Six-step beginner training room for finger placement, first chords, and a
  slow two-hand bridge into Frere Jacques
- Ten original or public-domain lessons from first notes to two-hand arpeggios
- Flow, Wait, and Listen modes
- Tempo control from 25% to 125% without changing pitch
- Rewind, section loops, and custom A/B loop points
- Count-in, metronome, input-latency adjustment, score, streak, and accuracy
- MIDI, computer keyboard, and on-screen pointer input
- Local persistence for practice, MIDI input, channel, and alignment settings

## Commands

- `npm run dev` — start the local game
- `npm run build` — create the production build
- `npm run lint` — check the source
- `npm test` — build and smoke-test the rendered game shell

Requires Node.js 22.13 or newer.
