# PLAN: musical garden (crit-4, "An instrument")

Not implemented yet — this is the build order, agreed before writing code.
Deviations as the build actually happens belong in `PROCESS.md`, not here.

## V1 concept

- tap soil to plant a sound seed
- three plant types with distinct timbres and growth sounds
- plants progress seed → sprout → bloom → fade, sound and visuals evolving together
- dragging through the garden waters plants; the drag gesture itself makes sound,
  and its speed/position shape that sound
- watering revives or brightens a plant's sound
- pitches are constrained to a harmonious scale (no wrong notes, ever)
- voices decay naturally and stay bounded (no unbounded buildup)

**Postponed:** shovel/removal, sprinkler, species beyond three, complex visual
effects. Don't build toward these; don't leave hooks for them either.

## Cross-cutting decisions (fixed before step 1, so nothing built early has to
## be re-architected later)

- **One shared `AudioContext`**, created lazily and resumed on the first
  pointer gesture (autoplay policy). Nothing sounds before that.
- **Scale lock lives at the very bottom of the pitch path** — a single
  `xToPitch(x)` function quantizing to a fixed scale (start with a major or
  minor pentatonic; five notes, no dissonant intervals possible). Every voice,
  in every later step, calls this. "No wrong notes" is structural from step 1,
  not a filter bolted on at the end.
- **One `Voice` primitive**: oscillator(s) → per-voice gain (the envelope) →
  optional filter → master gain → destination, auto-disconnected when its
  envelope finishes. Planting, growth-stage transitions, and watering all
  reuse this; species differ only in the parameters they pass it (waveform,
  detune, filter cutoff, envelope shape) — no separate synthesis path per
  species.
- **One central update loop** (`requestAnimationFrame`), not one `setTimeout`
  per plant. It walks the plant list each frame, advances stage-by-age,
  updates each voice's envelope/filter accordingly, and prunes faded plants.
  This is also the one place that enforces a voice cap (say, ~10 concurrent
  bloomed plants) by fading the oldest a little faster rather than blocking
  new ones — keeps "no fail state" true even under heavy tapping.
- **Tap vs. drag disambiguation**: pointerdown starts as a "maybe plant";
  if pointermove exceeds a small distance threshold before pointerup, it
  becomes a watering drag instead (and any pending plant is cancelled). This
  is decided once, centrally, not duplicated per gesture handler.

## Build sequence (each step ends in a playable, committable state)

1. **Tone engine + scale lock.** `xToPitch`, the `Voice` primitive, one
   default species. No UI beyond the existing page. Prove it by wiring a
   single test tone to a click, in the console if needed — not shippable yet,
   but de-risks the audio plumbing before any garden logic exists.

2. **Tap soil → plant a seed (one species, bare visual).** Pointerdown (not
   yet distinguishing drag) creates a plant record and triggers its seed-stage
   blip via the tone engine; pitch from `xToPitch`. Render a plain dot.
   **Checkpoint:** this is already a real, deployable instrument — live
   synthesis, pointer-driven, scale-locked, no instructions needed. If the
   clock runs out anywhere after this step, there's still something honestly
   spec-satisfying to ship. Commit here.

3. **Growth stages.** Add age-based stage transitions in the central update
   loop (seed → sprout → bloom → fade), each stage updating the voice's
   envelope/filter and the dot's visual (size/color, kept simple). Fade
   disconnects the voice and removes the plant. This is where "layered
   harmony" actually appears, for free, from scale-locking + concurrent
   bloomed voices. Commit here.

4. **Drag-to-water.** Add the tap/drag threshold. A drag emits its own
   continuous, lightweight sound (filtered noise or similar, not a full
   `Voice`) whose brightness/amplitude tracks drag speed. Plants the drag path
   crosses get "watered": brighten their filter and push their fade deadline
   back. Commit here.

5. **Three species.** Extend the tone-engine parameters into a small species
   table (distinct waveform/filter/envelope character each). Assign species
   by tap order (cycle 1-2-3-1-2-3…) rather than any menu or mode UI — variety
   with zero new interface surface to explain. Commit here.

6. **Polish pass.** Visual/sound tuning per stage, verify feel at both marked
   viewports (1920×1080 and 390×844 — touch drag on phone is the one most
   likely to need rework), re-run `pnpm check` and `spec/crit-4.test.ts`,
   check the opening empty-garden screen actually invites a first tap with no
   copy required. Commit here.

Steps 1–2 are the part that must exist for this to count as an instrument at
all; treat everything from step 3 on as sequential value-add that can stop
early if the clock forces it, without leaving a broken state behind.
