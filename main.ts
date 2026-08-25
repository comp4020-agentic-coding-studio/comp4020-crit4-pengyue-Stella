// Steps 1-5 (see PLAN.md): tone engine + scale lock, tap soil to plant a
// seed, a permanent seed -> sprout -> mature growth, a quiet evolving
// sustained layer once mature (bounded by a voice cap) instead of going
// silent, dragging through the garden to water, and three plant species ---
// flower, grass, tree --- differing only in the parameters fed into this one
// shared Voice/growth/drone machinery. A small tool tray (index.html) picks
// which of those species gets planted, or switches to the watering can
// (unchanged drag-to-water) or the shovel (tap a plant to remove it, with its
// own one-shot removal sound) --- see the Tool section below.

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
const SPECIES_OCTAVE_SPAN = 1; // each species draws from exactly one octave

/** Quantizes a horizontal position (0-1) to a frequency on the locked scale,
 * within one species' own octave band --- so tree/bush/flower stack into
 * distinct low/mid/high registers instead of all three sharing one range at
 * different transpositions. */
export function xToPitch(x: number, octaveOffset: number): number {
  const clamped = Math.min(1, Math.max(0, x));
  const steps = SCALE_DEGREES.length * SPECIES_OCTAVE_SPAN;
  const index = Math.min(steps - 1, Math.floor(clamped * steps));
  const octave = octaveOffset + Math.floor(index / SCALE_DEGREES.length);
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
// other species uses. Which one gets planted is chosen from the tool tray
// (see the Tool section below), never randomly.

type Species = "flower" | "grass" | "tree";

interface DroneProfile {
  lfoRateMin: number;
  lfoRateRange: number;
  lfoDepthMultiplier: number; // of the species' filterFrequency
  gain: number;
}

interface SpeciesProfile {
  timbre: Timbre;
  // Which octave-band of the locked scale this species draws from --- bands
  // are one octave wide and contiguous (see SPECIES_OCTAVE_SPAN), so
  // tree/bush/flower stack into distinct low/mid/high registers instead of
  // all three sharing the same range at different transpositions.
  octaveOffset: number;
  growth: GrowthStop[];
  drone: DroneProfile;
}

const SPECIES_PROFILES: Record<Species, SpeciesProfile> = {
  // The high, bright melodic lead: fastest to mature, quickest attack/
  // shortest release of the three, sitting in the top octave band.
  flower: {
    timbre: { waveform: "triangle", filterFrequency: 3200, attack: 0.008, release: 0.3, gain: 0.24 },
    octaveOffset: 2,
    // Sizes only (not stage/at/color/glow, which the sound side leans on) are
    // bumped from the original flat-dot scale --- a hand-drawn doodle with a
    // stem, leaves and five petals needs real room to be legible.
    growth: [
      { stage: "seed", at: 0, size: 1.2, color: [168, 107, 60], glow: 0.06 },
      { stage: "sprout", at: 250, size: 2.9, color: [214, 138, 120], glow: 0.35 },
      { stage: "mature", at: 1100, size: 4.5, color: [236, 72, 153], glow: 0.75 },
    ],
    drone: { lfoRateMin: 0.2, lfoRateRange: 0.3, lfoDepthMultiplier: 0.2, gain: 0.045 },
  },
  // The mid-range harmony layer: a plain sine (deliberately unobtrusive, so
  // it fills under the melody rather than competing with it) with a touch
  // more release than a pluck for a pad-like sustain, in the middle octave
  // band. Timing/color/glow numbers are otherwise the original single-
  // species baseline this replaced --- only size grew, for the same
  // doodle-legibility reason as flower/tree.
  grass: {
    timbre: { waveform: "sine", filterFrequency: 2000, attack: 0.02, release: 0.6, gain: 0.28 },
    octaveOffset: 1,
    growth: [
      { stage: "seed", at: 0, size: 1.5, color: [77, 51, 25], glow: 0.05 },
      { stage: "sprout", at: 500, size: 3.3, color: [134, 163, 60], glow: 0.3 },
      { stage: "mature", at: 2000, size: 5.2, color: [74, 222, 128], glow: 0.6 },
    ],
    drone: { lfoRateMin: 0.1, lfoRateRange: 0.15, lfoDepthMultiplier: 0.15, gain: 0.05 },
  },
  // The low, warm foundation: slowest to mature, slowest attack/longest
  // release and loudest of the three, sitting in the bottom octave band.
  tree: {
    timbre: { waveform: "sawtooth", filterFrequency: 620, attack: 0.06, release: 0.9, gain: 0.32 },
    octaveOffset: 0,
    growth: [
      { stage: "seed", at: 0, size: 1.9, color: [61, 41, 20], glow: 0.05 },
      { stage: "sprout", at: 900, size: 4.3, color: [93, 107, 58], glow: 0.35 },
      { stage: "mature", at: 3200, size: 6.8, color: [32, 84, 52], glow: 0.5 },
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
  // 0-1: elapsed / time-to-mature. Drives which parts of a plant's doodle
  // are revealed (--growth in styles.css) --- separate from stage/size/color
  // above, which is what the sound side and the glow tint key off.
  progress: number;
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
  const progress = Math.min(1, elapsedMs / matureAt(stops));
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
        progress,
      };
    }
  }
  const mature = stops[stops.length - 1];
  return { size: mature.size, color: formatColor(mature.color), glow: mature.glow, progress };
}

