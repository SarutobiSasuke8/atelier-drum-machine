# Atelier Drum Machine

A single-page drum machine that runs in the browser. Every sound is synthesised with the Web Audio API: oscillators, noise and envelopes. There is no sample library, no framework and no build step.

## Install

You need Node.js 20 or newer. There are no dependencies to install.

```bash
git clone https://github.com/SarutobiSasuke8/atelier-drum-machine.git
cd atelier-drum-machine
npm test
```

## Play

```bash
npm run serve
```

The server listens on port 8080, or the port set in `PORT`. Open the page the server prints. Use localhost or HTTPS so the browser offers the Web MIDI permission prompt. Press **Play** or hit the space bar. The transport loops a chain of 16-step bars.

- **Pads.** Sixteen pads in a 4×4 grid. The top of a pad is louder than the bottom. Pads light when they fire.
- **Keyboard.** `1 2 3 4`, `Q W E R`, `A S D F`, `Z X C V`, matching the pad grid from the top left. Hold Shift for a softer hit. Space starts and stops.
- **Steps.** Click a cell to toggle it. Drag up or down on a cell to change its velocity. The bright column is the playing step.
- **Bars A–D.** Edit one bar while the chain decides what plays next. Click a chain slot to cycle it between A, B, C and D.
- **Record.** Arm Record, press Play, and play the pads. Hits quantise to the nearest step of the bar that is sounding.
- **Note repeat.** Choose 1/8, 1/16 or 1/32, then hold a pad, key or MIDI note. Repeats follow the tempo.
- **Bass lane.** Each step can hold a note, octave, velocity, accent and slide. Slide glides in from the previous bass note. Accent opens the filter and pushes the level.
- **Demos.** House, Techno, Drum and Bass, Boom Bap, Acid and Garage.

Tempo runs from 60 to 200. Swing runs from 0% (straight sixteenths) to 75%. At 50% the off-beat sits on a triplet.

## Keyboard and MIDI map

Pads are numbered left to right, top to bottom. MIDI note 36 is the top-left pad.

| Pad | Voice     | Key | MIDI |
| --- | --------- | --- | ---- |
| 1   | Kick      | 1   | 36   |
| 2   | Snare     | 2   | 37   |
| 3   | Clap      | 3   | 38   |
| 4   | Rim       | 4   | 39   |
| 5   | Hat       | Q   | 40   |
| 6   | Open Hat  | W   | 41   |
| 7   | Low Tom   | E   | 42   |
| 8   | High Tom  | R   | 43   |
| 9   | Cowbell   | A   | 44   |
| 10  | Crash     | S   | 45   |
| 11  | Shaker    | D   | 46   |
| 12  | Conga     | F   | 47   |
| 13  | Clave     | Z   | 48   |
| 14  | Tamb      | X   | 49   |
| 15  | Ride      | C   | 50   |
| 16  | Blip      | V   | 51   |

Web MIDI inputs are picked up when you choose **Enable MIDI** (browsers ask for permission). Note-on messages from 36 through 51 play the pads. Velocity is the pad velocity. Note-off ends note-repeat.

The closed hat chokes the open hat. A closed-hat step also suppresses an open hat on that same step.

## Voices

Each drum voice has **tune**, **decay**, **level** and **drive**. Tune is a ±12 semitone control around that voice’s pitch. The kick also has **punch** and a musical **key** (the sustain pitch of the drum). Sends are per voice.

The bass is a saw or square oscillator through two low-pass stages (24 dB/octave) with resonance, an envelope on the cutoff, drive, accent and slide.

The master section has drive, a compressor, a low-pass filter, tempo-synced reverb and delay sends, output level, and a level meter. Reverb length and delay time follow the tempo. Delay divisions are 1/4, 1/8, dotted 1/8 and 1/16.

## Samples

Drop a WAV or MP3 onto any pad to switch that pad from synthesis to the dropped audio. The pad then has pitch (±24 semitones), start and end trim, attack, decay, reverse and a choke group (`hats`, `perc`, `metal`). **Chop into 16** slices the most recent drop into equal regions across the pads. Sample audio stays in the session; pattern and kit files store the synthesis settings only.

