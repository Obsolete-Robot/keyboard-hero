# Keyboard Hero

A MIDI-powered, Three.js piano trainer built for a 25-key controller such as the
Akai MPK Mini IV. Falling-note gameplay, real-time timing feedback, adaptive
practice tools, and a Web Audio instrument turn a lesson into a stage set.

## Play

1. Run `npm install` and `npm run dev`.
2. Open the local URL in Chrome or Edge.
3. Click **Connect MIDI** and choose the MPK Mini input.
4. Use the controller's octave buttons until its leftmost key sends C3 (MIDI
   48). The rightmost key should send C5 (MIDI 72).

No controller is required for a test drive. The lower computer-keyboard row
(`Z` through `M`) plays C3–B3; the upper row (`Q` through `I`) plays C4–C5,
with number/letter keys between them for the black notes.

## Practice tools

- Ten original or public-domain lessons from first notes to two-hand arpeggios
- Flow, Wait, and Listen modes
- Tempo control from 25% to 125% without changing pitch
- Rewind, section loops, and custom A/B loop points
- Count-in, metronome, input-latency adjustment, score, streak, and accuracy
- MIDI, computer keyboard, and on-screen pointer input
- Local persistence for practice settings

## Commands

- `npm run dev` — start the local game
- `npm run build` — create the production build
- `npm run lint` — check the source
- `npm test` — build and smoke-test the rendered game shell

Requires Node.js 22.13 or newer.