function applyGrowthFrame(dot: HTMLDivElement, frame: GrowthFrame): void {
  dot.style.setProperty("--plant-size", `${frame.size}rem`);
  dot.style.setProperty("--plant-color", frame.color);
  dot.style.setProperty("--plant-glow", `${frame.glow}rem`);
  dot.style.setProperty("--growth", `${frame.progress}`);
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

// --- Doodle art: hand-drawn, multi-phase plant markup ---------------------
//
// A plant's growth is a small SVG tree of parts, not one shape scaling up.
// Every part is tagged data-phase="seed"|"a"|"b"|"c"|"d"; the shared CSS in
// styles.css reveals each phase over its own window of --growth (0-1, set by
// applyGrowthFrame above from how far a plant is toward its own species'
// time-to-mature). Only which art sits in which phase differs per species,
// so "fast flower, slow tree" comes entirely from each species' own growth
// timing, not from separate reveal logic here. Paths are generated fresh per
// plant from small random jitter --- irregular and asymmetric on purpose, so
// the look reads as hand-drawn rather than a fixed vector icon, and no two
// plants of a kind are identical.

function jitter(range: number, rand: () => number): number {
  return (rand() - 0.5) * 2 * range;
}

/** An asymmetric almond-shaped leaf or petal from base to tip. */
function leafPath(
  baseX: number,
  baseY: number,
  tipX: number,
  tipY: number,
  width: number,
  rand: () => number,
): string {
  const mx = (baseX + tipX) / 2;
  const my = (baseY + tipY) / 2;
  const dx = tipX - baseX;
  const dy = tipY - baseY;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const w1 = width * (0.9 + rand() * 0.4);
  const w2 = width * (0.6 + rand() * 0.4);
  const bowX = jitter(len * 0.12, rand);
  const bowY = jitter(len * 0.12, rand);
  const leftX = mx + nx * w1 + bowX;
  const leftY = my + ny * w1 + bowY;
  const rightX = mx - nx * w2 + bowX;
  const rightY = my - ny * w2 + bowY;
  return (
    `M ${baseX.toFixed(1)} ${baseY.toFixed(1)} ` +
    `Q ${leftX.toFixed(1)} ${leftY.toFixed(1)} ${tipX.toFixed(1)} ${tipY.toFixed(1)} ` +
    `Q ${rightX.toFixed(1)} ${rightY.toFixed(1)} ${baseX.toFixed(1)} ${baseY.toFixed(1)} Z`
  );
}

/** An irregular closed blob --- used for leaf and canopy clusters so a group
 * of these reads as foliage, never as a uniform oval. */
function blobPath(cx: number, cy: number, r: number, points: number, rand: () => number): string {
  const angleStep = (Math.PI * 2) / points;
  const coords: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const angle = i * angleStep + jitter(0.2, rand);
    const radius = r * (0.72 + rand() * 0.5);
    coords.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
  }
  let d = `M ${coords[0][0].toFixed(1)} ${coords[0][1].toFixed(1)} `;
  for (let i = 0; i < points; i++) {
    const [x0, y0] = coords[i];
    const [x1, y1] = coords[(i + 1) % points];
    const mx = (x0 + x1) / 2 + jitter(r * 0.25, rand);
    const my = (y0 + y1) / 2 + jitter(r * 0.25, rand);
    d += `Q ${mx.toFixed(1)} ${my.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)} `;
  }
  return d + "Z";
}