## Save and export

Patterns and kits are stored in the browser as you edit. The buttons download or upload JSON. **Export WAV** renders the chain with `OfflineAudioContext`. **Export MIDI** writes a type-0 Standard MIDI file: drums on channel 10, bass on channel 1, 480 ticks per quarter note, with the same swing as the sequencer.

Export length can be the bar you are viewing, the chain once, or the chain twice.

## JSON formats

Both documents are UTF-8 JSON.

### Pattern (`format: "atelier-pattern"`, `version: 1`)

```json
{
  "format": "atelier-pattern",
  "version": 1,
  "name": "House",
  "bpm": 124,
  "swing": 0,
  "chain": ["A", "A", "B", "A"],
  "bars": {
    "A": {
      "lanes": { "kick": [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] },
      "bass": [
        { "note": "C", "octave": 2, "velocity": 0.86, "accent": false, "slide": false },
        null
      ]
    }
  }
}
```

- `bpm` is clamped to 60–200. `swing` is clamped to 0–0.75.
- `chain` is an ordered list of `A`, `B`, `C` and `D`.
- Each bar has sixteen velocities from 0 to 1 per voice. `0` is a rest. Missing voices are silent.
- Each bass step is `null` or `{ note, octave, velocity, accent, slide }`. Notes are `C` through `B` with optional `#`. Octave is 0–7. Middle C is `C4` (MIDI 60). `C2` is MIDI 36.
- A pattern file may include a `kit` object. Loading it applies that kit. The kit file format is below. The in-app pattern download leaves the kit out so the two files stay separate.

### Kit (`format: "atelier-kit"`, `version: 1`)

```json
{
  "format": "atelier-kit",
  "version": 1,
  "name": "Studio",
  "voices": {
    "kick": { "tune": 0.5, "decay": 0.42, "level": 0.95, "drive": 0.22, "punch": 0.62, "key": "A1" }
  },
  "sends": { "kick": { "reverb": 0, "delay": 0 } },
  "bass": {
    "wave": "saw",
    "cutoff": 0.28,
    "resonance": 0.62,
    "env": 0.55,
    "decay": 0.42,
    "level": 0.55,
    "drive": 0.18,
    "tune": 0.5
  },
  "master": {
    "drive": 0.18,
    "compress": 0.4,
    "filter": 0.92,
    "reverb": 0.16,
    "delay": 0.1,
    "delayDivision": "1/8",
    "level": 0.86
  }
}
```

`wave` is `saw` or `square`. `delayDivision` is `1/4`, `1/8`, `1/8d` or `1/16`. `key` is a note name plus octave, such as `F1`. Omitted fields fall back to the studio defaults.

Shipped patterns live in [`src/demos`](src/demos).

## Engine API

[`src/engine.js`](src/engine.js) does not touch the DOM. The piece meant to move into `atelier-dsp` is:

| Function | Role |
| --- | --- |
| `createDrumMachine(audioContext)` | Build the graph, kit and transport on a live or offline context. |
| `triggerVoice(machine, voiceId, options)` | Play a drum voice or `"bass"` at `options.time` with `velocity`, and for bass `note`, `octave`, `accent`, `slide`, `glideFrom`. |
| `loadPattern(machine, pattern)` | Normalise a pattern document onto the machine. An embedded kit is applied. |
| `renderToWav(pattern, options)` | Render `options.bars` through `OfflineAudioContext` and return 16-bit stereo WAV bytes. |

Timing, swing, MIDI and pattern helpers used by the tests are exported from the same module: `stepOffsetSeconds`, `barDurationSeconds`, `stepsInRange`, `nearestStepIndex`, `patternToMidi`, `parsePattern`, `serializePattern`, `parseKit`, `serializeKit`.

## Tests

```bash
npm test
```

`node:test` covers sequencer windows, swing math, MIDI export and pattern/kit JSON round-trips, including the six demos.

## Licence

[MIT](LICENSE). The synthesis, patterns and interface in this repository are original. No samples are included.
