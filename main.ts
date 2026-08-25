// Steps 1-2 (see PLAN.md): tone engine + scale lock, then tap soil to plant a
// seed. One species, bare visual --- growth stages, watering and multiple
// species are later steps.

let audioContext: AudioContext | null = null;

/** One shared context, created lazily and resumed on first pointer gesture. */
function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  if (audioContext.state === "suspended") {
    void audioContext.resume();
  }
  return audioContext;
}

let masterGain: GainNode | null = null;

function getMasterGain(context: AudioContext): GainNode {
  if (!masterGain) {
    masterGain = context.createGain();
    masterGain.gain.value = 0.8;
    masterGain.connect(context.destination);
  }
  return masterGain;
}

// Major pentatonic: semitone offsets with no dissonant interval between any
// two of them. Every pitch the instrument can ever produce comes from here,
// so "no wrong notes" is structural, not a filter bolted on later.
const SCALE_DEGREES = [0, 2, 4, 7, 9];
const ROOT_MIDI = 57; // A3
const OCTAVE_SPAN = 3;

/** Quantizes a horizontal position (0-1) to a frequency on the locked scale. */
export function xToPitch(x: number): number {
  const clamped = Math.min(1, Math.max(0, x));
  const steps = SCALE_DEGREES.length * OCTAVE_SPAN;
  const index = Math.min(steps - 1, Math.floor(clamped * steps));
  const octave = Math.floor(index / SCALE_DEGREES.length);
  const degree = SCALE_DEGREES[index % SCALE_DEGREES.length];
  const midi = ROOT_MIDI + degree + octave * 12;
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Per-species sound shape --- later plant types differ only in these values. */
export interface Timbre {
  waveform: OscillatorType;
  filterFrequency: number;
  attack: number;
  release: number;
  gain: number;
}

const DEFAULT_TIMBRE: Timbre = {
  waveform: "sine",
  filterFrequency: 2000,
  attack: 0.02,
  release: 0.8,
  gain: 0.3,
};

/**
 * The one Voice primitive: oscillator -> filter -> envelope -> master gain,
 * auto-disconnected once the envelope finishes. Planting, growth stages and
 * watering all reuse this by passing a different pitch/timbre, never a
 * separate synthesis path.
 */
export function playVoice(pitch: number, timbre: Timbre = DEFAULT_TIMBRE): void {
  const context = getAudioContext();
  const now = context.currentTime;

  const oscillator = context.createOscillator();
  oscillator.type = timbre.waveform;
  oscillator.frequency.value = pitch;

  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = timbre.filterFrequency;

  const envelope = context.createGain();
  envelope.gain.setValueAtTime(0, now);
  envelope.gain.linearRampToValueAtTime(timbre.gain, now + timbre.attack);
  envelope.gain.linearRampToValueAtTime(
    0,
    now + timbre.attack + timbre.release,
  );

  oscillator.connect(filter);
  filter.connect(envelope);
  envelope.connect(getMasterGain(context));

  oscillator.start(now);
  oscillator.stop(now + timbre.attack + timbre.release);
  oscillator.addEventListener("ended", () => {
    oscillator.disconnect();
    filter.disconnect();
    envelope.disconnect();
  });
}

// --- Garden: tap soil to plant a seed -------------------------------------

interface Plant {
  x: number;
  y: number;
  pitch: number;
  dot: HTMLDivElement;
}

const plants: Plant[] = [];

function plantSeed(garden: HTMLElement, x: number, y: number): void {
  const pitch = xToPitch(x / garden.clientWidth);
  playVoice(pitch);

  const dot = document.createElement("div");
  dot.className = "seed";
  dot.style.left = `${x}px`;
  dot.style.top = `${y}px`;
  garden.appendChild(dot);

  plants.push({ x, y, pitch, dot });
}

const garden = document.querySelector<HTMLElement>("#garden");
if (garden) {
  garden.addEventListener("pointerdown", (event) => {
    const rect = garden.getBoundingClientRect();
    plantSeed(garden, event.clientX - rect.left, event.clientY - rect.top);
  });
}