/** A single bowed stem/branch/twig centerline --- drawn with stroke-dasharray
 * in CSS so it reveals as if growing, rather than popping in at full length. */
function stemPath(baseX: number, baseY: number, tipX: number, tipY: number, bow: number): string {
  const mx = (baseX + tipX) / 2 + bow;
  const my = (baseY + tipY) / 2;
  return `M ${baseX.toFixed(1)} ${baseY.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${tipX.toFixed(1)} ${tipY.toFixed(1)}`;
}

/** A filled, tapering trunk silhouette --- wide at the base, narrow at the
 * tip. A tree's trunk thickens by scaling up this filled shape rather than by
 * animating stroke-width, which doesn't render reliably across renderers. */
function trunkPath(
  baseX: number,
  baseY: number,
  tipX: number,
  tipY: number,
  baseWidth: number,
  tipWidth: number,
  rand: () => number,
): string {
  const dx = tipX - baseX;
  const dy = tipY - baseY;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const bow = jitter(len * 0.06, rand);
  const midX = (baseX + tipX) / 2 + bow;
  const midY = (baseY + tipY) / 2;
  const midWidth = (baseWidth + tipWidth) / 2;
  const leftBase: [number, number] = [baseX + nx * baseWidth, baseY + ny * baseWidth];
  const rightBase: [number, number] = [baseX - nx * baseWidth, baseY - ny * baseWidth];
  const leftTip: [number, number] = [tipX + nx * tipWidth, tipY + ny * tipWidth];
  const rightTip: [number, number] = [tipX - nx * tipWidth, tipY - ny * tipWidth];
  const leftMid: [number, number] = [midX + nx * midWidth, midY + ny * midWidth];
  const rightMid: [number, number] = [midX - nx * midWidth, midY - ny * midWidth];
  const f = (n: number) => n.toFixed(1);
  return (
    `M ${f(leftBase[0])} ${f(leftBase[1])} ` +
    `Q ${f(leftMid[0])} ${f(leftMid[1])} ${f(leftTip[0])} ${f(leftTip[1])} ` +
    `L ${f(rightTip[0])} ${f(rightTip[1])} ` +
    `Q ${f(rightMid[0])} ${f(rightMid[1])} ${f(rightBase[0])} ${f(rightBase[1])} Z`
  );
}

/** A point at `length` from a base, at `angleDeg` measured from straight up. */
function fromBase(angleDeg: number, length: number, baseX: number, baseY: number): [number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  return [baseX + Math.sin(rad) * length, baseY - Math.cos(rad) * length];
}

// Every species' doodle shares one ground point and one viewBox, so the
// container's aspect-ratio in styles.css and the anchor in plantSeed line up
// for all three without species-specific positioning.
const PLANT_BASE_X = 60;
const PLANT_BASE_Y = 128;

function seedMarkup(rx: number, ry: number, color: string): string {
  return `<ellipse data-phase="seed" cx="${PLANT_BASE_X}" cy="${PLANT_BASE_Y - 1}" rx="${rx}" ry="${ry}" fill="${color}"/>`;
}

