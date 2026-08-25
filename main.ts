// Steps 1-5 (see PLAN.md): tone engine + scale lock, tap soil to plant a
// seed, a permanent seed -> sprout -> mature growth, a quiet evolving
// sustained layer once mature (bounded by a voice cap) instead of going
// silent, dragging through the garden to water, and three plant species ---
// flower, grass, tree --- assigned by tap order (1-2-3-1-2-3...) rather than
// any menu, differing only in the parameters fed into this one shared
// Voice/growth/drone machinery.

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
    // Kept low: a garden full of mature plants layers several quiet sustained
    // voices on top of the occasional blip, and headroom is what keeps that
    // layering musical instead of clipped.
    masterGain.gain.value = 0.5;
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

/** Per-species sound shape --- species differ only in these values, never in
 * a separate synthesis path. */
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
  release: 0.5,
  gain: 0.28,
};

/**
 * The one Voice primitive: oscillator -> filter -> envelope -> master gain,
 * auto-disconnected once the envelope finishes. A single short, self-
 * contained musical event --- planting, each growth-stage transition, and
 * watering all reuse this by passing a different pitch/timbre. Nothing here
 * ever holds an oscillator open longer than its own attack + release, so a
 * garden full of permanent, mature plants costs nothing to sustain.
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
  envelope.gain.linearRampToValueAtTime(0, now + timbre.attack + timbre.release);

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

// --- Growth: seed -> sprout -> mature, permanently ------------------------

type Stage = "seed" | "sprout" | "mature";

interface GrowthStop {
  stage: Stage;
  at: number; // ms since planting
  size: number; // rem
  color: [number, number, number];
  glow: number; // rem
}

// --- Species: three plant types sharing one Voice/growth/drone machinery --
//
// A species is nothing but a bundle of parameters --- its own timbre, octave,
// growth curve, and drone character --- fed into the same functions every
// other species uses. Assigned by tap order (1-2-3-1-2-3...), never randomly
// and never through any menu: variety with zero new interface surface.

type Species = "flower" | "grass" | "tree";

const SPECIES_ORDER: Species[] = ["flower", "grass", "tree"];
let nextSpeciesIndex = 0;

function nextSpecies(): Species {
  const species = SPECIES_ORDER[nextSpeciesIndex % SPECIES_ORDER.length];
  nextSpeciesIndex++;
  return species;
}

interface DroneProfile {
  lfoRateMin: number;
  lfoRateRange: number;
  lfoDepthMultiplier: number; // of the species' filterFrequency
  gain: number;
}

interface SpeciesProfile {
  timbre: Timbre;
  // Octave shift only --- must stay a power of 2, or a species would drift
  // off the pentatonic lock that xToPitch guarantees everyone else.
  registerMultiplier: number;
  growth: GrowthStop[];
  drone: DroneProfile;
}

const SPECIES_PROFILES: Record<Species, SpeciesProfile> = {
  flower: {
    timbre: { waveform: "triangle", filterFrequency: 3200, attack: 0.008, release: 0.3, gain: 0.24 },
    registerMultiplier: 2,
    growth: [
      { stage: "seed", at: 0, size: 0.35, color: [168, 107, 60], glow: 0.06 },
      { stage: "sprout", at: 250, size: 0.85, color: [214, 138, 120], glow: 0.35 },
      { stage: "mature", at: 1100, size: 1.3, color: [236, 72, 153], glow: 0.75 },
    ],
    drone: { lfoRateMin: 0.2, lfoRateRange: 0.3, lfoDepthMultiplier: 0.2, gain: 0.045 },
  },
  // The anchor species: identical numbers to the single-species baseline
  // this replaced, so nothing about the original feel moves.
  grass: {
    timbre: DEFAULT_TIMBRE,
    registerMultiplier: 1,
    growth: [
      { stage: "seed", at: 0, size: 0.4, color: [77, 51, 25], glow: 0.05 },
      { stage: "sprout", at: 500, size: 0.9, color: [134, 163, 60], glow: 0.3 },
      { stage: "mature", at: 2000, size: 1.4, color: [74, 222, 128], glow: 0.6 },
    ],
    drone: { lfoRateMin: 0.1, lfoRateRange: 0.15, lfoDepthMultiplier: 0.15, gain: 0.05 },
  },
  tree: {
    timbre: { waveform: "sawtooth", filterFrequency: 750, attack: 0.06, release: 0.9, gain: 0.32 },
    registerMultiplier: 0.5,
    growth: [
      { stage: "seed", at: 0, size: 0.45, color: [61, 41, 20], glow: 0.05 },
      { stage: "sprout", at: 900, size: 1.0, color: [93, 107, 58], glow: 0.35 },
      { stage: "mature", at: 3200, size: 1.6, color: [32, 84, 52], glow: 0.5 },
    ],
    drone: { lfoRateMin: 0.04, lfoRateRange: 0.06, lfoDepthMultiplier: 0.1, gain: 0.06 },
  },
};

// Ratios shared by every species, applied to each one's own base numbers ---
// kept flat rather than per-species so they don't compound with an already
// quiet/dark profile like tree's and make its drone swell inaudible.
const DRONE_FILTER_MULTIPLIER = 0.5;
const WATER_BRIGHTEN_FILTER_MULTIPLIER = 0.9;
const WATER_BRIGHTEN_GAIN_MULTIPLIER = 2.5;

/** A subtler/brighter voice per stage --- one plant, three moments, on top
 * of whatever base timbre its species contributes. */
