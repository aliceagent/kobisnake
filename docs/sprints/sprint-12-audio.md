# Sprint 12 — Audio: Music, SFX, Settings

**Lead:** Sonnet · **Agents:** Sonnet ×2, Sonnet-QA ×1, Fable · **Prerequisite:** `sprint-11-done`

## Goal
Three selectable arcade music tracks, a five-second laser-warning sting that ducks the music and returns, every
sound effect in the GDD list, music/sound ON/OFF settings, all synthesised in the browser from in-repo note data
with no audio files and no network.

## In scope
Audio engine, synth, sequencer, three tracks, sting, SFX bank, settings wiring, track selection in match setup,
audio unlock behaviour, tests with a fake AudioContext and one real-browser smoke.

## Out of scope
Volume sliders (post-1.0), save persistence of settings (S13; this sprint keeps them in session state and exposes `get/set`).

## Tickets

### KS-12-01 · Audio engine, synth and sequencer
Owner: Sonnet · Size: L · Depends on: —
Files: `src/audio/audioEngine.js`, `src/audio/synth.js`, `src/audio/sequencer.js`, `tests/unit/audio/*.test.js`
Spec: `audioEngine` creates the `AudioContext` lazily on the first keydown/pointerdown (`ARCHITECTURE §9`),
graph: master → music gain, sfx gain. `synth.js`: voice = oscillator (square/saw/triangle/sine/noise) →
ADSR gain → lowpass; `play({ wave, freq, attack, decay, sustain, release, cutoff, duration, gain })`; 16-voice
polyphony with oldest-steal. `sequencer.js`: plays `{ bpm, steps, tracks: [{ wave, notes: [[step, midi, len,
vel], ...], ...}] }` in a loop using look-ahead scheduling (25 ms timer, 100 ms window). `setTrack(id)` crossfades
0.5 s. `duck(db, seconds)` + `unduck`. `mute(music|sfx, bool)`. Everything works with a `FakeAudioContext` in
tests (asserting scheduled times, not sound).
Acceptance criteria:
- [ ] AC1 Scheduled note start times match `60/bpm/4 × step` within 1 ms over 64 steps (fake context).
- [ ] AC2 Crossfade: old track gain reaches 0 and new reaches 1 at 0.5 s.
- [ ] AC3 No `AudioContext` is created before user interaction; after the first keydown it exists and `state` is running (real-browser e2e).
QA: unit + e2e.

### KS-12-02 · Three arcade tracks and the laser sting
Owner: Sonnet · Size: L · Depends on: KS-12-01
Files: `src/audio/tracks/track1.js`, `src/audio/tracks/track2.js`, `src/audio/tracks/track3.js`, `src/audio/tracks/laserSting.js`, `docs/design/AUDIO-NOTES.md`
Spec: Compose three 16–32 bar loops in the flavours from the GDD ("energetic arcade" ~150 bpm, "playful
arcade" ~120 bpm major key, "slightly intense arcade" ~140 bpm minor key), each with lead, bass, chords/arp and
a percussion track (noise hats, sine kick). Sting: 5 s, tense rising minor riff with siren-like slide and
percussion hits, ends on a clean cut so the music return is not muddy. Document each track's key, tempo and
structure in `AUDIO-NOTES.md` so an 11-year-old can edit a melody array (include a "change one note" worked
example).
Acceptance criteria:
- [ ] AC1 Each track loops seamlessly (no click: the last step's release fits within the loop; checked by rendering to an `OfflineAudioContext` and asserting no sample jump > 0.2 at the loop point).
- [ ] AC2 Peak level ≤ −1 dBFS per track (offline render).
- [ ] AC3 Fable listens on the preview and approves the three flavours as distinct.
QA: offline-render unit tests + manual.

### KS-12-03 · SFX bank
Owner: Sonnet · Size: M · Depends on: KS-12-01
Files: `src/audio/sfx.js`, `src/game/session.js` (event → sfx map)
Spec: One synth recipe per GDD sound: menu move, menu select, countdown tick + GO, food collect (short
ascending blip), power-up appear (sparkle), power-up pickup (bigger sparkle), speed boost (whoosh loop for the
duration at low gain), slow (descending "brrr"), snake growth (soft pop), crash (noise burst + low thud), laser
warning (handled by the sting), laser movement (short hum per step), laser death (zap), round win (3-note
rise), match win (fanfare), key reward (coin ×N), shop purchase (register). Map simulation and state-machine
events to sounds in `session.js`. Rate-limit food collect to one per 60 ms.
Acceptance criteria:
- [ ] AC1 Every listed sound has a recipe and a mapping (unit test asserts the map keys cover the list).
- [ ] AC2 Sounds do not play when SFX is OFF; music does not play when MUSIC is OFF (fake context gain assertions).
QA: unit + e2e (real browser: gain node values).

### KS-12-04 · Settings and match-setup wiring
Owner: Sonnet · Size: S · Depends on: KS-12-01
Files: `src/ui/screens/settings.js`, `src/ui/screens/matchSetup.js`, `src/game/session.js`
Spec: SETTINGS screen toggles call `audioEngine.mute`. MUSIC row in match setup previews the track on focus
(plays 4 bars) and sets the match track. Laser warning: on `LASER_WARNING` duck music −12 dB, play the sting,
at 5 s unduck (per GDD "then return to the regular selected track").
Acceptance criteria:
- [ ] AC1 Toggle states survive navigating away and back within the session.
- [ ] AC2 Warning sequence timing verified with the fake context (duck at t, sting 5 s, unduck at t+5).
QA: unit + e2e.

### KS-12-05 · Audio test suite
Owner: Sonnet-QA · Size: S · Depends on: KS-12-03
Files: `tests/unit/audio/FakeAudioContext.js`, `tests/e2e/audio.spec.js`
Acceptance criteria:
- [ ] AC1 Suite green in CI; the real-browser test runs with `--autoplay-policy=no-user-gesture-required` only where needed and documents it.
QA: —

## QA plan (sprint pass)
1. Fable listens to all three tracks, the sting, and every SFX from a checklist; approves or names changes.
2. Human: play a Bo3 with sound; confirm the warning is "obvious" (A1) and nothing is annoying at repeated pickups.
3. Adversary: toggle music during the sting; alt-tab during the sting; switch tracks 20 times quickly.

## References
- GDD §4 "Music", "Laser warning music", "Settings", §5 "Music", "Sound effects", "Settings"
- `DESIGN-DECISIONS §1 row 25`, `ARCHITECTURE §9`

## Exit criteria
- [ ] Fable audio approval; offline/CSP checks still green; tag `sprint-12-done`.