/** seed -> small stem -> leaves -> bud -> open flower. */
function flowerMarkup(rand: () => number): string {
  const baseX = PLANT_BASE_X;
  const baseY = PLANT_BASE_Y;
  const stemTip: [number, number] = [baseX + jitter(4, rand), 66 + jitter(4, rand)];
  const stemBow = jitter(8, rand);
  const leafABase: [number, number] = [
    baseX + (stemTip[0] - baseX) * 0.62,
    baseY + (stemTip[1] - baseY) * 0.62,
  ];
  const leafATip: [number, number] = [leafABase[0] - 16 - rand() * 4, leafABase[1] - 6 - rand() * 4];
  const leafBBase: [number, number] = [
    baseX + (stemTip[0] - baseX) * 0.42,
    baseY + (stemTip[1] - baseY) * 0.42,
  ];
  const leafBTip: [number, number] = [leafBBase[0] + 17 + rand() * 4, leafBBase[1] - 8 - rand() * 4];
  const center: [number, number] = [stemTip[0], stemTip[1] - 2];
  // A few close pink tones instead of one flat fill, and a soft blush behind
  // them, so the bloom reads as loosely hand-painted rather than a flat
  // vector flower.
  const petalColors = ["#ec4899", "#f472b6", "#e0559c"];
  const petals = [-18, 54, 126, 198, 270]
    .map((a) => a + jitter(10, rand))
    .map((a, i) => {
      const tip = fromBase(a, 13 + rand() * 2, center[0], center[1]);
      return `<path data-phase="d" d="${leafPath(center[0], center[1], tip[0], tip[1], 6.5, rand)}" fill="${petalColors[i % petalColors.length]}"/>`;
    })
    .join("");
  // A few tiny stamens around the center instead of one flat dot.
  const stamens = [-40, 40, 180]
    .map((a) => a + jitter(20, rand))
    .map((a) => {
      const [sx, sy] = fromBase(a, 2.5 + rand(), center[0], center[1]);
      return `<circle data-phase="d" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="1.4" fill="#f5c542"/>`;
    })
    .join("");

  return `
    ${seedMarkup(5, 3.2, "#7a4a26")}
    <path data-phase="a" data-grow-line="1" pathLength="1" d="${stemPath(baseX, baseY, stemTip[0], stemTip[1], stemBow)}" stroke="#4a8c3a" stroke-width="3"/>
    <path data-phase="b" d="${leafPath(leafABase[0], leafABase[1], leafATip[0], leafATip[1], 8, rand)}" fill="#5ba24a"/>
    <path data-phase="b" d="${leafPath(leafBBase[0], leafBBase[1], leafBTip[0], leafBTip[1], 8, rand)}" fill="#4a8c3a"/>
    <circle data-phase="c" cx="${stemTip[0]}" cy="${stemTip[1] - 2}" r="6" fill="#d98aa3"/>
    <circle data-phase="d" cx="${center[0]}" cy="${center[1]}" r="11" fill="rgb(244 114 182 / 25%)"/>
    ${petals}
    <circle data-phase="d" cx="${center[0]}" cy="${center[1]}" r="4.5" fill="#f5c542"/>
    ${stamens}
  `;
}

