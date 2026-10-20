/**
 * "A Little Place to Stay" — an original VirtuePets background composition.
 *
 * All notes and instruments below were composed/synthesized for this project.
 * There are no recordings, samples, third-party music, or dependencies.
 * Re-render from the repository root: node scripts/render-cozy-music.mjs
 *
 * Render once, play a normal audio file in the game. Circular note tails and
 * room reflections make the last bar flow directly back into the first.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 24_000;
const BPM = 72;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const BARS = 24;
const FRAMES = Math.round(BARS * BAR * SAMPLE_RATE);
const TAU = Math.PI * 2;
const mix = new Float64Array(FRAMES);

const hz = midi => 440 * 2 ** ((midi - 69) / 12);
const ease = value => Math.sin(Math.min(1, Math.max(0, value)) * Math.PI / 2) ** 2;

// Each chord is voiced closely enough to move gently into its neighbours.
// The third eight-bar phrase opens out before returning to the home chord.
const harmony = [
  { bass: 38, notes: [50, 57, 61, 66], pad: [57, 61, 64, 66] }, // Dmaj9
  { bass: 37, notes: [49, 57, 59, 64], pad: [57, 59, 61, 64] }, // Aadd9/C#
  { bass: 35, notes: [47, 54, 57, 62], pad: [54, 57, 61, 62] }, // Bm9
  { bass: 42, notes: [49, 57, 61, 64], pad: [57, 61, 64, 66] }, // F#m7
  { bass: 43, notes: [50, 55, 59, 66], pad: [55, 59, 62, 66] }, // Gmaj7
  { bass: 42, notes: [50, 57, 62, 64], pad: [57, 62, 64, 66] }, // Dadd9/F#
  { bass: 40, notes: [52, 55, 59, 62], pad: [55, 59, 62, 66] }, // Em9
  { bass: 33, notes: [52, 57, 59, 61], pad: [57, 59, 61, 64] }, // Aadd9
];
const progression = [
  ...harmony,
  ...harmony,
  harmony[4], harmony[7], harmony[3], harmony[2],
  harmony[6], harmony[5], harmony[4], harmony[7],
];

// [beat within the bar, MIDI note, held beats]. Deliberate breaths at the
// ends of phrases keep this a background melody rather than a busy solo.
const melody = [
  [[0.5, 66, 1.1], [2, 69, 0.7], [3, 64, 0.65]],
  [[0, 73, 1.4], [2, 71, 0.65], [3, 69, 0.8]],
  [[0.5, 66, 1.0], [2, 62, 0.8], [3, 64, 0.7]],
  [[0, 66, 2.4], [3, 69, 0.6]],
  [[0.5, 71, 1.1], [2, 69, 0.7], [3, 66, 0.7]],
  [[0, 64, 0.8], [1, 66, 1.4], [3, 69, 0.7]],
  [[0.5, 67, 0.8], [2, 66, 0.7], [3, 64, 0.7]],
  [[0, 61, 1.3], [2, 64, 1.1]],
  [[0.5, 66, 0.8], [1.5, 69, 0.7], [2.5, 73, 1.0]],
  [[0, 71, 1.2], [2, 69, 1.4]],
  [[0.5, 66, 1.0], [2, 69, 0.7], [3, 74, 0.7]],
  [[0, 73, 1.5], [2, 69, 1.1]],
  [[0.5, 71, 1.1], [2, 74, 0.7], [3, 71, 0.7]],
  [[0, 69, 1.2], [2, 66, 0.8], [3, 64, 0.7]],
  [[0, 67, 1.1], [1.5, 66, 0.8], [2.5, 64, 0.8]],
  [[0, 61, 1.4], [2, 64, 0.8], [3, 66, 0.6]],
  [[0, 67, 1.3], [2, 71, 1.2]],
  [[0.5, 69, 1.0], [2, 64, 1.2]],
  [[0.5, 66, 1.0], [2, 69, 0.7], [3, 73, 0.7]],
  [[0, 74, 1.3], [2, 73, 0.65], [3, 71, 0.7]],
  [[0.5, 67, 1.0], [2, 66, 0.7], [3, 64, 0.7]],
  [[0, 66, 1.4], [2, 69, 1.2]],
  [[0.5, 71, 1.0], [2, 69, 0.7], [3, 67, 0.7]],
  [[0, 64, 1.5], [2.5, 61, 1.0]],
];

const instruments = {
  keys: {
    release: 1.25,
    sample(t, held, frequency) {
      const attack = ease(t / 0.016);
      const release = t <= held ? 1 : (1 - ease((t - held) / 1.25));
      const phase = TAU * frequency * t;
      // Soft electric/felt piano: mostly the fundamental; higher partials
      // settle quickly and never have the sharp click of a plucked oscillator.
      const body = Math.sin(phase) * Math.exp(-t / 2.8);
      const second = 0.27 * Math.sin(phase * 2) * Math.exp(-t / 1.5);
      const third = 0.075 * Math.sin(phase * 3) * Math.exp(-t / 0.65);
      const fourth = 0.025 * Math.sin(phase * 4) * Math.exp(-t / 0.28);
      return attack * release * (body + second + third + fourth);
    },
  },
  pad: {
    release: 2.15,
    sample(t, held, frequency) {
      const envelope = ease(t / 0.85) * (t <= held ? 1 : 1 - ease((t - held) / 2.15));
      const phase = TAU * frequency * t;
      const body = 0.65 * Math.sin(phase)
        + 0.18 * Math.sin(phase * 1.0008)
        + 0.17 * Math.sin(phase * 0.9992)
        + 0.055 * Math.sin(phase * 2);
      return envelope * body;
    },
  },
  bass: {
    release: 0.65,
    sample(t, held, frequency) {
      const envelope = ease(t / 0.055) * Math.exp(-t / 2.8)
        * (t <= held ? 1 : 1 - ease((t - held) / 0.65));
      const phase = TAU * frequency * t;
      return envelope * (Math.sin(phase) + 0.24 * Math.sin(phase * 2));
    },
  },
  bell: {
    release: 2.4,
    sample(t, held, frequency) {
      const envelope = ease(t / 0.022) * Math.exp(-t / 1.7)
        * (t <= held ? 1 : 1 - ease((t - held) / 2.4));
      const phase = TAU * frequency * t;
      return envelope * (Math.sin(phase) + 0.12 * Math.sin(phase * 2));
    },
  },
};

function note(instrument, midi, startBeat, heldBeats, volume) {
  const voice = instruments[instrument];
  const start = Math.round(startBeat * BEAT * SAMPLE_RATE);
  const held = heldBeats * BEAT;
  const length = Math.ceil((held + voice.release) * SAMPLE_RATE);
  const frequency = hz(midi);
  for (let i = 0; i < length; i++) {
    // Notes crossing the end continue at the beginning of the loop.
    mix[(start + i) % FRAMES] += voice.sample(i / SAMPLE_RATE, held, frequency) * volume;
  }
}

progression.forEach((chord, bar) => {
  const start = bar * 4;
  const phraseLift = bar >= 16 ? 0.94 : 1;
  chord.pad.forEach((pitch, index) => {
    note('pad', pitch, start + index * 0.018, 3.6, 0.013 * phraseLift);
  });
  note('bass', chord.bass, start, 2.65, 0.066);
  if (bar % 2 === 0) note('bass', chord.bass + 12, start + 3, 0.55, 0.018);

  // An unhurried, lightly rolled accompaniment. Small fixed variations
  // follow the phrase, so repeats feel played rather than randomized.
  const pattern = bar % 2 === 0 ? [0, 2, 1, 3] : [0, 1, 3, 2];
  const times = [0.04, 0.72, 1.95, 2.72];
  pattern.forEach((tone, index) => {
    note('keys', chord.notes[tone], start + times[index], 1.3,
      [0.040, 0.031, 0.035, 0.028][index] * phraseLift);
  });

  melody[bar].forEach(([beat, pitch, held], index) => {
    const phraseEnd = bar % 8 === 7;
    note('keys', pitch, start + beat + 0.012, held,
      (phraseEnd ? 0.074 : 0.092) * (index === 0 ? 1 : 0.9));
  });
});

// A handful of soft celesta-like answers, well above the accompaniment.
for (const [bar, beat, pitch] of [[3, 2.5, 78], [7, 3.1, 76], [11, 3, 81],
  [15, 3.25, 76], [19, 2.75, 78], [23, 3.25, 76]]) {
  note('bell', pitch, bar * 4 + beat, 0.7, 0.014);
}

// Short, progressively darker room reflections. Read a separate dry buffer
// so rendering never depends on which samples happen to be visited first.
const dry = mix.slice();
const reflections = [
  [0.113, 0.13], [0.197, 0.10], [0.311, 0.075], [0.431, 0.055],
  [0.593, 0.040], [0.797, 0.027], [1.031, 0.018], [1.317, 0.011],
];
reflections.forEach(([seconds, gain], tap) => {
  const delay = Math.round(seconds * SAMPLE_RATE);
  // Warm the reflected sound with a one-pole low-pass filter. Prime it with
  // the preceding tail so the filter itself is continuous at the boundary.
  const alpha = 0.23 / (1 + tap * 0.17);
  let filtered = 0;
  for (let i = FRAMES - SAMPLE_RATE; i < FRAMES; i++) {
    filtered += alpha * (dry[i] - filtered);
  }
  for (let i = 0; i < FRAMES; i++) {
    filtered += alpha * (dry[i] - filtered);
    mix[(i + delay) % FRAMES] += filtered * gain;
  }
});

// Remove the tiny residual DC offset and keep generous headroom. Playback
// has its own quiet default volume; no compressor or hard limiter is used.
const mean = mix.reduce((sum, sample) => sum + sample, 0) / FRAMES;
let rawPeak = 0;
for (let i = 0; i < FRAMES; i++) {
  mix[i] -= mean;
  rawPeak = Math.max(rawPeak, Math.abs(mix[i]));
}
const gain = 0.68 / rawPeak;
const wav = Buffer.alloc(44 + FRAMES * 2);
wav.write('RIFF', 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); // PCM
wav.writeUInt16LE(1, 22); // mono
wav.writeUInt32LE(SAMPLE_RATE, 24);
wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(FRAMES * 2, 40);

let squared = 0;
let largestStep = 0;
let peak = 0;
let previous = Math.round(mix[FRAMES - 1] * gain * 32767) / 32767;
const lastSample = previous;
for (let i = 0; i < FRAMES; i++) {
  const integer = Math.round(mix[i] * gain * 32767);
  wav.writeInt16LE(integer, 44 + i * 2);
  const sample = integer / 32767;
  squared += sample * sample;
  peak = Math.max(peak, Math.abs(sample));
  largestStep = Math.max(largestStep, Math.abs(sample - previous));
  previous = sample;
}
const firstSample = wav.readInt16LE(44) / 32767;
const target = fileURLToPath(new URL('../public/audio/cozy-day.wav', import.meta.url));
mkdirSync(fileURLToPath(new URL('../public/audio/', import.meta.url)), { recursive: true });
writeFileSync(target, wav);
console.log(JSON.stringify({
  file: target,
  seconds: FRAMES / SAMPLE_RATE,
  sampleRate: SAMPLE_RATE,
  channels: 1,
  bytes: wav.length,
  peak,
  rms: Math.sqrt(squared / FRAMES),
  seamStep: Math.abs(firstSample - lastSample),
  largestAdjacentStep: largestStep,
}, null, 2));