function timbreForStage(stage: Stage, base: Timbre): Timbre {
  switch (stage) {
    case "seed":
      return { ...base, gain: base.gain * 0.35, filterFrequency: base.filterFrequency * 0.3, release: 0.25 };
    case "sprout":
      return { ...base, gain: base.gain * 0.65, filterFrequency: base.filterFrequency * 0.6, release: 0.35 };
    case "mature":
      return base;
  }
}

/** The watering chime's timbre, brighter and quieter than the species' own
 * voice --- so it reads as an outside touch, not another growth blip. */
function waterTimbre(base: Timbre): Timbre {
  return {
    ...base,
    filterFrequency: base.filterFrequency * 1.4,
    gain: base.gain * 0.5,
    attack: 0.005,
    release: 0.18,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function formatColor([r, g, b]: [number, number, number]): string {
  return `rgb(${r} ${g} ${b})`;
}

function lerpColor(a: [number, number, number], b: [number, number, number], t: number): string {
  return formatColor([
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ]);
}

interface GrowthFrame {
  size: number;
  color: string;
  glow: number;
}

function matureAt(stops: GrowthStop[]): number {
  return stops[stops.length - 1].at;
}

/** Which stage a plant has reached, given its age --- the discrete moments
 * that trigger a blip, decoupled from the continuous visual below. */
function stageAt(elapsedMs: number, stops: GrowthStop[]): Stage {
  let current = stops[0].stage;
  for (const stop of stops) {
    if (elapsedMs >= stop.at) current = stop.stage;
  }
  return current;
}

/** Continuous seed -> sprout -> mature growth, eased between a species' own
 * waypoints --- a smooth blend the whole way, not a snap between three fixed
 * looks. */
function growthFrameAt(elapsedMs: number, stops: GrowthStop[]): GrowthFrame {
  for (let i = 0; i < stops.length - 1; i++) {
    const from = stops[i];
    const to = stops[i + 1];
    if (elapsedMs < to.at) {
      const t = (elapsedMs - from.at) / (to.at - from.at);
      const eased = t * t * (3 - 2 * t); // smoothstep
      return {
        size: lerp(from.size, to.size, eased),
        color: lerpColor(from.color, to.color, eased),
        glow: lerp(from.glow, to.glow, eased),
      };
    }
  }
  const mature = stops[stops.length - 1];
  return { size: mature.size, color: formatColor(mature.color), glow: mature.glow };
}

function applyGrowthFrame(dot: HTMLDivElement, frame: GrowthFrame): void {
  dot.style.setProperty("--plant-size", `${frame.size}rem`);
  dot.style.setProperty("--plant-color", frame.color);
  dot.style.setProperty("--plant-glow", `${frame.glow}rem`);
}

// --- Sustained layer: mature plants keep quietly singing ------------------
//
// A drone is a second kind of voice, distinct from playVoice's one-shot
// blips: a sustained oscillator + a slow LFO wobbling its filter, so a
// mature plant's note keeps gently evolving instead of falling silent.
// Bounded by MAX_SUSTAINED_VOICES --- the central update loop below is the
// one place that enforces the cap, reclaiming the oldest sustained voice
// (a short fade-out, not a hard cut) rather than ever letting the layer
// grow unbounded as the garden fills up. One shared cap across all species.

const MAX_SUSTAINED_VOICES = 8;
const SUSTAIN_ATTACK_S = 1.5;
const SUSTAIN_RELEASE_S = 1.2;

interface Drone {
  oscillator: OscillatorNode;
  lfo: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  // Precomputed once from the plant's species profile, so brightenDrone
  // never needs to look a species up --- it just reads these back.
  restGain: number;
  restFilterFrequency: number;
  brightenGain: number;
  brightenFilterFrequency: number;
}

const sustainedQueue: Plant[] = [];

function stopDrone(plant: Plant): void {
  const drone = plant.drone;
  if (!drone) return;
  plant.drone = undefined;

  const context = getAudioContext();
  const now = context.currentTime;

  drone.gain.gain.cancelScheduledValues(now);
  drone.gain.gain.setValueAtTime(drone.gain.gain.value, now);
  drone.gain.gain.linearRampToValueAtTime(0, now + SUSTAIN_RELEASE_S);
  drone.oscillator.stop(now + SUSTAIN_RELEASE_S);
  drone.lfo.stop(now + SUSTAIN_RELEASE_S);
  drone.oscillator.addEventListener("ended", () => {
    drone.oscillator.disconnect();
    drone.lfo.disconnect();
    drone.filter.disconnect();
    drone.gain.disconnect();
  });
}

/** Starts a mature plant's quiet, ever-so-slowly wobbling sustained note,
 * evicting the oldest sustained voice first if the cap is already full. */
function startDrone(plant: Plant): void {
  if (sustainedQueue.length >= MAX_SUSTAINED_VOICES) {
    const oldest = sustainedQueue.shift();
    if (oldest) stopDrone(oldest);
  }

  const profile = SPECIES_PROFILES[plant.species];
  const context = getAudioContext();
  const now = context.currentTime;

  const oscillator = context.createOscillator();
  oscillator.type = profile.timbre.waveform;
  oscillator.frequency.value = plant.pitch;

  const restFilterFrequency = profile.timbre.filterFrequency * DRONE_FILTER_MULTIPLIER;
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = restFilterFrequency;

  // A slow, desynced LFO per plant so a garden full of drones doesn't pulse
  // in lockstep --- each one wobbles at its own gentle, unrelated pace.
  const lfo = context.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = profile.drone.lfoRateMin + Math.random() * profile.drone.lfoRateRange;
  const lfoGain = context.createGain();
  lfoGain.gain.value = profile.timbre.filterFrequency * profile.drone.lfoDepthMultiplier;
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);

  const restGain = profile.drone.gain;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(restGain, now + SUSTAIN_ATTACK_S);

  oscillator.connect(filter);
  filter.connect(gain);
  gain.connect(getMasterGain(context));

  oscillator.start(now);
  lfo.start(now);

  plant.drone = {
    oscillator,
    lfo,
    filter,
    gain,
    restGain,
    restFilterFrequency,
    brightenGain: restGain * WATER_BRIGHTEN_GAIN_MULTIPLIER,
    brightenFilterFrequency: profile.timbre.filterFrequency * WATER_BRIGHTEN_FILTER_MULTIPLIER,
  };
  sustainedQueue.push(plant);
}

// --- Garden: tap soil to plant a seed, watch it grow, forever -------------

interface Plant {
  x: number;
  y: number;
  pitch: number;
  species: Species;
  dot: HTMLDivElement;
  plantedAt: number;
  stage: Stage;
  matured: boolean;
  drone?: Drone;
  lastWateredAt: number;
}

const plants: Plant[] = [];

function plantSeed(garden: HTMLElement, x: number, y: number): void {
  const species = nextSpecies();
  const profile = SPECIES_PROFILES[species];
  const pitch = xToPitch(x / garden.clientWidth) * profile.registerMultiplier;
  playVoice(pitch, timbreForStage("seed", profile.timbre));

  const dot = document.createElement("div");
  dot.className = `plant-dot plant-${species}`;
  dot.style.left = `${x}px`;
  dot.style.top = `${y}px`;
  applyGrowthFrame(dot, growthFrameAt(0, profile.growth));
  garden.appendChild(dot);

  plants.push({
    x,
    y,
    pitch,
    species,
    dot,
    plantedAt: performance.now(),
    stage: "seed",
    matured: false,
    lastWateredAt: -Infinity,
  });
}

// --- Watering: dragging through the garden -------------------------------
//
// A drag is its own continuous, lightweight sound --- filtered noise, not a
// full Voice --- whose brightness and volume track the pointer's speed. Each
// plant the drag path crosses gets briefly brightened (a mature plant's
// drone swells, then settles back) or reactivated (a plant whose drone was
// evicted, or hasn't grown one yet, gets a short bright chime instead), with
// a per-plant cooldown so lingering over one plant doesn't spam it.

const WATER_HIT_RADIUS_PX = 22;
const WATER_COOLDOWN_MS = 350;

const WATER_BRIGHTEN_SWELL_S = 0.15;
const WATER_BRIGHTEN_SETTLE_S = 0.9;

/** Briefly swells a mature plant's already-playing drone, then lets it
 * settle back to its own species' normal sustain level --- the LFO keeps
 * wobbling the filter on top of this the whole time, so it never sounds
 * stuck. */
function brightenDrone(drone: Drone): void {
  const context = getAudioContext();
  const now = context.currentTime;

  const gain = drone.gain.gain;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(gain.value, now);
  gain.linearRampToValueAtTime(drone.brightenGain, now + WATER_BRIGHTEN_SWELL_S);
  gain.linearRampToValueAtTime(drone.restGain, now + WATER_BRIGHTEN_SWELL_S + WATER_BRIGHTEN_SETTLE_S);

  const freq = drone.filter.frequency;
  freq.cancelScheduledValues(now);
  freq.setValueAtTime(freq.value, now);
  freq.linearRampToValueAtTime(drone.brightenFilterFrequency, now + WATER_BRIGHTEN_SWELL_S);
  freq.linearRampToValueAtTime(
    drone.restFilterFrequency,
    now + WATER_BRIGHTEN_SWELL_S + WATER_BRIGHTEN_SETTLE_S,
  );
}

function waterPlant(plant: Plant, now: number): void {
  plant.lastWateredAt = now;
  const profile = SPECIES_PROFILES[plant.species];
  playVoice(plant.pitch, waterTimbre(profile.timbre));

  if (plant.drone) {
    brightenDrone(plant.drone);
  } else if (plant.matured) {
    // Its drone was evicted under the voice cap --- watering revives it,
    // still subject to that same cap.
    startDrone(plant);
  }
}

/** Shortest distance from a point to a line segment, so a fast drag that
 * jumps several pixels between pointermove samples still "crosses" a plant
 * that sat between two samples, not just under one of them. */
function distanceToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - x1, py - y1);

  const t = Math.min(1, Math.max(0, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function waterPlantsAlong(x1: number, y1: number, x2: number, y2: number, now: number): void {
  for (const plant of plants) {
    if (now - plant.lastWateredAt < WATER_COOLDOWN_MS) continue;
    if (distanceToSegment(plant.x, plant.y, x1, y1, x2, y2) > WATER_HIT_RADIUS_PX) continue;
    waterPlant(plant, now);
  }
}

// A drag's visual trail: one CSS-animated droplet dropped every so often
// along the path, purely decorative and removed once its own fall animation
// ends --- nothing here touches the audio graph above.
const DROPLET_SPACING_PX = 14;

function spawnDroplet(garden: HTMLElement, x: number, y: number): void {
  const droplet = document.createElement("div");
  droplet.className = "water-droplet";
  droplet.style.left = `${x}px`;
  droplet.style.top = `${y}px`;
  droplet.addEventListener("animationend", () => droplet.remove());
  garden.appendChild(droplet);
}

let noiseBuffer: AudioBuffer | null = null;

/** A shared, lazily-built noise buffer --- generated once, looped by every
 * watering drag rather than regenerated per gesture. */
function getNoiseBuffer(context: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    const duration = 2;
    const buffer = context.createBuffer(1, context.sampleRate * duration, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    noiseBuffer = buffer;
  }
  return noiseBuffer;
}

interface WaterSound {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

const WATER_BASE_HZ = 300;
const WATER_MAX_HZ = 5000;
const WATER_HZ_PER_SPEED = 6000; // speed in px/ms
const WATER_BASE_GAIN = 0.03;
const WATER_MAX_GAIN = 0.18;
const WATER_GAIN_PER_SPEED = 0.4;
const WATER_PARAM_SMOOTHING_S = 0.05;

/** Starts the drag's own continuous sound: filtered noise, silent until the
 * first speed sample arrives. Not a Voice --- it lives for the whole drag,
 * not a single short envelope. */
function startWaterSound(): WaterSound {
  const context = getAudioContext();

  const source = context.createBufferSource();
  source.buffer = getNoiseBuffer(context);
  source.loop = true;

  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = WATER_BASE_HZ;
  filter.Q.value = 0.7;

  const gain = context.createGain();
  gain.gain.value = 0;

  source.connect(filter);
  filter.connect(gain);
  gain.connect(getMasterGain(context));
  source.start();

  return { source, filter, gain };
}

/** Speed (px/ms) shapes both how loud and how bright the drag sounds ---
 * a slow trickle stays quiet and dull, a fast swipe splashes louder and
 * brighter. setTargetAtTime glides toward each new target instead of
 * snapping, so frequent pointermove samples don't zipper the sound. */
function updateWaterSound(water: WaterSound, speed: number): void {
  const context = getAudioContext();
  const now = context.currentTime;

  const targetGain = Math.min(WATER_MAX_GAIN, WATER_BASE_GAIN + speed * WATER_GAIN_PER_SPEED);
  const targetHz = Math.min(WATER_MAX_HZ, WATER_BASE_HZ + speed * WATER_HZ_PER_SPEED);

  water.gain.gain.setTargetAtTime(targetGain, now, WATER_PARAM_SMOOTHING_S);
  water.filter.frequency.setTargetAtTime(targetHz, now, WATER_PARAM_SMOOTHING_S);
}

function stopWaterSound(water: WaterSound): void {
  const context = getAudioContext();
  const now = context.currentTime;
  const release = 0.15;

  water.gain.gain.cancelScheduledValues(now);
  water.gain.gain.setValueAtTime(water.gain.gain.value, now);
  water.gain.gain.linearRampToValueAtTime(0, now + release);
  water.source.stop(now + release);
  water.source.addEventListener("ended", () => {
    water.source.disconnect();
    water.filter.disconnect();
    water.gain.disconnect();
  });
}

/** The one central update loop: walks every still-growing plant each frame,
 * blends its visual smoothly toward maturity along its own species' growth
 * curve, and fires a short musical event exactly once at each growth stage
 * it newly reaches. On reaching maturity a plant starts its sustained drone
 * (bounded by the voice cap in startDrone) and is then skipped here
 * entirely --- its visual is settled and its ongoing sound lives in the
 * audio graph, not in this loop. */
function updatePlants(): void {
  const now = performance.now();

  for (const plant of plants) {
    if (plant.matured) continue;

    const profile = SPECIES_PROFILES[plant.species];
    const elapsed = now - plant.plantedAt;

    const stage = stageAt(elapsed, profile.growth);
    if (stage !== plant.stage) {
      plant.stage = stage;
      playVoice(plant.pitch, timbreForStage(stage, profile.timbre));
    }

    applyGrowthFrame(plant.dot, growthFrameAt(elapsed, profile.growth));

    if (elapsed >= matureAt(profile.growth)) {
      plant.matured = true;
      startDrone(plant);
    }
  }

  requestAnimationFrame(updatePlants);
}

// --- Gesture: pointerdown is a "maybe plant" until it proves otherwise ----
//
// A tap plants a seed; a drag waters. Which one it is can't be known until
// the pointer either lifts (tap) or travels far enough (drag), so nothing
// commits at pointerdown --- this is the one place that decides, rather than
// each gesture handler guessing independently.

const DRAG_THRESHOLD_PX = 8;

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  lastMoveAt: number;
  smoothedSpeed: number;
  watering: boolean;
  water?: WaterSound;
  lastDropletX: number;
  lastDropletY: number;
}

let drag: DragState | null = null;

const garden = document.querySelector<HTMLElement>("#garden");
if (garden) {
  garden.addEventListener("pointerdown", (event) => {
    if (drag) return; // one gesture at a time

    const rect = garden.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    drag = {
      pointerId: event.pointerId,
      startX: x,
      startY: y,
      lastX: x,
      lastY: y,
      lastMoveAt: performance.now(),
      smoothedSpeed: 0,
      watering: false,
      lastDropletX: x,
      lastDropletY: y,
    };
    garden.setPointerCapture(event.pointerId);
  });

  garden.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;

    const rect = garden.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const now = performance.now();

    if (!drag.watering) {
      const traveled = Math.hypot(x - drag.startX, y - drag.startY);
      if (traveled < DRAG_THRESHOLD_PX) return; // still just a maybe-plant
      drag.watering = true;
      drag.water = startWaterSound();
    }

    const dt = Math.max(1, now - drag.lastMoveAt);
    const dist = Math.hypot(x - drag.lastX, y - drag.lastY);
    drag.smoothedSpeed = lerp(drag.smoothedSpeed, dist / dt, 0.5);

    if (drag.water) updateWaterSound(drag.water, drag.smoothedSpeed);
    waterPlantsAlong(drag.lastX, drag.lastY, x, y, now);

    if (Math.hypot(x - drag.lastDropletX, y - drag.lastDropletY) >= DROPLET_SPACING_PX) {
      spawnDroplet(garden, x, y);
      drag.lastDropletX = x;
      drag.lastDropletY = y;
    }

    drag.lastX = x;
    drag.lastY = y;
    drag.lastMoveAt = now;
  });

  const endGesture = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;

    if (drag.watering) {
      if (drag.water) stopWaterSound(drag.water);
    } else {
      // Never crossed the drag threshold --- a tap. Plant a seed.
      plantSeed(garden, drag.startX, drag.startY);
    }

    drag = null;
  };

  garden.addEventListener("pointerup", endGesture);
  garden.addEventListener("pointercancel", endGesture);
}

requestAnimationFrame(updatePlants);