/** seed -> several shoots -> branching leafy shrub. */
function grassMarkup(rand: () => number): string {
  const baseX = PLANT_BASE_X;
  const baseY = PLANT_BASE_Y;
  const shootAngles = [-22, -7, 8, 22].map((a) => a + jitter(6, rand));
  const shoots = shootAngles
    .map((a, i) => {
      const len = 30 + i * 3 + rand() * 6;
      const tip = fromBase(a, len, baseX, baseY - 1);
      const bow = jitter(6, rand);
      return `<path data-phase="a" data-grow-line="1" pathLength="1" d="${stemPath(baseX, baseY, tip[0], tip[1], bow)}" stroke="#4a8c3a" stroke-width="2.4"/>`;
    })
    .join("");
  const clusterCenters = shootAngles.map((a) => fromBase(a, 34 + rand() * 6, baseX, baseY - 1));
  const earlyLeaves = clusterCenters
    .map((c) => `<path data-phase="b" d="${blobPath(c[0], c[1], 7, 6, rand)}" fill="#5ba24a"/>`)
    .join("");
  const twigCenters: [number, number][] = [
    fromBase(-30 + jitter(6, rand), 24 + rand() * 4, baseX, baseY - 1),
    fromBase(32 + jitter(6, rand), 26 + rand() * 4, baseX, baseY - 1),
  ];
  const twigs = twigCenters
    .map(
      (c) =>
        `<path data-phase="c" data-grow-line="1" pathLength="1" d="${stemPath(baseX, baseY - 4, c[0], c[1], jitter(6, rand))}" stroke="#3d7a30" stroke-width="2"/>`,
    )
    .join("");
  const bushCenters: [number, number][] = [
    [baseX, baseY - 38],
    [baseX - 14, baseY - 30],
    [baseX + 14, baseY - 30],
    [baseX - 20, baseY - 46],
    [baseX + 18, baseY - 44],
    [baseX, baseY - 54],
    [baseX - 8, baseY - 20],
    [baseX + 9, baseY - 20],
  ];
  // Three greens instead of two, plus a few berry accents scattered across
  // the blobs, so a mature bush reads as flowering/fruiting rather than a
  // uniform mass of leaves.
  const bushPalette = ["#5ba24a", "#4a8c3a", "#6bb85a"];
  const bushBlobs = bushCenters
    .map(
      ([cx, cy], i) =>
        `<path data-phase="d" d="${blobPath(cx, cy, 12 - i * 0.3, 7, rand)}" fill="${bushPalette[i % bushPalette.length]}"/>`,
    )
    .join("");
  const berries = bushCenters
    .filter((_, i) => i % 3 === 0)
    .map(([cx, cy]) => {
      const bx = cx + jitter(5, rand);
      const by = cy + jitter(5, rand);
      return `<circle data-phase="d" cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="1.6" fill="#d9534f"/>`;
    })
    .join("");

  return `
    ${seedMarkup(5, 3.2, "#7a4a26")}
    ${shoots}
    ${earlyLeaves}
    ${twigs}
    ${bushBlobs}
    ${berries}
  `;
}

/** seed -> stem -> trunk -> branches -> expanding canopy. */
function treeMarkup(rand: () => number): string {
  const baseX = PLANT_BASE_X;
  const baseY = PLANT_BASE_Y;
  const trunkTip: [number, number] = [baseX + jitter(3, rand), 58 + jitter(4, rand)];
  const stemBow = jitter(6, rand);
  const branchAngles = [-50, -20, 20, 50].map((a) => a + jitter(8, rand));
  const branchBases: [number, number][] = [0.9, 0.65, 0.65, 0.9].map((f) => [
    baseX + (trunkTip[0] - baseX) * f,
    baseY + (trunkTip[1] - baseY) * f,
  ]);
  const branches = branchAngles
    .map((a, i) => {
      const len = 22 + rand() * 8;
      const tip = fromBase(a, len, branchBases[i][0], branchBases[i][1]);
      return `<path data-phase="c" data-grow-line="1" pathLength="1" d="${stemPath(branchBases[i][0], branchBases[i][1], tip[0], tip[1], jitter(6, rand))}" stroke="#3d2a18" stroke-width="2.6"/>`;
    })
    .join("");
  const canopyCenters: [number, number][] = [
    [trunkTip[0], trunkTip[1] - 18],
    [trunkTip[0] - 20, trunkTip[1] - 6],
    [trunkTip[0] + 20, trunkTip[1] - 6],
    [trunkTip[0] - 12, trunkTip[1] - 26],
    [trunkTip[0] + 12, trunkTip[1] - 26],
    [trunkTip[0], trunkTip[1] - 34],
  ];
  // Three greens (one a lighter highlight) instead of two, plus a scatter of
  // small blossoms across the canopy for a friendlier, storybook tree.
  const canopyPalette = ["#2f6d3f", "#20542f", "#3f8752"];
  const canopy = canopyCenters
    .map(
      ([cx, cy], i) =>
        `<path data-phase="d" d="${blobPath(cx, cy, 16 - i * 0.8, 8, rand)}" fill="${canopyPalette[i % canopyPalette.length]}"/>`,
    )
    .join("");
  const blossoms = canopyCenters
    .filter((_, i) => i % 2 === 0)
    .map(([cx, cy]) => {
      const bx = cx + jitter(8, rand);
      const by = cy + jitter(8, rand);
      return `<circle data-phase="d" cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="1.8" fill="#f2a6c1"/>`;
    })
    .join("");
  // A couple of short bark marks on the trunk --- <line>, not <path>, so the
  // shared ink-outline rule (which targets ellipse/circle/path) doesn't
  // thicken these past their own thin stroke.
  const barkMarks = [0.35, 0.6]
    .map((f) => {
      const bx = baseX + (trunkTip[0] - baseX) * f + jitter(2, rand);
      const by = baseY + (trunkTip[1] - baseY) * f;
      return `<line data-phase="b" x1="${(bx - 1.5).toFixed(1)}" y1="${(by - 1).toFixed(1)}" x2="${(bx + 1.5).toFixed(1)}" y2="${(by + 1).toFixed(1)}" stroke="#2f1d0f" stroke-width="0.8" stroke-linecap="round"/>`;
    })
    .join("");

  return `
    ${seedMarkup(5.5, 3.4, "#5a3a1e")}
    <path data-phase="a" data-grow-line="1" pathLength="1" d="${stemPath(baseX, baseY, trunkTip[0], trunkTip[1], stemBow)}" stroke="#4a2f18" stroke-width="2.2"/>
    <path data-phase="b" d="${trunkPath(baseX, baseY, trunkTip[0], trunkTip[1], 4.6, 1.6, rand)}" fill="#4a2f18"/>
    ${barkMarks}
    ${branches}
    ${canopy}
    ${blossoms}
  `;
}

const SPECIES_MARKUP: Record<Species, (rand: () => number) => string> = {
  flower: flowerMarkup,
  grass: grassMarkup,
  tree: treeMarkup,
};

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

function plantSeed(garden: HTMLElement, x: number, y: number, species: Species): void {
  const profile = SPECIES_PROFILES[species];
  const pitch = xToPitch(x / garden.clientWidth, profile.octaveOffset);
  playVoice(pitch, timbreForStage("seed", profile.timbre));

  const dot = document.createElement("div");
  dot.className = `plant-dot plant-${species}`;
  dot.style.left = `${x}px`;
  dot.style.top = `${y}px`;
  dot.innerHTML = `<svg viewBox="0 0 120 140" preserveAspectRatio="xMidYMax meet">${SPECIES_MARKUP[species](Math.random)}</svg>`;
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
const WATER_BASE_GAIN = 0.015;
const WATER_MAX_GAIN = 0.09;
const WATER_GAIN_PER_SPEED = 0.2;
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

// --- Shovel: tap a plant to remove it -------------------------------------
//
// A tap near a plant (not on empty soil --- tapping nothing does nothing, the
// same no-fail-state manners as watering) stops its drone through the
// existing fade-out and plays a short, unpitched noise burst: tool feedback,
// not another species voice, so this doesn't need its own synthesis path.

const SHOVEL_HIT_RADIUS_PX = 24;
const REMOVAL_FILTER_HZ = 260;
const REMOVAL_GAIN = 0.22;
const REMOVAL_ATTACK_S = 0.006;
const REMOVAL_DECAY_S = 0.16;

/** A one-shot scrape/thud: the same shared noise buffer the watering drag
 * uses, run through a low bandpass with a short percussive envelope instead
 * of a continuous one --- deliberately dull and unpitched. */
function playRemovalSound(): void {
  const context = getAudioContext();
  const now = context.currentTime;

  const source = context.createBufferSource();
  source.buffer = getNoiseBuffer(context);

  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = REMOVAL_FILTER_HZ;
  filter.Q.value = 0.9;

  const envelope = context.createGain();
  envelope.gain.setValueAtTime(0, now);
  envelope.gain.linearRampToValueAtTime(REMOVAL_GAIN, now + REMOVAL_ATTACK_S);
  envelope.gain.linearRampToValueAtTime(0, now + REMOVAL_ATTACK_S + REMOVAL_DECAY_S);

  source.connect(filter);
  filter.connect(envelope);
  envelope.connect(getMasterGain(context));

  source.start(now);
  source.stop(now + REMOVAL_ATTACK_S + REMOVAL_DECAY_S);
  source.addEventListener("ended", () => {
    source.disconnect();
    filter.disconnect();
    envelope.disconnect();
  });
}

/** Removes the nearest plant within SHOVEL_HIT_RADIUS_PX of (x, y), if any. */
function removePlantNear(x: number, y: number): void {
  let nearest: Plant | null = null;
  let nearestDist = SHOVEL_HIT_RADIUS_PX;
  for (const plant of plants) {
    const dist = Math.hypot(plant.x - x, plant.y - y);
    if (dist <= nearestDist) {
      nearest = plant;
      nearestDist = dist;
    }
  }
  if (!nearest) return;
  const plant = nearest;

  stopDrone(plant);
  playRemovalSound();

  plants.splice(plants.indexOf(plant), 1);
  const queueIndex = sustainedQueue.indexOf(plant);
  if (queueIndex !== -1) sustainedQueue.splice(queueIndex, 1);

  plant.dot.classList.add("removing");
  plant.dot.addEventListener("animationend", () => plant.dot.remove());
}

/** Removes every plant at once: fades each drone through the normal release
 * curve and plays the normal shrink-out animation, but skips the shovel's
 * per-plant thud --- a reset, not many one-shot removals. */
function clearGarden(): void {
  for (const plant of plants) {
    stopDrone(plant);
    plant.dot.classList.add("removing");
    plant.dot.addEventListener("animationend", () => plant.dot.remove());
  }
  plants.length = 0;
  sustainedQueue.length = 0;
}

// --- Tool tray: which gesture does what -----------------------------------
//
// One active tool at a time, picked from the tray in index.html. A species
// tool plants that species on tap; the watering can keeps the existing
// drag-to-water behavior untouched; the shovel removes on tap. Defaults to
// "flower" so the instrument is playable before anyone touches the tray.

type Tool = Species | "water" | "shovel";

let activeTool: Tool = "flower";

for (const button of document.querySelectorAll<HTMLButtonElement>(".tool-button")) {
  if (button.dataset.tool === "clear") {
    button.addEventListener("click", () => clearGarden());
    continue;
  }
  button.addEventListener("click", () => {
    activeTool = button.dataset.tool as Tool;
    for (const other of document.querySelectorAll<HTMLButtonElement>(".tool-button")) {
      if (other.dataset.tool === "clear") continue;
      other.setAttribute("aria-pressed", String(other === button));
    }
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

// --- Gesture: pointerdown is a "maybe water" until it proves otherwise ----
//
// A tap acts once, on release, by whichever tool is active (plant a species,
// or remove with the shovel); a drag only ever waters, and only when the
// watering can is the active tool. Whether a gesture crosses into a drag
// can't be known until the pointer either lifts (tap) or travels far enough
// (drag), so nothing commits at pointerdown --- this is the one place that
// decides, rather than each gesture handler guessing independently.

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
      if (activeTool !== "water") return; // other tools act only on release
      const traveled = Math.hypot(x - drag.startX, y - drag.startY);
      if (traveled < DRAG_THRESHOLD_PX) return; // still just a maybe-water
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
    } else if (activeTool === "shovel") {
      removePlantNear(drag.startX, drag.startY);
    } else if (activeTool !== "water") {
      // Never crossed the drag threshold --- a tap with a species tool
      // active. Plant a seed. (A tap with the watering can does nothing:
      // only dragging waters.)
      plantSeed(garden, drag.startX, drag.startY, activeTool);
    }

    drag = null;
  };

  garden.addEventListener("pointerup", endGesture);
  garden.addEventListener("pointercancel", endGesture);
}

requestAnimationFrame(updatePlants);
